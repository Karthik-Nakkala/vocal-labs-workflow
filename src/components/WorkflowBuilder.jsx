import { useState } from "react";
import { callFunction } from "../lib/nhost";
import { devStore } from "../lib/devStore";

const STEP_TYPES = [
  { type: "llm_call", label: "LLM Call (AI)", desc: "Analyzes prompt or input using real LLM API" },
  { type: "http_request", label: "HTTP Request", desc: "Calls external API endpoints (GET/POST)" },
  { type: "conditional_branch", label: "Conditional Branch", desc: "Routes execution based on rules" },
  { type: "approval_gate", label: "Approval Gate", desc: "Pauses run until Owner/Editor approves" },
  { type: "db_write", label: "DB Write", desc: "Saves state into PostgreSQL database" },
  { type: "notify", label: "Notify Alert", desc: "Dispatches email or team alert notification" }
];

const TRIGGER_TYPES = [
  { type: "manual", label: "Manual", desc: "A member starts the workflow from the app." },
  { type: "webhook", label: "Webhook", desc: "An external system starts the workflow through its webhook URL." },
  { type: "scheduled", label: "Scheduled", desc: "Nhost's configured cron schedule starts the workflow." },
  { type: "db_event", label: "Database event", desc: "A configured Hasura database event starts the workflow." },
];

function triggerDraft(trigger) {
  return {
    clientId: trigger.id || `new-${crypto.randomUUID()}`,
    id: trigger.id || null,
    trigger_type: trigger.trigger_type || "manual",
    configText: JSON.stringify(trigger.config || {}, null, 2),
    dirty: false,
    deleted: false,
  };
}

