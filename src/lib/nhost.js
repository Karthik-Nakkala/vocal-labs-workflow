import { createClient } from "@nhost/nhost-js";

const NHOST_SUBDOMAIN = "mbknwfytawrylgsgbfxw";
const NHOST_REGION = "ap-south-1";

export const NHOST_GRAPHQL_URL = `https://${NHOST_SUBDOMAIN}.hasura.${NHOST_REGION}.nhost.run/v1/graphql`;
export const NHOST_FUNCTIONS_URL = `https://${NHOST_SUBDOMAIN}.functions.${NHOST_REGION}.nhost.run/v1`;

export const nhost = createClient({
  subdomain: NHOST_SUBDOMAIN,
  region: NHOST_REGION,
  graphqlUrl: NHOST_GRAPHQL_URL,
});

/**
 * Execute a GraphQL request against the Hasura endpoint.
 * Attaches the JWT (if valid) or admin secret (if set) as auth headers.
 */
export async function gqlRequest(query, variables = {}) {
  const token = localStorage.getItem("nhost_token");
  const adminSecret = localStorage.getItem("nhost_admin_secret");

  const headers = {
    "Content-Type": "application/json",
  };

  // Only attach Authorization header if token is a valid 3-part JWT
  const isJwt = typeof token === "string" && token.split(".").length === 3;
  if (isJwt) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  if (adminSecret) {
    headers["x-hasura-admin-secret"] = adminSecret;
  }

  const response = await fetch(NHOST_GRAPHQL_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });

  const json = await response.json();

  if (json.errors) {
    const errorMsg = json.errors.map((e) => e.message).join(", ");
    throw new Error(errorMsg);
  }

  return json.data;
}

/**
 * Call a Nhost serverless function by its path.
 * Automatically attaches Bearer token from localStorage.
 * @param {string} path — e.g. "/triggerWorkflowRun"
 * @param {object} body — request body
 */
export async function callFunction(path, body = {}) {
  const token = localStorage.getItem("nhost_token");
  const headers = { "Content-Type": "application/json" };

  const isJwt = typeof token === "string" && token.split(".").length === 3;
  if (isJwt) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${NHOST_FUNCTIONS_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(json.message || `Function call failed with status ${response.status}`);
  }

  return json;
}