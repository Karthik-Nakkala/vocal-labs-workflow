import { getAdminClient, getAuthenticatedUserId } from "./nhostAdmin.js";

const STEP_TYPES = new Set([
  "llm_call",
  "http_request",
  "conditional_branch",
  "approval_gate",
  "db_write",
  "notify",
]);
const OWNER_ONLY_STEP_TYPES = new Set(["db_write", "notify"]);

function setCorsHeaders(req, res) {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "https://vocal-labs-workflow.vercel.app")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
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
    const { org_id: orgId, workflow_id: workflowId, name, steps } = actionInput;
    if (!orgId || !name?.trim() || !Array.isArray(steps)) {
      return res.status(400).json({ message: "org_id, name, and steps are required" });
    }
    if (steps.some((step) => !STEP_TYPES.has(step?.type))) {
      return res.status(400).json({ message: "Workflow contains an unsupported step type" });
    }

    const userId = requestBody.session_variables?.["x-hasura-user-id"] || await getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized: Missing user session" });

    const client = getAdminClient();
    const membershipData = await execute(client, `
      query CheckMembership($org_id: uuid!, $user_id: uuid!) {
        organization_members(where: { org_id: { _eq: $org_id }, user_id: { _eq: $user_id } }) { role }
      }`, { org_id: orgId, user_id: userId });
    const role = membershipData?.organization_members?.[0]?.role;
    if (!role || !["owner", "editor"].includes(role)) {
      return res.status(403).json({ message: "Only an owner or editor in this organization can save workflows" });
    }

    const ownerOnlyStep = steps.find((step) => OWNER_ONLY_STEP_TYPES.has(step.type));
    if (ownerOnlyStep && role !== "owner") {
      return res.status(403).json({
        message: `Only an owner can add or edit a ${ownerOnlyStep.type} step`,
      });
    }

    let savedWorkflowId = workflowId;
    if (workflowId) {
      const existingData = await execute(client, `
        query CheckWorkflow($id: uuid!) { workflows_by_pk(id: $id) { id org_id } }`, { id: workflowId });
      const existingWorkflow = existingData?.workflows_by_pk;
      if (!existingWorkflow || existingWorkflow.org_id !== orgId) {
        return res.status(403).json({ message: "Workflow not found in this organization" });
      }

      await execute(client, `
        mutation UpdateWorkflow($id: uuid!, $name: String!) {
          update_workflows_by_pk(pk_columns: { id: $id }, _set: { name: $name }) { id }
        }`, { id: workflowId, name: name.trim() });
      await execute(client, `
        mutation DeleteSteps($workflow_id: uuid!) {
          delete_workflow_steps(where: { workflow_id: { _eq: $workflow_id } }) { affected_rows }
        }`, { workflow_id: workflowId });
    } else {
      const createdData = await execute(client, `
        mutation CreateWorkflow($org_id: uuid!, $name: String!) {
          insert_workflows_one(object: { org_id: $org_id, name: $name }) { id }
        }`, { org_id: orgId, name: name.trim() });
      savedWorkflowId = createdData?.insert_workflows_one?.id;
      if (!savedWorkflowId) throw new Error("Unable to create workflow");
    }

    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      await execute(client, `
        mutation CreateStep($workflow_id: uuid!, $name: String!, $type: String!, $config: jsonb!, $step_order: Int!) {
          insert_workflow_steps_one(object: {
            workflow_id: $workflow_id, name: $name, type: $type, config: $config, step_order: $step_order
          }) { id }
        }`, {
        workflow_id: savedWorkflowId,
        name: String(step.name || `${index + 1}. ${step.type}`),
        type: step.type,
        config: step.config || {},
        step_order: index + 1,
      });
    }

    return res.status(200).json({ id: savedWorkflowId, message: "Workflow saved" });
  } catch (error) {
    console.error("Save workflow error:", error);
    return res.status(500).json({ message: error.message || "Unable to save workflow" });
  }
}