export default function WorkflowBuilder({ currentOrg, workflowToEdit, onBack, onSaveSuccess }) {
  const isViewer = currentOrg?.membershipRole === "viewer";
  const isOwner = currentOrg?.membershipRole === "owner";
  const [name, setName] = useState(workflowToEdit?.name || "Customer Complaint AI Workflow");
  const [steps, setSteps] = useState(
    workflowToEdit?.workflow_steps || [
      { name: "1. AI Complaint Analysis", type: "llm_call", config: { prompt: "Analyze customer complaint severity and priority" } },
      { name: "2. Fetch Customer CRM Data", type: "http_request", config: { url: "https://jsonplaceholder.typicode.com/users/1", method: "GET" } },
      { name: "3. Check High Priority Rule", type: "conditional_branch", config: { condition: "priority === 'high'" } },
      { name: "4. Manager Approval Gate", type: "approval_gate", config: { note: "Manager approval required for refund action" } }
    ]
  );
  const [triggers, setTriggers] = useState(
    (workflowToEdit?.workflow_triggers || []).map(triggerDraft)
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

  const handleMoveStep = (index, direction) => {
    const destination = index + direction;
    if (destination < 0 || destination >= steps.length) return;
    const reordered = [...steps];
    [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
    setSteps(reordered);
  };

  const handleAddTrigger = () => {
    setTriggers((current) => [...current, triggerDraft({ trigger_type: isOwner ? "webhook" : "manual", config: {} })]);
  };

  const updateTrigger = (clientId, updates) => {
    setTriggers((current) => current.map((trigger) => (
      trigger.clientId === clientId ? { ...trigger, ...updates, dirty: true } : trigger
    )));
  };

  const removeTrigger = (clientId) => {
    setTriggers((current) => current
      .map((trigger) => (trigger.clientId === clientId ? { ...trigger, deleted: true } : trigger))
      .filter((trigger) => trigger.id || !trigger.deleted));
  };

  const handleSaveWorkflow = async () => {
    if (isViewer) {
      setError("Forbidden: Viewers cannot create or edit workflows.");
      return;
    }
    if (!currentOrg?.id) {
      setError("Select an organization before creating a workflow.");
      return;
    }
    if (!name.trim()) return;
    setSaving(true);
    setError(null);

    try {
      const saveResult = await callFunction("/save-workflow", {
        org_id: currentOrg.id,
        workflow_id: workflowToEdit?.id || null,
        name,
        steps,
      });

      const workflowId = saveResult?.id || workflowToEdit?.id;
      if (!workflowId) throw new Error("Workflow saved but no workflow ID was returned.");

      for (const trigger of triggers) {
        if (trigger.deleted && trigger.id) {
          await callFunction("/manage-workflow-trigger", {
            action: "delete", workflow_id: workflowId, trigger_id: trigger.id,
          });
          continue;
        }
        if (trigger.deleted || (trigger.id && !trigger.dirty)) continue;

        let config;
        try {
          config = JSON.parse(trigger.configText || "{}");
        } catch {
          throw new Error(`Trigger configuration for ${trigger.trigger_type} must be valid JSON.`);
        }
        await callFunction("/manage-workflow-trigger", {
          action: trigger.id ? "update" : "create",
          workflow_id: workflowId,
          trigger_id: trigger.id || undefined,
          trigger_type: trigger.trigger_type,
          config,
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
                <div style={{ display: "flex", gap: "0.45rem" }}>
                  <button className="btn-secondary" onClick={() => handleMoveStep(index, -1)} disabled={index === 0} style={{ padding: "0.25rem 0.55rem", fontSize: "0.75rem" }}>
                    ↑ Move up
                  </button>
                  <button className="btn-secondary" onClick={() => handleMoveStep(index, 1)} disabled={index === steps.length - 1} style={{ padding: "0.25rem 0.55rem", fontSize: "0.75rem" }}>
                    ↓ Move down
                  </button>
                  <button className="btn-danger" onClick={() => handleRemoveStep(index)} style={{ padding: "0.25rem 0.6rem", fontSize: "0.75rem" }}>
                    Remove Step
                  </button>
                </div>
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
        {STEP_TYPES.filter((st) => isOwner || !["db_write", "notify"].includes(st.type)).map((st) => (
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

      <div className="glass-card" style={{ padding: "1.5rem", marginTop: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start", marginBottom: "1rem" }}>
          <div>
            <h3 style={{ fontSize: "1.1rem", marginBottom: "0.35rem" }}>Workflow Triggers</h3>
            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Choose how this workflow can start. Save Workflow applies trigger changes too.</p>
          </div>
          {!isViewer && <button type="button" className="btn-secondary" onClick={handleAddTrigger}>+ Add trigger</button>}
        </div>

        {triggers.filter((trigger) => !trigger.deleted).length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No configured triggers yet. Manual runs remain available to owners and editors.</p>
        ) : triggers.filter((trigger) => !trigger.deleted).map((trigger) => {
          const isWebhook = trigger.trigger_type === "webhook";
          const lockedForEditor = isWebhook && !isOwner;
          const triggerInfo = TRIGGER_TYPES.find((item) => item.type === trigger.trigger_type);
          return (
            <div key={trigger.clientId} style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px", padding: "1rem", marginTop: "0.75rem" }}>
              <div style={{ display: "flex", gap: "0.75rem", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                <select
                  className="input-field"
                  value={trigger.trigger_type}
                  disabled={isViewer || lockedForEditor}
                  onChange={(event) => updateTrigger(trigger.clientId, { trigger_type: event.target.value })}
                  style={{ maxWidth: "240px" }}
                >
                  {TRIGGER_TYPES.filter((item) => isOwner || item.type !== "webhook").map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}
                </select>
                {!isViewer && !lockedForEditor && <button type="button" className="btn-danger" onClick={() => removeTrigger(trigger.clientId)} style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }}>Remove trigger</button>}
              </div>
              <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginBottom: "0.6rem" }}>{triggerInfo?.desc}</p>
              {lockedForEditor && <p style={{ color: "#fbbf24", fontSize: "0.8rem", marginBottom: "0.6rem" }}>Only the organization owner can change a webhook trigger.</p>}
              <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.35rem" }}>Trigger configuration (JSON)</label>
              <textarea
                className="input-field"
                value={trigger.configText}
                readOnly={isViewer || lockedForEditor}
                onChange={(event) => updateTrigger(trigger.clientId, { configText: event.target.value })}
                rows={4}
                spellCheck="false"
                style={{ resize: "vertical", fontFamily: "monospace" }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
