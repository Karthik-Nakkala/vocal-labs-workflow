import { useState } from "react";

export default function Navbar({ user, organizations, currentOrg, onSelectOrg, onOpenCreateOrgModal, onOpenMembersModal, onLogout }) {
  const [showAdminSecretModal, setShowAdminSecretModal] = useState(false);
  const [secretInput, setSecretInput] = useState(() => localStorage.getItem("nhost_admin_secret") || "");
  const [hasAdminSecret, setHasAdminSecret] = useState(() => Boolean(localStorage.getItem("nhost_admin_secret")));

  const handleSaveSecret = (e) => {
    e.preventDefault();
    if (secretInput.trim()) {
      localStorage.setItem("nhost_admin_secret", secretInput.trim());
      setHasAdminSecret(true);
    } else {
      localStorage.removeItem("nhost_admin_secret");
      setHasAdminSecret(false);
    }
    setShowAdminSecretModal(false);
    window.location.reload();
  };

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

        {/* Organization Switcher */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Active Org:</span>
          <select
            className="input-field"
            value={currentOrg?.id || ""}
            onChange={(e) => {
              const selected = organizations.find((o) => o.id === e.target.value);
              if (selected) onSelectOrg(selected);
            }}
            style={{ width: "auto", minWidth: "180px", padding: "0.4rem 0.8rem", fontSize: "0.9rem" }}
          >
            {organizations.length === 0 ? (
              <option value="">No Organization</option>
            ) : (
              organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name} ({org.membershipRole || "member"})
                </option>
              ))
            )}
          </select>

          <button className="btn-secondary" onClick={onOpenCreateOrgModal} style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem" }}>
            + Create Org
          </button>

          {currentOrg && (
            <button
              className="btn-secondary"
              onClick={onOpenMembersModal}
              style={{
                padding: "0.4rem 0.8rem",
                fontSize: "0.85rem",
                borderColor: "rgba(226, 55, 68, 0.4)",
                color: "#ff8a95",
              }}
            >
              👥 Members
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        {/* Usage Quota Indicator */}
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
          <span>📊 Quota:</span>
          <strong>{currentOrg?.calls_used ?? 0} / {currentOrg?.max_quota ?? 100} calls</strong>
        </div>

        {/* Nhost DB Connection Status Badge */}
        <button
          className="btn-secondary"
          onClick={() => setShowAdminSecretModal(true)}
          style={{
            fontSize: "0.75rem",
            padding: "0.35rem 0.75rem",
            borderColor: hasAdminSecret ? "rgba(34, 197, 94, 0.4)" : "rgba(245, 158, 11, 0.4)",
            color: hasAdminSecret ? "#4ade80" : "#fbbf24"
          }}
        >
          {hasAdminSecret ? "🟢 Nhost Admin API Connected" : "🔑 Set Nhost Admin Key"}
        </button>

        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "0.85rem", fontWeight: "600" }}>{user?.email}</div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Role: {currentOrg?.membershipRole || "N/A"}</div>
        </div>

        <button className="btn-secondary" onClick={onLogout} style={{ padding: "0.4rem 0.9rem", fontSize: "0.85rem" }}>
          Logout
        </button>
      </div>

      {/* Admin Secret Configuration Modal */}
      {showAdminSecretModal && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.7)",
          backdropFilter: "blur(6px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 200,
          padding: "1rem"
        }}>
          <div className="glass-card" style={{ width: "100%", maxWidth: "480px", padding: "2rem" }}>
            <h3 style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>🔑 Connect Direct to Nhost Hasura Database</h3>
            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "1.25rem", lineHeight: "1.4" }}>
              Enter your <strong>Nhost Hasura Admin Secret</strong> (found in your Nhost Console &rarr; Project Settings &rarr; Secrets / Hasura) so all mutations write live rows directly into your Nhost PostgreSQL cloud tables.
            </p>

            <form onSubmit={handleSaveSecret} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.3rem" }}>
                  Hasura Admin Secret (x-hasura-admin-secret)
                </label>
                <input
                  type="password"
                  className="input-field"
                  placeholder="Paste Admin Secret key..."
                  value={secretInput}
                  onChange={(e) => setSecretInput(e.target.value)}
                  autoFocus
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "0.5rem" }}>
                <button type="button" className="btn-secondary" onClick={() => setShowAdminSecretModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Save & Connect API
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </header>
  );
}
