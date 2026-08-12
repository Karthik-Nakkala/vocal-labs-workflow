# AI Agent Workflow Builder — Assignment Write-Up

## Schema reasoning

The application is a multi-tenant workflow builder. `organizations` is the tenant root and holds the quota counters (`calls_used` and `max_quota`). `organization_members` connects authenticated users to an organization with exactly one role: `owner`, `editor`, or `viewer`. A user has no organization access simply by registering; creating an organization makes that user its owner.

Each `workflows` row belongs to an organization. `workflow_steps` stores a deterministic `step_order`, node `type`, and JSON configuration; `workflow_triggers` stores manual, webhook, scheduled, and database-event trigger definitions. A workflow execution creates a `workflow_runs` record and one `workflow_run_steps` record per executed node. The latter stores state, input/output, attempts, errors, and approval audit fields (`approved_by` and `approved_at`). This gives a clear graph:

```text
organization → organization_members / workflows
workflow → workflow_steps / workflow_triggers / workflow_runs
workflow_run → workflow_run_steps
```

`org_usage_analytics` is a PostgreSQL view used for the organization-level usage aggregation.

## Two distinct permission layers

Layer 1 is organization and role scoping. Hasura permissions and application queries scope workflow data through the caller's membership. Therefore having the same role in Org B never gives a user access to Org A records, even if they submit an Org A UUID directly. Owners manage workflows and members; editors build workflows and run them but cannot manage members; viewers have read-only UI and are rejected from state-changing operations.

Layer 2 protects sensitive workflow operations in server functions, where a database row permission is insufficient. The workflow-save and trigger-management paths restrict `db_write`, `notify`, and webhook-trigger configuration to owners. `approve-workflow-step` independently resolves the paused run's organization and verifies that the approver is an owner or editor before updating approval audit fields and resuming execution. Non-members and viewers receive `403` responses.

## Execution, live progress, and approval

The Hasura `triggerWorkflowRun` Action is backed by the `trigger-workflow-run` function. It validates owner/editor membership, checks the quota, creates a pending `workflow_runs` row, and returns its ID. The UI immediately opens a GraphQL subscription (`OnRunProgress`) on that run and invokes the protected `engine` function. The engine updates the run and `workflow_run_steps` throughout execution, allowing the UI to show each state transition without a refresh.

`llm_call` resolves a currently supported Gemini model at runtime, retries transient 429/5xx errors once, and uses a clearly marked stub result if no key is configured, the provider is unavailable, or the configured 20-second deadline is reached. `http_request` also retries a transient failure once. `conditional_branch` evaluates the prior output. An `approval_gate` writes `waiting_approval` to both the run and step record and stops the engine. An authorized approval calls `approve-workflow-step`, records `approved_by`/`approved_at`, and resumes the remaining steps. Successful completion increments the organization quota.

Manual execution is available from the UI. An external system can start a run through `webhook-trigger`. Scheduled and database-event handlers exist in the repository, but their cron/event configuration must be enabled and tested in Nhost/Hasura Console before they can be claimed as deployed triggers.

## Reviewer walkthrough

1. Create Org A and Org B with different users. Add an editor or viewer only to Org A.
2. In Org A, create a workflow with `llm_call`, `http_request`, `conditional_branch`, and `approval_gate`; run it manually and through the webhook endpoint.
3. Observe live progress in the browser. At `waiting_approval`, approve it with an Org A owner/editor and verify that the remaining steps complete and quota increases.
4. Sign in as the Org B user. Org A must not appear in the organization selector or workflow list. Using the Org B session, attempt an Org A workflow UUID against the read query, `trigger-workflow-run`, and `approve-workflow-step`. Reads must return no Org A rows; trigger and approval calls must return `403 Forbidden`.

This separates tenant access control from step-level authorization while preserving an auditable, real-time execution history.
