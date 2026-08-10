export default function Navbar({ user, organizations, currentOrg, onSelectOrg, onOpenCreateOrgModal, onOpenMembersModal, onLogout }) {
  return (
    <header className="glass-card" style={{
      borderRadius: "0 0 16px 16px",
      padding: "1rem 2rem",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: "2rem"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "2rem" }}>
        <h2 style={{ fontSize: "1.4rem", fontWeight: "700", background: "var(--accent-gradient)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          VocalLabs Workflow
        </h2>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Active Org:</span>
          <select
            className="input-field"
            value={currentOrg?.id || ""}
            onChange={(event) => {
              const selected = organizations.find((org) => org.id === event.target.value);
              if (selected) onSelectOrg(selected);
            }}
            style={{ width: "auto", minWidth: "180px", padding: "0.4rem 0.8rem", fontSize: "0.9rem" }}
          >
            {organizations.length === 0 ? (
              <option value="">No Organization</option>
            ) : organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name} ({org.membershipRole || "member"})
              </option>
            ))}
          </select>

          <button className="btn-secondary" onClick={onOpenCreateOrgModal} style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem" }}>
            + Create Org
          </button>

          {currentOrg && (
            <button
              className="btn-secondary"
              onClick={onOpenMembersModal}
              style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem", borderColor: "rgba(226, 55, 68, 0.4)", color: "#ff8a95" }}
            >
              Members
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <div style={{
          fontSize: "0.75rem",
          padding: "0.35rem 0.75rem",
          borderRadius: "8px",
          background: "rgba(226, 55, 68, 0.12)",
          border: "1px solid rgba(226, 55, 68, 0.3)",
          color: "#ff8a95",
          display: "flex",
          alignItems: "center",
          gap: "0.4rem"
        }}>
          <span>Quota:</span>
          <strong>{currentOrg?.calls_used ?? 0} / {currentOrg?.max_quota ?? 100} calls</strong>
        </div>

        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "0.85rem", fontWeight: "600" }}>{user?.email}</div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Role: {currentOrg?.membershipRole || "N/A"}</div>
        </div>

        <button className="btn-secondary" onClick={onLogout} style={{ padding: "0.4rem 0.9rem", fontSize: "0.85rem" }}>
          Logout
        </button>
      </div>
    </header>
  );
}
