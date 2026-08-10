import { createClient } from "@nhost/nhost-js";

const NHOST_SUBDOMAIN = "mbknwfytawrylgsgbfxw";
const NHOST_REGION = "ap-south-1";

export const NHOST_GRAPHQL_URL = `https://${NHOST_SUBDOMAIN}.hasura.${NHOST_REGION}.nhost.run/v1/graphql`;
export const NHOST_FUNCTIONS_URL = `https://${NHOST_SUBDOMAIN}.functions.${NHOST_REGION}.nhost.run/v1`;

// Remove credentials left by the previous hand-managed authentication flow.
// Nhost owns its session under its own storage key; no admin credential belongs
// in a browser.
if (typeof window !== "undefined") {
  localStorage.removeItem("nhost_token");
  localStorage.removeItem("nhost_admin_secret");
}

// createClient includes the browser session middleware: it persists the Nhost
// session, refreshes it when needed, and attaches its access token to requests.
export const nhost = createClient({
  subdomain: NHOST_SUBDOMAIN,
  region: NHOST_REGION,
  graphqlUrl: NHOST_GRAPHQL_URL,
  functionsUrl: NHOST_FUNCTIONS_URL,
});

/** Execute a GraphQL request with the authenticated Nhost session. */
export async function gqlRequest(query, variables = {}) {
  const response = await nhost.graphql.request({ query, variables });
  const json = response.body;

  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join(", "));
  }

  return json.data;
}

/** Call a Nhost serverless function with the authenticated Nhost session. */
export async function callFunction(path, body = {}) {
  const response = await nhost.functions.post(path, body);
  return response.body;
}

/**
 * Open a GraphQL WebSocket subscription using the active SDK-managed session.
 * The SDK currently provides HTTP clients only, so this keeps the existing
 * graphql-transport-ws implementation while sourcing its token from the SDK.
 */
export function gqlSubscribe(query, variables, onNext, onError) {
  const wsUrl = NHOST_GRAPHQL_URL.replace(/^http/, "ws");
  const token = nhost.getUserSession()?.accessToken;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  let ws;
  const subId = "sub_" + Math.random().toString(36).substring(2, 9);
  let unsubscribed = false;

  try {
    ws = new WebSocket(wsUrl, "graphql-transport-ws");

    ws.onopen = () => {
      if (unsubscribed) return;
      ws.send(JSON.stringify({ type: "connection_init", payload: { headers } }));
    };

    ws.onmessage = (event) => {
      if (unsubscribed) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === "connection_ack") {
          ws.send(JSON.stringify({
            id: subId,
            type: "subscribe",
            payload: { query, variables },
          }));
        } else if (message.type === "next" && message.id === subId) {
          if (message.payload?.errors) {
            onError?.(new Error(message.payload.errors[0]?.message || "Subscription error"));
          } else if (message.payload?.data) {
            onNext?.(message.payload.data);
          }
        } else if (message.type === "error") {
          onError?.(new Error(message.payload?.message || "Subscription error"));
        }
      } catch (error) {
        onError?.(error);
      }
    };

    ws.onerror = (error) => onError?.(error);
  } catch (error) {
    onError?.(error);
  }

  return () => {
    unsubscribed = true;
    try {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ id: subId, type: "complete" }));
        ws.close();
      }
    } catch {
      // The connection has already been closed.
    }
  };
}
