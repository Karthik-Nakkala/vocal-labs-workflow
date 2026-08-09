import { useState } from "react";
import { gqlRequest } from "../lib/nhost";
import { devStore } from "../lib/devStore";

const STEP_TYPES = [
  { type: "llm_call", label: "LLM Call (AI)", desc: "Analyzes prompt or input using real LLM API" },
  { type: "http_request", label: "HTTP Request", desc: "Calls external API endpoints (GET/POST)" },
  { type: "conditional_branch", label: "Conditional Branch", desc: "Routes execution based on rules" },
  { type: "approval_gate", label: "Approval Gate", desc: "Pauses run until Owner/Editor approves" },
  { type: "db_write", label: "DB Write", desc: "Saves state into PostgreSQL database" },
  { type: "notify", label: "Notify Alert", desc: "Dispatches email or team alert notification" }
];

export default function WorkflowBuilder({ currentOrg, workflowToEdit, onBack, onSaveSuccess }) {
  const isViewer = currentOrg?.membershipRole === "viewer";
  const [name, setName] = useState(workflowToEdit?.name || "Customer Complaint AI Workflow");
  const [steps, setSteps] = useState(
    workflowToEdit?.workflow_steps || [
      { name: "1. AI Complaint Analysis", type: "llm_call", config: { prompt: "Analyze customer complaint severity and priority" } },
      { name: "2. Fetch Customer CRM Data", type: "http_request", config: { url: "https://jsonplaceholder.typicode.com/users/1", method: "GET" } },
      { name: "3. Check High Priority Rule", type: "conditional_branch", config: { condition: "priority === 'high'" } },
      { name: "4. Manager Approval Gate", type: "approval_gate", config: { note: "Manager approval required for refund action" } }
    ]
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleAddStep = (typeObj) => {
    const newStep = {
      name: `${steps.length + 1}. ${typeObj.label}`,
      type: typeObj.type,
      config: typeObj.type === "http_request" ? { url: "https://jsonplaceholder.typicode.com/todos/1", method: "GET" } : {}
    };
    setSteps([...steps, newStep]);
  };

  const handleRemoveStep = (index) => {
    setSteps(steps.filter((_, i) => i !== index));
  };

  const handleStepNameChange = (index, val) => {
    const updated = [...steps];
    updated[index].name = val;
    setSteps(updated);
  };

  const handleSaveWorkflow = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);

    try {
      let workflowId = workflowToEdit?.id;

      if (!workflowId) {
        const wfRes = await gqlRequest(`
          mutation CreateWf($org_id: uuid!, $name: String!) {
            insert_workflows_one(object: { org_id: $org_id, name: $name }) {
              id
            }
          }
        `, { org_id: currentOrg.id, name });
        workflowId = wfRes.insert_workflows_one.id;
      } else {
        await gqlRequest(`
          mutation UpdateWf($id: uuid!, $name: String!) {
            update_workflows_by_pk(pk_columns: { id: $id }, _set: { name: $name }) {
              id
            }
          }
        `, { id: workflowId, name });

        await gqlRequest(`
          mutation DeleteOldSteps($workflow_id: uuid!) {
            delete_workflow_steps(where: { workflow_id: { _eq: $workflow_id } }) {
              affected_rows
            }
          }
        `, { workflow_id: workflowId });
      }

      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        await gqlRequest(`
          mutation InsertStep($workflow_id: uuid!, $name: String!, $type: String!, $config: jsonb, $step_order: Int!) {
            insert_workflow_steps_one(object: {
              workflow_id: $workflow_id,
              name: $name,
              type: $type,
              config: $config,
              step_order: $step_order
            }) {
              id
            }
          }
        `, {
          workflow_id: workflowId,
          name: s.name,
          type: s.type,
          config: s.config || {},
          step_order: i + 1
        });
      }

      onSaveSuccess();
    } catch (err) {
      console.error("Save workflow Error:", err);
      setError(err.message || "Failed to save workflow into Hasura database.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "0 1rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <button className="btn-secondary" onClick={onBack}>
            ← Back
          </button>
          <h2 style={{ fontSize: "1.5rem" }}>
            {workflowToEdit ? (isViewer ? "View Workflow" : "Edit Workflow") : "Create New Workflow"}
          </h2>
        </div>

        {!isViewer && (
          <button className="btn-primary" onClick={handleSaveWorkflow} disabled={saving}>
            {saving ? "Saving..." : "Save Workflow"}
          </button>
        )}

        {isViewer && (
          <span
            style={{
              fontSize: "0.8rem",
              padding: "0.4rem 0.9rem",
              borderRadius: "8px",
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              color: "#fca5a5",
            }}
          >
            🔒 Read-Only — Viewer role
          </span>
        )}
      </div>

      {error && (
        <div style={{ background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.4)", color: "#fca5a5", padding: "0.75rem", borderRadius: "8px", marginBottom: "1.5rem" }}>
          {error}
        </div>
      )}

      {/* Workflow Settings Card */}
      <div className="glass-card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
        <label style={{ display: "block", fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.4rem" }}>
          Workflow Name
        </label>
        <input
          type="text"
          className="input-field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Complaint Resolution Workflow"
        />
      </div>

      {/* Step Sequence Container */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h3 style={{ fontSize: "1.2rem", marginBottom: "1rem" }}>Workflow Steps Sequence</h3>

        {steps.map((step, index) => (
          <div key={index} className="glass-card" style={{ padding: "1.25rem", marginBottom: "1rem", borderLeft: "4px solid var(--accent-primary)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <span className="badge badge-pending">Order #{index + 1}</span>
                <span className="badge badge-running" style={{ textTransform: "none" }}>{step.type}</span>
              </div>

              {!isViewer && (
                <button className="btn-danger" onClick={() => handleRemoveStep(index)} style={{ padding: "0.25rem 0.6rem", fontSize: "0.75rem" }}>
                  Remove Step
                </button>
              )}
            </div>

            <div>
              <input
                type="text"
                className="input-field"
                value={step.name}
                onChange={(e) => handleStepNameChange(index, e.target.value)}
                style={{ fontWeight: "600" }}
                readOnly={isViewer}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Add Step Picker — hidden for viewers */}
      {!isViewer && (
        <div className="glass-card" style={{ padding: "1.5rem" }}>
          <h4 style={{ fontSize: "1rem", marginBottom: "1rem" }}>+ Add Next Step</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "0.75rem" }}>
            {STEP_TYPES.map((st) => (
              <button
                key={st.type}
                type="button"
                className="btn-secondary"
                onClick={() => handleAddStep(st)}
                style={{ textAlign: "left", flexDirection: "column", alignItems: "flex-start", padding: "0.85rem" }}
              >
                <div style={{ fontWeight: "600", fontSize: "0.9rem" }}>{st.label}</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>{st.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
