import { getAdminClient, getAuthenticatedUserId } from "./nhostAdmin.js";

const TRIGGER_TYPES = new Set(["manual", "webhook", "scheduled", "db_event"]);

function setCorsHeaders(req, res) {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "https://vocal-labs-workflow.vercel.app")
    .split(",").map((value) => value.trim()).filter(Boolean);
  const origin = req.headers?.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

async function execute(client, query, variables) {
  const response = await client.graphql.request({ query, variables });
  return response.body.data;
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  try {
    const requestBody = req.body || {};
    const actionInput = requestBody.session_variables ? requestBody.input || {} : requestBody;
    const { action, workflow_id: workflowId, trigger_id: triggerId, trigger_type: triggerType, config = {} } = actionInput;
    if (!action || !workflowId) return res.status(400).json({ message: "action and workflow_id are required" });
    if (["create", "update"].includes(action) && !TRIGGER_TYPES.has(triggerType)) {
      return res.status(400).json({ message: "Unsupported trigger type" });
    }

    const userId = requestBody.session_variables?.["x-hasura-user-id"] || await getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized: Missing user session" });
    const client = getAdminClient();
    const accessData = await execute(client, `
      query TriggerAccess($workflow_id: uuid!, $user_id: uuid!) {
        workflows_by_pk(id: $workflow_id) {
          id
          organization { organisation_members(where: { user_id: { _eq: $user_id } }) { role } }
        }
      }`, { workflow_id: workflowId, user_id: userId });
    const role = accessData?.workflows_by_pk?.organization?.organisation_members?.[0]?.role;
    if (!role || !["owner", "editor"].includes(role)) {
      return res.status(403).json({ message: "Only an owner or editor in this organization can manage triggers" });
    }

    const existingData = triggerId ? await execute(client, `
      query ExistingTrigger($id: uuid!, $workflow_id: uuid!) {
        workflow_triggers(where: { id: { _eq: $id }, workflow_id: { _eq: $workflow_id } }) { id trigger_type }
      }`, { id: triggerId, workflow_id: workflowId }) : null;
    const existingTrigger = existingData?.workflow_triggers?.[0];
    if (triggerId && !existingTrigger) return res.status(404).json({ message: "Trigger not found in this workflow" });

    const sensitiveType = triggerType || existingTrigger?.trigger_type;
    if (sensitiveType === "webhook" && role !== "owner") {
      return res.status(403).json({ message: "Only an owner can add, edit, or remove a webhook trigger" });
    }

    if (action === "create") {
      const data = await execute(client, `
        mutation CreateTrigger($workflow_id: uuid!, $trigger_type: String!, $config: jsonb!) {
          insert_workflow_triggers_one(object: { workflow_id: $workflow_id, trigger_type: $trigger_type, config: $config }) { id }
        }`, { workflow_id: workflowId, trigger_type: triggerType, config });
      return res.status(200).json({ id: data?.insert_workflow_triggers_one?.id });
    }
    if (action === "update") {
      await execute(client, `
        mutation UpdateTrigger($id: uuid!, $trigger_type: String!, $config: jsonb!) {
          update_workflow_triggers_by_pk(pk_columns: { id: $id }, _set: { trigger_type: $trigger_type, config: $config }) { id }
        }`, { id: triggerId, trigger_type: triggerType, config });
      return res.status(200).json({ id: triggerId });
    }
    if (action === "delete") {
      await execute(client, `mutation DeleteTrigger($id: uuid!) { delete_workflow_triggers_by_pk(id: $id) { id } }`, { id: triggerId });
      return res.status(200).json({ id: triggerId });
    }
    return res.status(400).json({ message: "Unsupported action" });
  } catch (error) {
    console.error("Manage workflow trigger error:", error);
    return res.status(500).json({ message: error.message || "Unable to manage workflow trigger" });
  }
}
