import { useState } from "react";
import { gqlRequest } from "../lib/nhost";
import { devStore } from "../lib/devStore";

export default function OrgManager({ onClose, onOrgCreated }) {
  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!orgName.trim()) return;

    setLoading(true);
    setError(null);

    const savedUserStr = localStorage.getItem("nhost_user");
    const savedUser = savedUserStr ? JSON.parse(savedUserStr) : null;
    const userId = savedUser?.id || savedUser?.email || "00000000-0000-0000-0000-000000000001";

    try {
      const createOrgRes = await gqlRequest(`
        mutation CreateOrgTable($name: String!) {
          insert_organizations_one(object: { name: $name }) {
            id
            name
          }
        }
      `, { name: orgName.trim() });

      const newOrg = createOrgRes?.insert_organizations_one;
      if (!newOrg) {
        throw new Error("Failed to insert organization record into Hasura database.");
      }

      try {
        await gqlRequest(`
          mutation AddOwnerMember($org_id: uuid!, $user_id: uuid!) {
            insert_organization_members_one(object: {
              org_id: $org_id,
              user_id: $user_id,
              role: "owner"
            }) {
              id
              role
            }
          }
        `, {
          org_id: newOrg.id,
          user_id: userId.includes("-") ? userId : "00000000-0000-0000-0000-000000000001"
        });
      } catch (memberErr) {
        console.warn("Member insert note:", memberErr.message);
      }

      onOrgCreated(newOrg);
      onClose();
    } catch (err) {
      console.error("Create Org Error:", err);
      setError(err.message || "Failed to create organization in Hasura database.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.7)",
      backdropFilter: "blur(6px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 100,
      padding: "1rem"
    }}>
      <div className="glass-card" style={{ width: "100%", maxWidth: "450px", padding: "2rem" }}>
        <h3 style={{ fontSize: "1.3rem", marginBottom: "0.5rem" }}>Create New Organization</h3>
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
          You will automatically become the <strong>Owner</strong> of this organization.
        </p>

        {error && (
          <div style={{
            background: "rgba(239, 68, 68, 0.15)",
            border: "1px solid rgba(239, 68, 68, 0.4)",
            color: "#fca5a5",
            padding: "0.75rem",
            borderRadius: "8px",
            fontSize: "0.85rem",
            marginBottom: "1rem"
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.4rem", color: "var(--text-muted)" }}>
              Organization Name
            </label>
            <input
              type="text"
              className="input-field"
              placeholder="e.g. Acme Corp (Org A)"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "0.5rem" }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? "Creating..." : "Create Organization"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
