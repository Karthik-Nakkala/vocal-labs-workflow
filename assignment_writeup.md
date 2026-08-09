# VocalLabs SDE Assignment Writeup

## 1. Schema Reasoning & Relationships

The data model is architected around multi-tenant isolation, structured step execution, and granular run logging in PostgreSQL via Hasura GraphQL Engine.

### Table Hierarchy & Foreign Key Linkages
- **`organizations`** `(id, name, quota_used, quota_limit)`: Root entity representing tenant boundaries.
- **`organization_members`** `(id, org_id, user_id, role)`: Maps Nhost Auth users (`user_id`) to organizations with role assignments (`owner`, `editor`, `viewer`).
- **`workflows`** `(id, org_id, name)`: Belongs strictly to an organization (`org_id` FK).
- **`workflow_steps`** `(id, workflow_id, name, type, config, step_order)`: Defines ordered execution steps.
- **`workflow_runs`** `(id, workflow_id, user_id, status, input, output)`: Captures single execution state (`pending`, `running`, `waiting_approval`, `completed`, `failed`).
- **`workflow_run_steps`** `(id, run_id, step_id, status, input, output)`: Per-step execution log capturing detailed inputs, outputs, errors, and approval metadata (`approved_by`, `approved_at`).

---

## 2. Two-Layer Permission Enforcement

Security is enforced across two distinct architectural layers to prevent privilege escalation and cross-tenant data leaks.

### Layer 1: Org & Role Scoping (Row-Level Security / RLS)
- **Tenant Isolation:** Every GraphQL query and mutation evaluates membership in `organization_members` for the authenticated `x-hasura-user-id`. Even if a user in **Org B** knows the UUID of a workflow in **Org A**, Hasura RLS returns `null` / empty array.
- **Role Permissions:**
  - `owner`: Full read/write over workflows, steps, and member management.
  - `editor`: Read/write over workflows and steps, execution trigger rights; blocked from member role edits.
  - `viewer`: Read-only. Run buttons and mutation options are stripped in the UI and blocked in Hasura permissions.

### Layer 2: Step-Level Gating & Mid-Execution Authorization
- Static database permissions cannot evaluate mid-execution dynamic decisions (e.g. whether a specific user can clear a paused approval gate).
- Step-level gating (`db_write`, `notify`, `approval_gate`) is enforced server-side inside Nhost Serverless Functions (`trigger-workflow-run.js`, `approve-workflow-step.js`).
- When a user attempts to approve a paused gate, the function queries the user's role in the workflow's parent organization. If the caller's role is not `owner` or `editor`, the request is rejected with `403 Forbidden`.

---

## 3. Approval Gate Pause & Resume Implementation

The human-in-the-loop workflow lifecycle operates as a stateful event loop:

1. **Triggering Execution:** The Nhost Action `triggerWorkflowRun` initializes a `workflow_runs` row with `status: "running"` and begins sequential step processing in `engine.js`.
2. **Pausing at Approval Gate:**
   - When the engine encounters a step with `type === "approval_gate"`, it creates a `workflow_run_steps` row with `status: "waiting_approval"`.
   - The engine updates the parent `workflow_runs` row to `status: "waiting_approval"` and halts execution cleanly.
3. **Live Subscription Update:**
   - The React frontend receives the status update in real-time via GraphQL Subscriptions on `workflow_run_steps`.
   - The UI renders the interactive **`⚠️ Approval Required`** card displaying required approver roles (`owner` / `editor`).
4. **Resuming Execution:**
   - When an authorized user clicks **`✓ Approve & Resume`**, the client invokes the `approveStep` Action function.
   - The handler verifies the approver's role, marks the step `completed` with timestamp and user ID, and re-invokes `runWorkflowEngine({ runId, startFromStepOrder: nextStep })` to finish remaining steps.
