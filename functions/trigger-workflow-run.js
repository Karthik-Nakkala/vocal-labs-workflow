import { getAdminClient, getAuthenticatedUserId } from "./nhostAdmin.js";

export default async function handler(req, res) {
  const origin = req.headers?.origin;
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "https://vocal-labs-workflow.vercel.app").split(",").map((value) => value.trim());
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const requestBody = req.body || {};
    // Direct Function calls use { workflow_id, input }, while Hasura Actions
    // use { input, session_variables }. Only unwrap the latter.
    const actionInput = requestBody.session_variables ? requestBody.input || {} : requestBody;
    const userId =
      requestBody.session_variables?.["x-hasura-user-id"] ||
      (await getAuthenticatedUserId(req));

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized: Missing user session" });
    }

    const { workflow_id, input: runInput } = actionInput;
    if (!workflow_id) {
      return res.status(400).json({ message: "workflow_id is required" });
    }

    const nhostAdmin = getAdminClient();

    // ── Layer 1: Verify caller belongs to org AND has owner/editor role ───────
    const workflowCheckRes = await nhostAdmin.graphql.request({
      query: `
        query CheckWorkflowOrg($workflow_id: uuid!, $user_id: uuid!) {
          workflows_by_pk(id: $workflow_id) {
            id
            org_id
            organization {
              id
              calls_used
              max_quota
              organisation_members(where: { user_id: { _eq: $user_id } }) {
                id
                role
              }
            }
          }
        }
      `,
      variables: { workflow_id, user_id: userId },
    });

    const workflow = workflowCheckRes.body.data?.workflows_by_pk;
    if (!workflow) {
      return res.status(403).json({ message: "Forbidden: Workflow not found or no access" });
    }

    const userMemberships = workflow.organization?.organisation_members || [];
    if (userMemberships.length === 0) {
      return res.status(403).json({
        message: "Forbidden: You are not a member of this workflow's organization",
      });
    }

    const userRole = userMemberships[0].role;
    if (!["owner", "editor"].includes(userRole)) {
      return res.status(403).json({
        message: `Forbidden: Role '${userRole}' cannot trigger workflow runs. Owner or Editor required.`,
      });
    }

    // ── Quota check ───────────────────────────────────────────────────────────
    const org = workflow.organization;
    const callsUsed = org?.calls_used || 0;
    const maxQuota = org?.max_quota || 100;

    if (callsUsed >= maxQuota) {
      return res.status(429).json({
        message: `Quota exhausted: ${callsUsed}/${maxQuota} calls used this period. Upgrade your plan or wait for quota reset.`,
        calls_used: callsUsed,
        max_quota: maxQuota,
      });
    }

    // ── Create workflow_run record ─────────────────────────────────────────────
    const insertRunRes = await nhostAdmin.graphql.request({
      query: `
        mutation CreateRun($workflow_id: uuid!, $user_id: uuid!, $input: jsonb, $output: jsonb!) {
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
        workflow_id,
        user_id: userId,
        input: runInput || { triggeredAt: new Date().toISOString(), triggeredBy: userId },
        output: {},
      },
    });

    const run = insertRunRes.body.data?.insert_workflow_runs_one;
    if (!run) {
      return res.status(500).json({ message: "Failed to create workflow run record" });
    }

    // The authenticated /engine request is started by the client after this
    // response. Separating it from run creation lets the UI subscribe first,
    // while the engine retains a complete serverless invocation lifetime.

    return res.status(202).json({
      run_id: run.id,
      status: "pending",
      message: "Workflow run initiated. Subscribe to step progress for live updates.",
    });
  } catch (error) {
    console.error("[trigger] Unhandled error:", error);
    return res.status(500).json({ message: error.message || "Internal server error" });
  }
}
