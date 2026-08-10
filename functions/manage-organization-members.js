import { getAdminClient, getAuthenticatedUserId } from "./nhostAdmin.js";

const VALID_ROLES = new Set(["owner", "editor", "viewer"]);

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

async function query(client, query, variables) {
  const response = await client.graphql.request({ query, variables });
  return response.body.data;
}

async function getMembership(client, orgId, userId) {
  const data = await query(client, `
    query GetMembership($org_id: uuid!, $user_id: uuid!) {
      organization_members(where: { org_id: { _eq: $org_id }, user_id: { _eq: $user_id } }) {
        id user_id role
      }
    }`, { org_id: orgId, user_id: userId });
  return data?.organization_members?.[0] || null;
}

async function listMembers(client, orgId) {
  const membersData = await query(client, `
    query ListMembers($org_id: uuid!) {
      organization_members(where: { org_id: { _eq: $org_id } }) { id user_id role }
    }`, { org_id: orgId });
  const members = membersData?.organization_members || [];
  if (!members.length) return [];

  const usersData = await query(client, `
    query ListMemberUsers($ids: [uuid!]!) {
      users(where: { id: { _in: $ids } }) { id email displayName }
    }`, { ids: members.map((member) => member.user_id) });
  const users = new Map((usersData?.users || []).map((user) => [user.id, user]));
  return members.map((member) => ({ ...member, user: users.get(member.user_id) || null }));
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  try {
    const { action, org_id: orgId, email, role, member_id: memberId } = req.body || {};
    if (!action || !orgId) return res.status(400).json({ message: "action and org_id are required" });

    const userId = await getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized: Missing user session" });

    const client = getAdminClient();
    const callerMembership = await getMembership(client, orgId, userId);
    if (!callerMembership) return res.status(403).json({ message: "You are not a member of this organization" });

    if (action === "list") return res.status(200).json({ members: await listMembers(client, orgId) });
    if (callerMembership.role !== "owner") {
      return res.status(403).json({ message: "Only organization owners can manage members" });
    }

    if (action === "invite") {
      const normalizedEmail = email?.trim().toLowerCase();
      if (!normalizedEmail || !VALID_ROLES.has(role)) {
        return res.status(400).json({ message: "A registered email and valid role are required" });
      }
      const userData = await query(client, `
        query FindUser($email: citext!) { users(where: { email: { _eq: $email } }) { id email } }
      `, { email: normalizedEmail });
      const invitedUser = userData?.users?.[0];
      if (!invitedUser) return res.status(404).json({ message: "No registered user was found with that email" });
      if (await getMembership(client, orgId, invitedUser.id)) {
        return res.status(409).json({ message: "This user is already a member of the organization" });
      }
      await query(client, `
        mutation AddMember($org_id: uuid!, $user_id: uuid!, $role: String!) {
          insert_organization_members_one(object: { org_id: $org_id, user_id: $user_id, role: $role }) { id }
        }`, { org_id: orgId, user_id: invitedUser.id, role });
      return res.status(200).json({ message: "Member added", members: await listMembers(client, orgId) });
    }

    if (!memberId) return res.status(400).json({ message: "member_id is required" });
    const memberData = await query(client, `
      query GetMember($id: uuid!, $org_id: uuid!) {
        organization_members(where: { id: { _eq: $id }, org_id: { _eq: $org_id } }) { id user_id }
      }`, { id: memberId, org_id: orgId });
    const target = memberData?.organization_members?.[0];
    if (!target) return res.status(404).json({ message: "Member not found in this organization" });
    if (target.user_id === userId) return res.status(400).json({ message: "You cannot remove yourself or change your own role" });

    if (action === "remove") {
      await query(client, `mutation RemoveMember($id: uuid!) { delete_organization_members_by_pk(id: $id) { id } }`, { id: memberId });
      return res.status(200).json({ message: "Member removed", members: await listMembers(client, orgId) });
    }
    if (action === "update_role") {
      if (!VALID_ROLES.has(role)) return res.status(400).json({ message: "A valid role is required" });
      await query(client, `
        mutation UpdateMember($id: uuid!, $role: String!) {
          update_organization_members_by_pk(pk_columns: { id: $id }, _set: { role: $role }) { id }
        }`, { id: memberId, role });
      return res.status(200).json({ message: "Member role updated", members: await listMembers(client, orgId) });
    }
    return res.status(400).json({ message: "Unsupported action" });
  } catch (error) {
    console.error("Manage organization members error:", error);
    return res.status(500).json({ message: error.message || "Unable to manage organization members" });
  }
}
