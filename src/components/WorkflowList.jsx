import { useState, useEffect } from "react";
import { gqlRequest } from "../lib/nhost";
import { devStore } from "../lib/devStore";

export default function WorkflowList({ currentOrg, onSelectWorkflow, onCreateNewWorkflow, onRunWorkflow }) {
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!currentOrg?.id) return;
    fetchWorkflows();
  }, [currentOrg?.id]);

  const fetchWorkflows = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await gqlRequest(`
        query GetWorkflows($org_id: uuid!) {
          workflows(where: { org_id: { _eq: $org_id } }) {
            id
            name
            org_id
            workflow_steps(order_by: { step_order: asc }) {
              id
              name
              type
              step_order
            }
            workflow_runs(order_by: { id: desc }, limit: 5) {
              id
              status
              user_id
            }
          }
        }
      `, { org_id: currentOrg.id });

      setWorkflows(data?.workflows || []);
    } catch (err) {
      console.error("Fetch workflows error:", err.message);
      setError(err.message || "Failed to load workflows from Hasura API");
    } finally {
      setLoading(false);
    }
  };

  if (!currentOrg) {
    return (
      <div className="glass-card" style={{ padding: "3rem", textAlign: "center", maxWidth: "600px", margin: "0 auto" }}>
        <h3>No Active Organization Selected</h3>
        <p style={{ color: "var(--text-muted)", marginTop: "0.5rem" }}>
          Please create or select an organization from the top navigation bar to get started.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "0 1rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <div>
          <h2 style={{ fontSize: "1.6rem" }}>Workflows for {currentOrg.name}</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
            Build, execute, and monitor AI agent automation workflows.
          </p>
        </div>

        {currentOrg.membershipRole === "viewer" ? (
          <span className="badge badge-pending" style={{ fontSize: "0.85rem", padding: "0.5rem 0.85rem" }}>
            🔒 Viewer Mode (Read-Only)
          </span>
        ) : (
          <button className="btn-primary" onClick={onCreateNewWorkflow}>
            + New Workflow
          </button>
        )}
      </div>

      {error && (
        <div style={{
          background: "rgba(239, 68, 68, 0.15)",
          border: "1px solid rgba(239, 68, 68, 0.4)",
          color: "#fca5a5",
          padding: "0.75rem",
          borderRadius: "8px",
          marginBottom: "1.5rem"
        }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "var(--text-muted)" }}>
          Loading workflows...
        </div>
      ) : workflows.length === 0 ? (
        <div className="glass-card" style={{ padding: "3rem", textAlign: "center" }}>
          <h4 style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>No workflows created yet</h4>
          <p style={{ color: "var(--text-muted)", marginBottom: "1.5rem", fontSize: "0.9rem" }}>
            Create your first workflow to automate LLM calls, HTTP APIs, and human approval gates.
          </p>
          {currentOrg.membershipRole !== "viewer" && (
            <button className="btn-primary" onClick={onCreateNewWorkflow}>
              + Create First Workflow
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "1.5rem" }}>
          {workflows.map((wf) => {
            const stepsCount = wf.workflow_steps?.length || 0;
            const lastRun = wf.workflow_runs?.[0];
            const isViewer = currentOrg.membershipRole === "viewer";

            return (
              <div key={wf.id} className="glass-card" style={{ padding: "1.5rem", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.75rem" }}>
                    <h3 style={{ fontSize: "1.2rem", fontWeight: "600" }}>{wf.name}</h3>
                    {lastRun && (
                      <span className={`badge badge-${lastRun.status}`}>
                        {lastRun.status}
                      </span>
                    )}
                  </div>

                  <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                    {stepsCount} step{stepsCount !== 1 ? "s" : ""}:{" "}
                    {wf.workflow_steps?.map((s) => s.type).join(" → ") || "No steps configured"}
                  </p>

                  <div style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    background: "rgba(255,255,255,0.04)",
                    padding: "0.4rem 0.6rem",
                    borderRadius: "6px",
                    fontFamily: "monospace",
                    marginBottom: "1rem"
                  }}>
                    ⚡ Triggers: Manual, Webhook (`/webhook-trigger`)
                  </div>
                </div>

                <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
                  <button className="btn-secondary" style={{ flex: 1 }} onClick={() => onSelectWorkflow(wf)}>
                    {isViewer ? "View Steps" : "Edit Workflow"}
                  </button>
                  
                  {!isViewer ? (
                    <button className="btn-primary" style={{ flex: 1, justifyContent: "center" }} onClick={() => onRunWorkflow(wf)}>
                      ▶ Run Workflow
                    </button>
                  ) : (
                    <button className="btn-secondary" disabled style={{ flex: 1, justifyContent: "center", opacity: 0.5, cursor: "not-allowed" }}>
                      🔒 Viewer Restricted
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
