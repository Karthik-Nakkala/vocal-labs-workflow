import { runWorkflowEngine } from "./engine.js";
import { getAdminClient } from "./nhostAdmin.js";

/**
 * POST /scheduled-trigger
 *
 * Designed to be called by Nhost's built-in cron scheduler.
 * Configure in Nhost Console → Scheduled Events → add a cron rule pointing
 * to this function's URL.
 *
 * Body (from Nhost cron, or manual invocation):
 *   { "workflow_id": "<uuid>" }           — trigger a specific workflow
 *   {} or omit workflow_id               — trigger ALL workflows with a scheduled trigger
 *
 * This function:
 *   1. Fetches all workflows with trigger_type = 'scheduled' (or the specific one)
 *   2. Checks quota for each org
 *   3. Creates a workflow_run and fires engine.js for each
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-nhost-webhook-secret");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed — use POST" });
  }

  try {
    const nhostAdmin = getAdminClient();
    const body = req.body || {};
    const specificWorkflowId = body.workflow_id || null;

    // ── Fetch workflows with a scheduled trigger ──────────────────────────────
    let workflowsToRun = [];

    if (specificWorkflowId) {
      // Run just one specific workflow
      const wfRes = await nhostAdmin.graphql.request({
        query: `
          query GetScheduledWorkflow($id: uuid!) {
            workflows_by_pk(id: $id) {
              id
              name
              org_id
              organization {
                id
                calls_used
                max_quota
              }
            }
          }
        `,
        variables: { id: specificWorkflowId },
      });
      const wf = wfRes.body.data?.workflows_by_pk;
      if (wf) workflowsToRun = [wf];
    } else {
      // Fetch all workflows that have a scheduled trigger configured
      const allRes = await nhostAdmin.graphql.request({
        query: `
          query GetAllScheduledWorkflows {
            workflow_triggers(where: { trigger_type: { _eq: "scheduled" } }) {
              id
              workflow_id
              config
              workflow {
                id
                name
                org_id
                organization {
                  id
                  calls_used
                  max_quota
                }
              }
            }
          }
        `,
      });
      workflowsToRun = (allRes.body.data?.workflow_triggers || [])
        .map((t) => t.workflow)
        .filter(Boolean);
    }

    if (workflowsToRun.length === 0) {
      return res.status(200).json({
        message: "No scheduled workflows found to run",
        triggered: 0,
      });
    }

    const results = [];
    const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

    for (const wf of workflowsToRun) {
      const org = wf.organization;
      const callsUsed = org?.calls_used || 0;
      const maxQuota = org?.max_quota || 100;

      if (callsUsed >= maxQuota) {
        results.push({
          workflow_id: wf.id,
          workflow_name: wf.name,
          status: "skipped_quota_exhausted",
          calls_used: callsUsed,
          max_quota: maxQuota,
        });
        continue;
      }

      try {
        const insertRunRes = await nhostAdmin.graphql.request({
          query: `
            mutation CreateScheduledRun($workflow_id: uuid!, $user_id: uuid!, $input: jsonb) {
              insert_workflow_runs_one(object: {
                workflow_id: $workflow_id,
                user_id: $user_id,
                status: "pending",
                input: $input
              }) {
                id
                status
              }
            }
          `,
          variables: {
            workflow_id: wf.id,
            user_id: SYSTEM_USER_ID,
            input: {
              triggeredBy: "scheduled_cron",
              triggeredAt: new Date().toISOString(),
              workflowName: wf.name,
            },
          },
        });

        const run = insertRunRes.body.data?.insert_workflow_runs_one;
        if (!run) throw new Error("Run creation returned null");

        // Fire engine async
        runWorkflowEngine({ runId: run.id }).catch((err) => {
          console.error(`[scheduled-trigger] Engine error for workflow ${wf.id}:`, err.message);
        });

        results.push({
          workflow_id: wf.id,
          workflow_name: wf.name,
          run_id: run.id,
          status: "triggered",
        });
      } catch (err) {
        console.error(`[scheduled-trigger] Failed to trigger workflow ${wf.id}:`, err.message);
        results.push({
          workflow_id: wf.id,
          workflow_name: wf.name,
          status: "error",
          error: err.message,
        });
      }
    }

    const triggeredCount = results.filter((r) => r.status === "triggered").length;

    return res.status(200).json({
      message: `Scheduled trigger complete — ${triggeredCount}/${workflowsToRun.length} workflows started`,
      triggered: triggeredCount,
      results,
    });
  } catch (error) {
    console.error("[scheduled-trigger] Unhandled error:", error);
    return res.status(500).json({ message: error.message || "Internal server error" });
  }
}
