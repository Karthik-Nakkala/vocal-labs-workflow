import { createServerClient, withAdminSession } from "@nhost/nhost-js";

const NHOST_SUBDOMAIN = process.env.NHOST_SUBDOMAIN || "mbknwfytawrylgsgbfxw";
const NHOST_REGION = process.env.NHOST_REGION || "ap-south-1";
const NHOST_GRAPHQL_URL =
  process.env.NHOST_GRAPHQL_URL ||
  `https://${NHOST_SUBDOMAIN}.hasura.${NHOST_REGION}.nhost.run/v1/graphql`;

// Functions do not need a persisted user session. This in-memory adapter is
// required by the Nhost v4 server client and prevents session leakage between
// function invocations.
const serverSessionStorage = {
  get: () => null,
  set: () => {},
  remove: () => {},
};

function createBaseServerClient() {
  return createServerClient({
    subdomain: NHOST_SUBDOMAIN,
    region: NHOST_REGION,
    graphqlUrl: NHOST_GRAPHQL_URL,
    storage: serverSessionStorage,
  });
}

/**
 * Validates an incoming Nhost bearer token and returns its user id. This is
 * needed for direct Function calls; Hasura Action calls provide the same id
 * in session_variables instead.
 */
export async function getAuthenticatedUserId(req) {
  const authorization = req.headers?.authorization || req.headers?.Authorization;
  if (!authorization?.startsWith("Bearer ")) return null;

  const response = await createBaseServerClient().auth.getUser({
    headers: { Authorization: authorization },
  });

  return response.body?.id || null;
}

/**
 * Creates a server-only Hasura admin client. The secret remains in the
 * function environment and is applied by Nhost's supported v4 middleware.
 */
export function getAdminClient() {
  const adminSecret = process.env.NHOST_ADMIN_SECRET;
  if (!adminSecret) {
    throw new Error("NHOST_ADMIN_SECRET is required for server-side workflow operations");
  }

  return createServerClient({
    subdomain: NHOST_SUBDOMAIN,
    region: NHOST_REGION,
    graphqlUrl: NHOST_GRAPHQL_URL,
    storage: serverSessionStorage,
    configure: [withAdminSession({ adminSecret })],
  });
}
