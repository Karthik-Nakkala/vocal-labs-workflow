import { getAdminClient } from "./nhostAdmin.js";

export default async function handler(req, res) {
  // Allow CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const { input, session_variables } = req.body || {};
    const userId = session_variables ? session_variables["x-hasura-user-id"] : null;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized: Missing user session" });
    }

    const { name } = input || {};
    if (!name || name.trim() === "") {
      return res.status(400).json({ message: "Organization name is required" });
    }

    const nhostAdmin = getAdminClient();

    // 1. Create Organization
    const createOrgRes = await nhostAdmin.graphql.request({
      query: `
        mutation CreateOrg($name: String!) {
          insert_organizations_one(object: { name: $name }) {
            id
            name
          }
        }
      `,
      variables: { name }
    });

    if (!createOrgRes.body.data?.insert_organizations_one) {
      console.error("Create Org Error: Nhost returned no organization");
      return res.status(400).json({ message: "Failed to create organization" });
    }

    const org = createOrgRes.body.data.insert_organizations_one;

    // 2. Add creator as 'owner' in organization_members
    await nhostAdmin.graphql.request({
      query: `
        mutation AddOwner($org_id: uuid!, $user_id: uuid!) {
          insert_organization_members_one(object: {
            org_id: $org_id,
            user_id: $user_id,
            role: "owner"
          }) {
            id
            role
          }
        }
      `,
      variables: { org_id: org.id, user_id: userId }
    });


    return res.status(200).json({
      id: org.id,
      name: org.name
    });
  } catch (error) {
    console.error("Handler error:", error);
    return res.status(500).json({ message: error.message || "Internal server error" });
  }
}
