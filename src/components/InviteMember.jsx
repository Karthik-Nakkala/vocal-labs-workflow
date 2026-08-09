import { useState, useEffect } from "react";
import { gqlRequest } from "../lib/nhost";

const ROLE_OPTIONS = [
  {
    value: "owner",
    label: "Owner",
    desc: "Full control — manage members, create/edit/delete workflows, trigger runs",
    color: "#a855f7",
  },
  {
    value: "editor",
    label: "Editor",
    desc: "Create and edit workflows, trigger runs — cannot manage members",
    color: "#6366f1",
  },
  {
    value: "viewer",
    label: "Viewer",
    desc: "Read-only — can view workflows and run history, cannot trigger runs",
    color: "#94a3b8",
  },
];

export default function InviteMember({ currentOrg, userRole, onClose, onMembersUpdated }) {
  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("editor");
  const [inviting, setInviting] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const isOwner = userRole === "owner";

  useEffect(() => {
    if (currentOrg?.id) {
      fetchMembers();
    }
  }, [currentOrg?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchMembers = async () => {
    setLoadingMembers(true);
    try {
      const data = await gqlRequest(
        `
        query GetOrgMembers($org_id: uuid!) {
          organization_members(where: { org_id: { _eq: $org_id } }) {
            id
            role
            user_id
            user {
              id
              email
              displayName
            }
          }
        }
      `,
        { org_id: currentOrg.id }
      );
      setMembers(data?.organization_members || []);
    } catch (err) {
      // Fallback if user relation isn't set up — fetch without nested user
      try {
        const data2 = await gqlRequest(
          `
          query GetOrgMembersBasic($org_id: uuid!) {
            organization_members(where: { org_id: { _eq: $org_id } }) {
              id
              role
              user_id
            }
          }
        `,
          { org_id: currentOrg.id }
        );
        setMembers(data2?.organization_members || []);
      } catch (err2) {
        console.error("Fetch members error:", err2.message);
      }
    } finally {
      setLoadingMembers(false);
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    if (!isOwner) {
      setError("Only Owners can invite members.");
      return;
    }

    setInviting(true);
    setError(null);
    setSuccess(null);

    try {
      // Step 1: Look up user by email in auth.users via admin query
      let targetUserId = null;

      try {
        const userLookup = await gqlRequest(
          `
          query LookupUserByEmail($email: citext!) {
            users(where: { email: { _eq: $email } }) {
              id
              email
              displayName
            }
          }
        `,
          { email: inviteEmail.trim().toLowerCase() }
        );

        const foundUser = userLookup?.users?.[0];
        if (foundUser) {
          targetUserId = foundUser.id;
        }
      } catch (lookupErr) {
        console.warn("User lookup note:", lookupErr.message);
      }

      if (!targetUserId) {
        setError(
          `No user found with email "${inviteEmail.trim()}". They must register first, then you can add them as a member.`
        );
        setInviting(false);
        return;
      }

      // Step 2: Check if already a member
      const alreadyMember = members.some((m) => m.user_id === targetUserId);
      if (alreadyMember) {
        setError(`${inviteEmail.trim()} is already a member of ${currentOrg.name}.`);
        setInviting(false);
        return;
      }

      // Step 3: Insert organization_members record
      await gqlRequest(
        `
        mutation InviteMember($org_id: uuid!, $user_id: uuid!, $role: String!) {
          insert_organization_members_one(object: {
            org_id: $org_id,
            user_id: $user_id,
            role: $role
          }) {
            id
            role
          }
        }
      `,
        {
          org_id: currentOrg.id,
          user_id: targetUserId,
          role: inviteRole,
        }
      );

      setSuccess(
        `✓ ${inviteEmail.trim()} added as ${inviteRole} to ${currentOrg.name}`
      );
      setInviteEmail("");
      await fetchMembers();
      if (onMembersUpdated) onMembersUpdated();
    } catch (err) {
      console.error("Invite member error:", err);
      setError(err.message || "Failed to invite member.");
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveMember = async (memberId, memberUserId) => {
    if (!isOwner) {
      setError("Only Owners can remove members.");
      return;
    }

    // Prevent removing yourself
    const savedUser = JSON.parse(localStorage.getItem("nhost_user") || "{}");
    if (memberUserId === savedUser?.id) {
      setError("You cannot remove yourself from the organization.");
      return;
    }

    setRemovingId(memberId);
    setError(null);

    try {
      await gqlRequest(
        `
        mutation RemoveMember($id: uuid!) {
          delete_organization_members_by_pk(id: $id) {
            id
          }
        }
      `,
        { id: memberId }
      );

      await fetchMembers();
      if (onMembersUpdated) onMembersUpdated();
    } catch (err) {
      setError(err.message || "Failed to remove member.");
    } finally {
      setRemovingId(null);
    }
  };

  const handleUpdateRole = async (memberId, newRole) => {
    if (!isOwner) {
      setError("Only Owners can change member roles.");
      return;
    }

    setError(null);
    try {
      await gqlRequest(
        `
        mutation UpdateMemberRole($id: uuid!, $role: String!) {
          update_organization_members_by_pk(
            pk_columns: { id: $id },
            _set: { role: $role }
          ) { id role }
        }
      `,
        { id: memberId, role: newRole }
      );

      await fetchMembers();
      if (onMembersUpdated) onMembersUpdated();
    } catch (err) {
      setError(err.message || "Failed to update role.");
    }
  };

  const roleColor = (role) => {
    const r = ROLE_OPTIONS.find((o) => o.value === role);
    return r?.color || "#94a3b8";
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
        padding: "1rem",
      }}
    >
      <div
        className="glass-card"
        style={{
          width: "100%",
          maxWidth: "600px",
          padding: "2rem",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "1.5rem",
          }}
        >
          <div>
            <h3 style={{ fontSize: "1.3rem" }}>👥 Manage Members</h3>
            <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginTop: "0.2rem" }}>
              {currentOrg?.name}
            </p>
          </div>
          <button className="btn-secondary" onClick={onClose} style={{ padding: "0.4rem 0.8rem" }}>
            ✕ Close
          </button>
        </div>

        {/* Error / Success alerts */}
        {error && (
          <div
            style={{
              background: "rgba(239, 68, 68, 0.12)",
              border: "1px solid rgba(239, 68, 68, 0.4)",
              color: "#fca5a5",
              padding: "0.75rem 1rem",
              borderRadius: "8px",
              marginBottom: "1rem",
              fontSize: "0.875rem",
            }}
          >
            ⛔ {error}
          </div>
        )}
        {success && (
          <div
            style={{
              background: "rgba(34, 197, 94, 0.12)",
              border: "1px solid rgba(34, 197, 94, 0.4)",
              color: "#4ade80",
              padding: "0.75rem 1rem",
              borderRadius: "8px",
              marginBottom: "1rem",
              fontSize: "0.875rem",
            }}
          >
            {success}
          </div>
        )}

        {/* Current Members List */}
        <div style={{ marginBottom: "1.75rem" }}>
          <h4
            style={{
              fontSize: "0.75rem",
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: "0.75rem",
            }}
          >
            Current Members ({members.length})
          </h4>

          {loadingMembers ? (
            <div style={{ color: "var(--text-muted)", fontSize: "0.875rem", padding: "1rem" }}>
              Loading members…
            </div>
          ) : members.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: "0.875rem", padding: "1rem" }}>
              No members found.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              {members.map((m) => {
                const displayEmail = m.user?.email || m.user_id;
                const displayName = m.user?.displayName || null;
                const savedUser = JSON.parse(localStorage.getItem("nhost_user") || "{}");
                const isSelf = m.user_id === savedUser?.id;

                return (
                  <div
                    key={m.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "10px",
                      padding: "0.75rem 1rem",
                      gap: "0.75rem",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: "0" }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: "0.9rem",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {displayName || displayEmail}
                        {isSelf && (
                          <span
                            style={{
                              marginLeft: "0.5rem",
                              fontSize: "0.7rem",
                              color: "var(--text-muted)",
                            }}
                          >
                            (you)
                          </span>
                        )}
                      </div>
                      {displayName && (
                        <div
                          style={{
                            fontSize: "0.75rem",
                            color: "var(--text-muted)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {displayEmail}
                        </div>
                      )}
                    </div>

                    {/* Role selector (owner only, can't change self) */}
                    {isOwner && !isSelf ? (
                      <select
                        className="input-field"
                        value={m.role}
                        onChange={(e) => handleUpdateRole(m.id, e.target.value)}
                        style={{
                          width: "auto",
                          padding: "0.35rem 0.75rem",
                          fontSize: "0.8rem",
                          color: roleColor(m.role),
                          border: `1px solid ${roleColor(m.role)}44`,
                          minWidth: "100px",
                        }}
                      >
                        <option value="owner">Owner</option>
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    ) : (
                      <span
                        style={{
                          fontSize: "0.75rem",
                          padding: "0.3rem 0.75rem",
                          borderRadius: "99px",
                          background: `${roleColor(m.role)}22`,
                          border: `1px solid ${roleColor(m.role)}44`,
                          color: roleColor(m.role),
                          fontWeight: 600,
                          textTransform: "capitalize",
                        }}
                      >
                        {m.role}
                      </span>
                    )}

                    {/* Remove button (owner only, not self) */}
                    {isOwner && !isSelf && (
                      <button
                        className="btn-danger"
                        onClick={() => handleRemoveMember(m.id, m.user_id)}
                        disabled={removingId === m.id}
                        style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }}
                      >
                        {removingId === m.id ? "…" : "Remove"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Invite New Member Form */}
        {isOwner && (
          <div
            style={{
              borderTop: "1px solid var(--border-color)",
              paddingTop: "1.5rem",
            }}
          >
            <h4
              style={{
                fontSize: "0.75rem",
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: "1rem",
              }}
            >
              Add Member by Email
            </h4>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
              The user must already have an account. Enter their email to look them up and assign a role.
            </p>

            <form onSubmit={handleInvite} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.8rem",
                    color: "var(--text-muted)",
                    marginBottom: "0.35rem",
                  }}
                >
                  Email Address
                </label>
                <input
                  type="email"
                  className="input-field"
                  placeholder="user@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.8rem",
                    color: "var(--text-muted)",
                    marginBottom: "0.5rem",
                  }}
                >
                  Role
                </label>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {ROLE_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.75rem",
                        cursor: "pointer",
                        padding: "0.65rem 1rem",
                        borderRadius: "8px",
                        border: `1px solid ${inviteRole === opt.value ? opt.color + "66" : "var(--border-color)"}`,
                        background:
                          inviteRole === opt.value ? `${opt.color}15` : "rgba(255,255,255,0.02)",
                        transition: "all 0.15s",
                      }}
                    >
                      <input
                        type="radio"
                        name="inviteRole"
                        value={opt.value}
                        checked={inviteRole === opt.value}
                        onChange={() => setInviteRole(opt.value)}
                        style={{ accentColor: opt.color }}
                      />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "0.875rem", color: opt.color }}>
                          {opt.label}
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                          {opt.desc}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "0.5rem" }}>
                <button type="button" className="btn-secondary" onClick={onClose} disabled={inviting}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={inviting}>
                  {inviting ? "Adding…" : "Add Member"}
                </button>
              </div>
            </form>
          </div>
        )}

        {!isOwner && (
          <div
            style={{
              borderTop: "1px solid var(--border-color)",
              paddingTop: "1.25rem",
              fontSize: "0.85rem",
              color: "var(--text-muted)",
            }}
          >
            🔒 Only Owners can invite or remove members. Your role: <strong>{userRole}</strong>
          </div>
        )}
      </div>
    </div>
  );
}
