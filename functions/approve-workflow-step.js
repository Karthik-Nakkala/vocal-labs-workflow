import { runWorkflowEngine } from "./engine.js";
import { getAdminClient, getAuthenticatedUserId } from "./nhostAdmin.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const requestBody = req.body || {};
    // Direct Function calls use the operation fields at the root. Hasura
    // Actions are the only requests that wrap them in input.
    const actionInput = requestBody.session_variables ? requestBody.input || {} : requestBody;
    const userId =
      requestBody.session_variables?.["x-hasura-user-id"] ||
      (await getAuthenticatedUserId(req));

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized: Missing user session" });
    }

    const { step_run_id, approved } = actionInput;
    if (!step_run_id) {
      return res.status(400).json({ message: "step_run_id is required" });
    }

    const nhostAdmin = getAdminClient();

    // ── Fetch step run + full org membership chain ────────────────────────────
    const stepRunDataRes = await nhostAdmin.graphql.request({
      query: `
        query GetStepRunDetails($step_run_id: uuid!) {
          workflow_run_steps_by_pk(id: $step_run_id) {
            id
            run_id
            step_id
            status
            workflow_step {
              step_order
              type
            }
            workflow_run {
              id
              status
              workflow {
                id
                org_id
                organization {
                  organisation_members {
                    user_id
                    role
                  }
                }
              }
            }
          }
        }
      `,
      variables: { step_run_id },
    });

    const stepRun = stepRunDataRes.body.data?.workflow_run_steps_by_pk;
    if (!stepRun) {
      return res.status(404).json({ message: "Step run record not found" });
    }

    // ── Guard: only approval_gate steps can be approved ───────────────────────
    if (stepRun.workflow_step?.type !== "approval_gate") {
      return res.status(400).json({
        message: `Step is type "${stepRun.workflow_step?.type}" — only approval_gate steps can be approved`,
      });
    }

    // ── Guard: run must be paused waiting for approval ────────────────────────
    const runStatus = stepRun.workflow_run?.status;
    if (runStatus !== "waiting_approval") {
      return res.status(409).json({
        message: `Run is currently "${runStatus}" — cannot approve a step that is not waiting_approval`,
      });
    }

    // ── Layer 2: Role check — MUST be done in Action handler, not DB perms ────
    const orgMembers = stepRun.workflow_run?.workflow?.organization?.organisation_members || [];
    const userMember = orgMembers.find((m) => m.user_id === userId);

    if (!userMember) {
      return res.status(403).json({
        message: "Forbidden: You are not a member of this workflow's organization",
      });
    }

    if (!["owner", "editor"].includes(userMember.role)) {
      return res.status(403).json({
        message: `Forbidden: Role '${userMember.role}' cannot approve workflow gates. Owner or Editor required.`,
        yourRole: userMember.role,
      });
    }

    const runId = stepRun.run_id;
    const currentStepOrder = stepRun.workflow_step?.step_order || 0;

    if (approved) {
      // ── Mark step approved ─────────────────────────────────────────────────
      await nhostAdmin.graphql.request({
        query: `
          mutation MarkStepApproved(
            $step_run_id: uuid!,
            $output: jsonb,
            $approved_by: uuid,
            $approved_at: timestamptz
          ) {
            update_workflow_run_steps_by_pk(
              pk_columns: { id: $step_run_id },
              _set: {
                status: "completed",
                output: $output,
                approved_by: $approved_by,
                approved_at: $approved_at
              }
            ) { id }
          }
        `,
        variables: {
          step_run_id,
          output: {
            approved: true,
            approvedByUserId: userId,
            approvedByRole: userMember.role,
            approvedAt: new Date().toISOString(),
          },
          approved_by: userId,
          approved_at: new Date().toISOString(),
        },
      }).catch(async () => {
        // If approved_by / approved_at columns don't exist yet, fall back gracefully
        await nhostAdmin.graphql.request({
          query: `
            mutation MarkStepApprovedFallback($step_run_id: uuid!, $output: jsonb) {
              update_workflow_run_steps_by_pk(
                pk_columns: { id: $step_run_id },
                _set: { status: "completed", output: $output }
              ) { id }
            }
          `,
          variables: {
            step_run_id,
            output: {
              approved: true,
              approvedByUserId: userId,
              approvedByRole: userMember.role,
              approvedAt: new Date().toISOString(),
            },
          },
        });
      });

      // ── Resume engine from the step AFTER the approval gate ───────────────
      runWorkflowEngine({ runId, startFromStepOrder: currentStepOrder + 1 }).catch((err) => {
        console.error("[approve] Async engine resume error:", err.message);
      });

      return res.status(200).json({
        step_run_id,
        run_id: runId,
        status: "approved_and_resumed",
        approvedByRole: userMember.role,
        message: "Approval accepted. Workflow execution resuming from next step.",
      });
    } else {
      // ── Reject: mark step + run failed ────────────────────────────────────
      await nhostAdmin.graphql.request({
        query: `
          mutation RejectStepAndRun($step_run_id: uuid!, $runId: uuid!, $output: jsonb) {
            update_workflow_run_steps_by_pk(
              pk_columns: { id: $step_run_id },
              _set: { status: "failed", output: $output }
            ) { id }
            update_workflow_runs_by_pk(
              pk_columns: { id: $runId },
              _set: { status: "failed" }
            ) { id }
          }
        `,
        variables: {
          step_run_id,
          runId,
          output: {
            approved: false,
            rejectedByUserId: userId,
            rejectedByRole: userMember.role,
            rejectedAt: new Date().toISOString(),
          },
        },
      });

      return res.status(200).json({
        step_run_id,
        run_id: runId,
        status: "rejected",
        message: "Approval rejected. Workflow run marked as failed.",
      });
    }
  } catch (error) {
    console.error("[approve] Unhandled error:", error);
    return res.status(500).json({ message: error.message || "Internal server error" });
  }
}
