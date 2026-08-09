# AI Agent Workflow Builder — Architecture Write-Up & Technical Implementation

---

## 1. Schema Reasoning & Relationships

The database architecture is designed in PostgreSQL and Hasura to enforce multi-tenant isolation, stateful workflow execution, and granular audit trails.

### Core Tables & Foreign Key Hierarchy

```
organizations (Root tenant with calls_used / max_quota)
  ├── organization_members (user_id, org_id, role: owner | editor | viewer)
  └── workflows (org_id FK)
        ├── workflow_steps (workflow_id FK, type, config, step_order)
        ├── workflow_triggers (workflow_id FK, trigger_type: manual | webhook | scheduled | db_event)
        └── workflow_runs (workflow_id FK, user_id, status: pending | running | waiting_approval | completed | failed)
              └── step_runs (run_id FK, step_id FK, status, input, output, attempt_count, approved_by, approved_at)
```

### Key Schema Design Decisions
- **`organizations` (`calls_used`, `max_quota`)**: Tracks quota consumption at the tenant level. Quota is checked before launching any run and incremented automatically upon successful run completion in `engine.js`.
- **`organization_members` (`org_id`, `user_id`, `role`)**: Serves as the single source of truth for Layer 1 multi-tenant authorization. The unique constraint `(org_id, user_id)` prevents duplicate memberships.
- **`workflow_steps` (`step_order`)**: Explicit integer order guarantees deterministic sequential step execution regardless of database insert timing.
- **`step_runs` (`approved_by`, `approved_at`)**: Stores full audit metadata when human-in-the-loop approval gate steps are cleared, linking back to the user UUID and timestamp.
- **`org_usage_analytics` (PostgreSQL View)**: Computed view providing real-time aggregation of monthly quota usage percentages, remaining call limits, total workflows, and run counts per organization.

---

## 2. Two-Layer Permission Enforcement

Security is enforced across two distinct architectural layers so that role restrictions and organization isolation can never be bypassed, even by guessing direct resource IDs.

```
                          Incoming Request
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
       [Layer 1: Database/RLS]        [Layer 2: Action Handler]
       Org & Role Data Isolation     Mid-Execution Step Gating
       • Hasura RLS Rules            • /approveWorkflowStep Function
       • Org Membership Checks       • Owner / Editor Role Verification
       • Read/Write Role Scoping     • Audit Trail (approved_by/at)
```

### Layer 1: Org + Role Scoping (Row-Level Security & Database Level)
- **Tenant Isolation**: Every GraphQL query and mutation evaluates `org_id` against `organization_members` for the authenticated `x-hasura-user-id`. A user in **Org B** can never read, modify, or infer data belonging to **Org A**, even if they explicitly query an Org A UUID.
- **Role Permissions**:
  - `owner`: Full control — create/edit/delete workflows, steps, triggers, execute runs, and manage organization membership.
  - `editor`: Can create and edit workflows and steps, and trigger runs — cannot add, remove, or change member roles.
  - `viewer`: Strictly read-only access — cannot create workflows, edit steps, trigger runs, or approve gates. In the UI, action buttons (`▶ Run Workflow`, `Save Workflow`, `✓ Approve`) are automatically hidden/disabled for viewers.

### Layer 2: Step-Level Gating & Mid-Execution Authorization (Function & Execution Level)
- Static database permissions alone are insufficient for mid-execution decisions (e.g. approving a paused workflow gate mid-run).
- Clearing an `approval_gate` step requires calling the dedicated Nhost Serverless Action (`/approveWorkflowStep`).
- The function queries the organization membership chain for the caller's `user_id` and verifies their role is in `["owner", "editor"]`. If a `viewer` or non-member attempts to call the action, the request is immediately rejected with a `403 Forbidden` error.

---

## 3. Approval Gate Pause & Resume Implementation

The human-in-the-loop workflow lifecycle operates as a stateful, event-driven execution loop:

```
[Start Run] ──► [Step 1: llm_call] ──► [Step 2: http_request] ──► [Step 3: approval_gate]
                                                                        │
                                                                 (Pause Workflow)
                                                                        ▼
                                                             Status: waiting_approval
                                                                        │
                                                                (User Action: Approve)
                                                                        ▼
[Mark Completed] ◄── [Step 5: notify] ◄── [Step 4: db_write] ◄── [/approveWorkflowStep]
```

### Stateful Pause-and-Resume Protocol
1. **Triggering Execution**: The `/triggerWorkflowRun` Action validates caller membership and quota, inserts a `workflow_runs` row with `status: "pending"`, and kicks off `runWorkflowEngine({ runId })` asynchronously.
2. **Pausing at Approval Gate**:
   - When the engine processes a step with `type === "approval_gate"`, it sets `stepStatus = "waiting_approval"`, saves the step state into `step_runs`, updates `workflow_runs` status to `"waiting_approval"`, and gracefully halts execution.
3. **Live Subscription & Polling**:
   - The React frontend monitors the run via live queries/polling on `step_runs` filtered by `run_id`.
   - When status becomes `waiting_approval`, the UI renders an interactive **🔐 Approval Gate** card displaying required approver roles (`Owner` or `Editor`).
4. **Authorizing & Resuming Execution**:
   - An authorized Owner/Editor clicks **✓ Approve & Resume**, invoking the `/approveWorkflowStep` endpoint.
   - The serverless handler validates the approver's role, updates `step_runs` with `status: "completed"`, `approved_by: userId`, and `approved_at: timestamp`.
   - The handler re-invokes `runWorkflowEngine({ runId, startFromStepOrder: currentStepOrder + 1 })` asynchronously to execute remaining steps until the workflow completes.
