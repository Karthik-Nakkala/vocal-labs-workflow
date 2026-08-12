# VocalLabs AI Agent Workflow Builder: Architecture Write-Up

## 1. Schema Reasoning & Structural Design

The database schema is structured for a multi-tenant, enterprise-grade workflow orchestration platform.

- **Tenant Isolation & Quota Management (`organizations` & `organization_members`)**:
  - `organizations` serves as the tenant root entity. It holds stateful rate-limiting and usage counters (`calls_used` and `max_quota`).
  - `organization_members` establishes the RBAC mapping between authenticated users (`user_id`) and organizations (`org_id`). Every membership assigns a role: `owner`, `editor`, or `viewer`. This explicit entity prevents orphaned resource ownership and supports multi-organization user profiles.

- **Declarative Workflow Graph Definitions (`workflows`, `workflow_steps`, `workflow_triggers`)**:
  - `workflows` anchors the workflow meta-data to its parent organization (`org_id`).
  - `workflow_steps` stores the deterministic execution graph as an ordered sequence of nodes (`step_order`), node classification (`type`: `llm_call`, `http_request`, `conditional_branch`, `approval_gate`, `db_write`, `notify`), and schema-less configuration payload (`config` JSONB).
  - `workflow_triggers` encapsulates trigger definitions (`trigger_type`: `manual`, `webhook`, `scheduled`, `db_event`) decoupled from execution logic.

- **Execution State & Audit Traceability (`workflow_runs` & `workflow_run_steps`)**:
  - `workflow_runs` records each execution instance, tracking overall status (`pending`, `running`, `waiting_approval`, `completed`, `failed`), initial input, and final output payloads.
  - `workflow_run_steps` (mapped to `step_runs` in Postgres) provides granular per-node execution audit trails. It records node-level status, input/output transitions, retry attempts (`attempt_count`), and approval audit metadata (`approved_by`, `approved_at`).

- **Aggregation & Analytics View (`org_usage_analytics`)**:
  - A PostgreSQL view aggregating workflow counts, run totals, quota remaining, and usage percentages per organization to power administrative dashboards efficiently without heavy client-side computation.

---

## 2. Dual-Layer Permission Enforcement Model

Security is enforced using two complementary, defense-in-depth permission layers operating at distinct architectural boundaries:

```
[ Client Request ]
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│ Layer 1: Hasura GraphQL Gateway & PostgreSQL RLS        │
│ ➔ Data Scoping & Multi-Tenant Isolation                 │
│ ➔ Dynamic filters based on X-Hasura-User-Id             │
└──────────────────────────┬──────────────────────────────┘
                           │ Passed / Routed to Action
                           ▼
┌─────────────────────────────────────────────────────────┐
│ Layer 2: Serverless Engine & Action Handlers            │
│ ➔ Operation & Side-Effect Authorization                 │
│ ➔ Role enforcement (Owner/Editor vs. Viewer) in code    │
└─────────────────────────────────────────────────────────┘
```

### Layer 1: Hasura Declarative Permissions & Postgres RLS (Data Scoping)
- **Role & Tenant Boundary**: Applied automatically by Hasura GraphQL Engine and PostgreSQL Row-Level Security (RLS) on all incoming client queries/mutations.
- **Enforcement Mechanism**: Hasura dynamically injects SQL `WHERE` clauses matching `X-Hasura-User-Id` against `organization_members`. A user in Organization B cannot read, update, or delete workflows belonging to Organization A—even if they possess valid record UUIDs.
- **Granular Controls**: Select, Insert, Update, and Delete rules are configured per table. Viewers are restricted to `select` operations, while `owner` and `editor` roles gain write capabilities.

### Layer 2: Serverless Function & Action-Level Authorization (Operation & Side-Effect Protection)
- **Execution Guarding**: Serverless functions (`trigger-workflow-run`, `approve-workflow-step`, `save-workflow`, `manage-workflow-trigger`) execute operations using Hasura Admin privileges (`nhostAdmin` client) to perform atomic multi-table updates.
- **Programmatic Authorization**: Before executing side-effects (calling Gemini LLM APIs, dispatching webhooks, or mutating run states), the code queries the full organizational membership chain to verify the caller's explicit role.
- **Role Enforcement**:
  - Workflow creation and trigger management require `owner` or `editor` roles.
  - Approval gates (`approve-workflow-step`) check that the approver is an `owner` or `editor` within the specific organization owning the workflow. `viewer` roles or external non-members receive HTTP `403 Forbidden` responses.

---

## 3. Approval-Gate Pause / Resume Implementation

The Human-in-the-Loop (HITL) pattern is implemented via an asynchronous state-machine inside the execution engine and approval Action.

```
[ Step 1: LLM Call ] ──> [ Step 2: Approval Gate ] ──( Pause Run & Step )──> [ UI: waiting_approval ]
                                                                                   │
                                                                       User Calls approveWorkflowStep
                                                                                   │
[ Step 3: HTTP Request ] <──( Engine Resumes from step_order + 1 ) <─── [ If Approved: True ]
```

### 1. Pause Mechanism (`functions/engine.js`)
1. The workflow engine (`runWorkflowEngine`) iterates through workflow steps sorted by `step_order`.
2. When evaluating a node of `type === "approval_gate"`:
   - Sets the step status to `"waiting_approval"`.
   - Populates step output metadata including `requiredRole: ["owner", "editor"]` and `stepRunId`.
   - Updates `workflow_run_steps` status to `"waiting_approval"`.
   - Mutates top-level `workflow_runs` status to `"waiting_approval"`.
   - Sets `pauseWorkflow = true` and returns `{ status: "waiting_approval", pausedAtStepId }`, halting engine execution without error.
3. GraphQL subscriptions (`OnRunProgress`) stream the `"waiting_approval"` status update to the frontend interface in real-time.

### 2. Resume / Rejection Mechanism (`functions/approve-workflow-step.js`)
1. An authorized user triggers the `approveWorkflowStep` GraphQL Action providing `{ step_run_id, approved: true | false }`.
2. The serverless handler extracts `userId` from session variables, fetches the `workflow_run_steps` record, and traces the relation chain up to `organization_members`.
3. **Guards**:
   - Verifies that the step type is `approval_gate`.
   - Verifies that the run status is currently `"waiting_approval"`.
   - Enforces Layer 2 authorization: Caller MUST have `owner` or `editor` role in the workflow's organization.
4. **On Approval (`approved: true`)**:
   - Updates `workflow_run_steps` status to `"completed"` and writes audit records (`approved_by`, `approved_at`, output metadata).
   - Invokes `runWorkflowEngine({ runId, startFromStepOrder: currentStepOrder + 1 })`.
   - The engine resumes execution starting from the next step order (`step_order > currentStepOrder`), seamlessly executing subsequent nodes (`http_request`, `db_write`, etc.).
5. **On Rejection (`approved: false`)**:
   - Updates `workflow_run_steps` and parent `workflow_runs` status to `"failed"`.
   - Writes rejection audit metadata (`rejectedByUserId`, `rejectedAt`), permanently stopping execution.
