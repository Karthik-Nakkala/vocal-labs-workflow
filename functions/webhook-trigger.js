import { runWorkflowEngine } from "./engine.js";
import { getAdminClient } from "./nhostAdmin.js";

// Optional webhook secret — set WEBHOOK_SECRET env var in Nhost console to require it.
// If not set, the endpoint is open (acceptable for demo / assignment review).
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || null;

/**
 * POST /webhook-trigger
 *
 * Body (JSON):
 *   { "workflow_id": "<uuid>", "input": { ...any payload... } }
 *
 * Headers (optional):
 *   x-webhook-secret: <WEBHOOK_SECRET env value>
 *
 * This handler is designed to be called by EXTERNAL systems (CI pipelines,
 * other services, Zapier, etc.) that don't have a Hasura JWT.
 * It runs as admin, verifies the workflow exists, checks quota, then fires
 * the engine — the same path as the manual trigger but without user-session auth.
 *
 * For the Hasura Event Trigger variant, Hasura will POST here automatically
 * when a watched table row changes — the body will contain event.data.new etc.
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-webhook-secret");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed — use POST" });
  }

  // ── Optional secret check ────────────────────────────────────────────────────
  if (WEBHOOK_SECRET) {
    const providedSecret = req.headers["x-webhook-secret"];
    if (providedSecret !== WEBHOOK_SECRET) {
      return res.status(401).json({ message: "Unauthorized: Invalid webhook secret" });
    }
  }

  try {
    const body = req.body || {};

    // Support both direct calls AND Hasura Event Trigger payloads
    // Hasura Event Trigger sends: { event: { data: { new: { ... } } }, table: {...} }
    let workflowId, runInput, triggeredBy;

    if (body.event && body.table) {
      // ── Hasura Database Event Trigger payload ────────────────────────────────
      // The event trigger is configured to watch a table (e.g. workflow_triggers)
      // and fire this function when a row with trigger_type='event' is inserted.
      const eventData = body.event?.data?.new || {};
      workflowId = eventData.workflow_id || body.workflow_id;
      runInput = {
        triggeredBy: "database_event",
        eventTable: body.table?.name || "unknown",
        eventOp: body.event?.op || "INSERT",
        eventData,
        triggeredAt: new Date().toISOString(),
      };
      triggeredBy = "database_event";
    } else {
      // ── Direct webhook call ──────────────────────────────────────────────────
      workflowId = body.workflow_id;
      runInput = body.input || {};
      runInput.triggeredBy = "webhook";
      runInput.triggeredAt = new Date().toISOString();
      triggeredBy = "webhook";
    }

    if (!workflowId) {
      return res.status(400).json({
        message: "workflow_id is required in the request body",
        example: { workflow_id: "<uuid>", input: { key: "value" } },
      });
    }

    const nhostAdmin = getAdminClient();

    // ── Verify workflow exists and check quota ───────────────────────────────
    const workflowRes = await nhostAdmin.graphql.request({
      query: `
        query CheckWebhookWorkflow($workflow_id: uuid!) {
          workflows_by_pk(id: $workflow_id) {
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
      variables: { workflow_id: workflowId },
    });

    const workflow = workflowRes.body.data?.workflows_by_pk;
    if (!workflow) {
      return res.status(404).json({
        message: `Workflow not found: ${workflowId}`,
      });
    }

    const org = workflow.organization;
    const callsUsed = org?.calls_used || 0;
    const maxQuota = org?.max_quota || 100;

    if (callsUsed >= maxQuota) {
      return res.status(429).json({
        message: `Quota exhausted for org: ${callsUsed}/${maxQuota} calls used.`,
        calls_used: callsUsed,
        max_quota: maxQuota,
      });
    }

    // ── Create workflow_run record ────────────────────────────────────────────
    // Use a zero-UUID for user_id since this is a system-triggered run
    const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

    const insertRunRes = await nhostAdmin.graphql.request({
      query: `
        mutation CreateWebhookRun($workflow_id: uuid!, $user_id: uuid!, $input: jsonb, $output: jsonb!) {
          insert_workflow_runs_one(object: {
            workflow_id: $workflow_id,
            user_id: $user_id,
            status: "pending",
            input: $input,
            output: $output
          }) {
            id
            status
          }
        }
      `,
      variables: {
        workflow_id: workflowId,
        user_id: SYSTEM_USER_ID,
        input: runInput,
        output: {},
      },
    });

    const run = insertRunRes.body.data?.insert_workflow_runs_one;
    if (!run) {
      return res.status(500).json({ message: "Failed to create workflow run record" });
    }

    // Keep the invocation alive so the engine is not terminated after this
    // endpoint sends its response.
    await runWorkflowEngine({ runId: run.id });

    return res.status(200).json({
      run_id: run.id,
      workflow_id: workflowId,
      workflow_name: workflow.name,
      status: "pending",
      triggered_by: triggeredBy,
      message: "Workflow run initiated via webhook. Subscribe to step_runs for live progress.",
    });
  } catch (error) {
    console.error("[webhook-trigger] Unhandled error:", error);
    return res.status(500).json({ message: error.message || "Internal server error" });
  }
}
