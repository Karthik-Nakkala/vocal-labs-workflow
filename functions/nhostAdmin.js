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
