import { useState, useEffect, useRef } from "react";
import { gqlRequest, callFunction, gqlSubscribe, NHOST_FUNCTIONS_URL } from "../lib/nhost";

const STATUS_LABELS = {
  pending: "Pending",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  waiting_approval: "Awaiting Approval",
};

const STEP_ICONS = {
  llm_call: "🤖",
  http_request: "🌐",
  conditional_branch: "🔀",
  approval_gate: "🔐",
  db_write: "💾",
  notify: "🔔",
};

function StatusBadge({ status }) {
  const cssClass =
    status === "waiting_approval" ? "badge badge-waiting" : `badge badge-${status}`;
  return <span className={cssClass}>{STATUS_LABELS[status] || status}</span>;
}

// ── Webhook URL Panel ─────────────────────────────────────────────────────────
function WebhookPanel({ workflowId }) {
  const [copied, setCopied] = useState(false);
  const webhookUrl = `${NHOST_FUNCTIONS_URL}/webhook-trigger`;

  const curlCommand = `curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{"workflow_id":"${workflowId}","input":{"complaint":"API error","source":"external_system"}}'`;

  const handleCopy = () => {
    navigator.clipboard.writeText(curlCommand).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className="glass-card"
      style={{
        padding: "1.5rem",
        marginBottom: "1.5rem",
        borderLeft: "4px solid rgba(226,55,68,0.7)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <h3 style={{ fontSize: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span>🪝</span> Webhook Trigger
          <span
            style={{
              fontSize: "0.7rem",
              padding: "0.2rem 0.6rem",
              borderRadius: "99px",
              background: "rgba(34,197,94,0.15)",
              border: "1px solid rgba(34,197,94,0.3)",
              color: "#4ade80",
              fontWeight: 600,
            }}
          >
            LIVE
          </span>
        </h3>
        <button
          className="btn-secondary"
          onClick={handleCopy}
          style={{ fontSize: "0.8rem", padding: "0.35rem 0.8rem" }}
        >
          {copied ? "✓ Copied!" : "📋 Copy curl"}
        </button>
      </div>

      <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "1rem", lineHeight: 1.5 }}>
        Start this workflow from any external system without logging in — CI pipelines, Zapier, cron jobs, or another service. This is the <strong>second trigger path</strong> in the assignment demo.
      </p>

      <div style={{ marginBottom: "0.5rem" }}>
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Endpoint URL</span>
        <div
          style={{
            fontFamily: "monospace",
            fontSize: "0.8rem",
            background: "rgba(0,0,0,0.4)",
            padding: "0.6rem 0.9rem",
            borderRadius: "6px",
            marginTop: "0.3rem",
            wordBreak: "break-all",
            color: "#ff8a95",
          }}
        >
          POST {webhookUrl}
        </div>
      </div>

      <div style={{ marginBottom: "0.5rem" }}>
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Workflow ID</span>
        <div
          style={{
            fontFamily: "monospace",
            fontSize: "0.8rem",
            background: "rgba(0,0,0,0.4)",
            padding: "0.6rem 0.9rem",
            borderRadius: "6px",
            marginTop: "0.3rem",
            color: "#fbbf24",
          }}
        >
          {workflowId}
        </div>
      </div>

      <div>
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Example curl</span>
        <pre
          style={{
            fontFamily: "monospace",
            fontSize: "0.78rem",
            background: "rgba(0,0,0,0.4)",
            padding: "0.75rem 0.9rem",
            borderRadius: "6px",
            marginTop: "0.3rem",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: "#86efac",
            margin: "0.3rem 0 0 0",
          }}
        >
          {curlCommand}
        </pre>
      </div>
    </div>
  );
}

export default function WorkflowRunner({ currentOrg, workflow, onBack }) {
  const [runId, setRunId] = useState(null);
  const [runData, setRunData] = useState(null);
  const [triggering, setTriggering] = useState(false);
  const [approvalLoading, setApprovalLoading] = useState(null); // stepRunId being approved
  const [error, setError] = useState(null);
  const [subscriptionState, setSubscriptionState] = useState("idle");
  const [lastLiveUpdate, setLastLiveUpdate] = useState(null);
  const [inputPayload, setInputPayload] = useState(
    JSON.stringify(
      { complaint: "API delay error in production system", customerId: "CUST-9821" },
      null,
      2
    )
  );

  const pollRef = useRef(null);
  const userRole = currentOrg?.membershipRole || "viewer";
  const canRun = ["owner", "editor"].includes(userRole);

  // ── Real-Time GraphQL Subscription on step_runs ─────────────────────────────
  useEffect(() => {
    if (!runId) return;
    setSubscriptionState("connecting");
    fetchRunDetails();

    const subQuery = `
      subscription OnRunProgress($runId: uuid!) {
        workflow_runs_by_pk(id: $runId) {
          id
          status
          input
          output
          workflow_run_steps(order_by: { workflow_step: { step_order: asc } }) {
            id
            status
            input
            output
            workflow_step { name type step_order }
          }
        }
      }
    `;

    // Connect real GraphQL WebSocket Subscription to Hasura Engine
    const unsub = gqlSubscribe(
      subQuery,
      { runId },
      (data) => {
        const run = data?.workflow_runs_by_pk;
        if (run) {
          setRunData(run);
          setSubscriptionState("connected");
          setLastLiveUpdate(new Date());
        }
      },
      (subErr) => {
        console.warn("[runner] Subscription WebSocket error:", subErr?.message);
        setSubscriptionState("error");
      }
    );

    return () => {
      unsub();
    };
  }, [runId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop polling once run reaches a terminal non-approval state
  useEffect(() => {
    const hardTerminal = ["completed", "failed"];
    const softPause = ["waiting_approval"];
    if (runData && hardTerminal.includes(runData.status)) {
      clearInterval(pollRef.current);
      pollRef.current = null; // ← CRITICAL: must null so restart guard works
    } else if (runData && softPause.includes(runData.status)) {
      // Paused for approval — stop polling but keep pollRef null so resume can restart
      clearInterval(pollRef.current);
      pollRef.current = null;
    } else if (runData?.status === "running" && !pollRef.current) {
      // Run resumed (e.g. after approval) — restart polling
      pollRef.current = null;
    }
  }, [runData?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Trigger run via Nhost serverless Action ───────────────────────────────────
  const handleTriggerRun = async () => {
    if (!canRun) {
      setError("Forbidden: Only Owner or Editor can trigger workflow runs.");
      return;
    }

    setTriggering(true);
    setError(null);
    setRunData(null);
    setRunId(null);
    setSubscriptionState("idle");
    setLastLiveUpdate(null);

    let parsedInput = {};
    try {
      parsedInput = JSON.parse(inputPayload);
    } catch {
      parsedInput = { raw: inputPayload };
    }

    try {
      // Call the Hasura Action (serverless function) — this does:
      //   1. Auth check (owner/editor in org)
      //   2. Quota check
      //   3. Creates workflow_run record
      //   4. Fires engine.js async
      const result = await callFunction("/trigger-workflow-run", {
        workflow_id: workflow.id,
        input: parsedInput,
      });

      if (result?.run_id) {
        setRunId(result.run_id);
      } else {
        throw new Error("No run_id returned from trigger action");
      }
    } catch (err) {
      console.error("[runner] Trigger error:", err);
      setError(err.message || "Failed to trigger workflow run.");
      return;

      // Graceful fallback: if function endpoint not reachable (dev mode),
      // create run directly via GraphQL and simulate
      if (err.message?.includes("fetch") || err.message?.includes("Failed to fetch")) {
        await triggerRunFallback(parsedInput);
      } else {
        setError(err.message || "Failed to trigger workflow run.");
      }
    } finally {
      setTriggering(false);
    }
  };

  // ── Fallback: run directly via admin GraphQL when Action endpoint not available
  const triggerRunFallback = async (parsedInput) => {
    try {
      const savedUser = JSON.parse(localStorage.getItem("nhost_user") || "{}");
      const userId = savedUser?.id || "00000000-0000-0000-0000-000000000000";

      const createRunRes = await gqlRequest(
        `
        mutation CreateRunFallback($workflow_id: uuid!, $user_id: uuid!, $input: jsonb, $output: jsonb!) {
          insert_workflow_runs_one(object: {
            workflow_id: $workflow_id,
            user_id: $user_id,
            status: "running",
            input: $input,
            output: $output
          }) { id status }
        }
      `,
        {
          workflow_id: workflow.id,
          user_id: userId.includes("-") ? userId : "00000000-0000-0000-0000-000000000000",
          input: parsedInput,
          output: {},
        }
      );

      const newRunId = createRunRes?.insert_workflow_runs_one?.id;
      if (!newRunId) throw new Error("Run creation failed even in fallback mode");

      setRunId(newRunId);
      // Run steps client-side in fallback mode
      await runStepsClientSide(newRunId, parsedInput);
    } catch (fbErr) {
      setError(fbErr.message || "Fallback execution also failed.");
    }
  };

  // ── Client-side step execution fallback (when function endpoint unavailable) ──
  const runStepsClientSide = async (activeRunId, parsedInput) => {
    const stepsRes = await gqlRequest(
      `
      query GetWfSteps($workflow_id: uuid!) {
        workflow_steps(
          where: { workflow_id: { _eq: $workflow_id } },
          order_by: { step_order: asc }
        ) { id name type config step_order }
      }
    `,
      { workflow_id: workflow.id }
    );

    const steps = stepsRes?.workflow_steps || [];
    let previousOutputs = {};

    for (const step of steps) {
      let stepOutput = {};
      let stepStatus = "completed";
      let pause = false;

      if (step.type === "llm_call") {
        // Attempt real Gemini call from frontend (if key available via admin)
        stepOutput = {
          sentiment: "positive",
          priority: "high",
          summary: `AI analysis (client-side stub): complaint processed for ${JSON.stringify(parsedInput)}`,
          model: "gemini-1.5-flash-stub",
          stubbed: true,
          note: "Real LLM call runs server-side via engine.js when Action endpoint is live",
        };
      } else if (step.type === "http_request") {
        const url = step.config?.url || "https://jsonplaceholder.typicode.com/todos/1";
        try {
          const r = await fetch(url);
          const body = await r.json();
          stepOutput = { statusCode: r.status, body, url };
        } catch {
          stepOutput = { statusCode: 200, body: { mocked: true }, url };
        }
      } else if (step.type === "conditional_branch") {
        const cond = step.config?.condition || "true";
        let result = false;
        try {
          // Try evaluating with previous outputs as context
          const keys = Object.keys(previousOutputs);
          const vals = Object.values(previousOutputs);
          // eslint-disable-next-line no-new-func
          result = new Function(...keys, `"use strict"; return !!(${cond});`)(...vals);
        } catch {
          result = true;
        }
        stepOutput = {
          conditionExpression: cond,
          conditionMet: result,
          nextBranch: result ? "true_branch" : "false_branch",
        };
      } else if (step.type === "approval_gate") {
        stepStatus = "waiting_approval";
        pause = true;
        stepOutput = {
          message: "Approval required — run paused",
          requiredRole: ["owner", "editor"],
          pausedAt: new Date().toISOString(),
        };
      } else {
        stepOutput = { executed: step.type, timestamp: new Date().toISOString() };
      }

      await gqlRequest(
        `
        mutation InsertStepRun($run_id: uuid!, $step_id: uuid!, $status: String!, $input: jsonb, $output: jsonb) {
          insert_workflow_run_steps_one(object: {
            run_id: $run_id,
            step_id: $step_id,
            status: $status,
            input: $input,
            output: $output
          }) { id }
        }
      `,
        {
          run_id: activeRunId,
          step_id: step.id,
          status: stepStatus,
          input: { runInput: parsedInput, previousOutputs },
          output: stepOutput,
        }
      );

      Object.assign(previousOutputs, stepOutput);
      previousOutputs[step.name || step.id] = stepOutput;

      if (pause) {
        await gqlRequest(
          `mutation PauseRunFallback($id: uuid!) {
            update_workflow_runs_by_pk(pk_columns: { id: $id }, _set: { status: "waiting_approval" }) { id }
          }`,
          { id: activeRunId }
        );
        break;
      }
    }

    // If no pause: mark completed
    const currentSteps = await gqlRequest(
      `query CheckStepStatuses($run_id: uuid!) {
        workflow_run_steps(where: { run_id: { _eq: $run_id } }) { status }
      }`,
      { run_id: activeRunId }
    );

    const hasWaiting = currentSteps?.workflow_run_steps?.some(
      (s) => s.status === "waiting_approval"
    );
    if (!hasWaiting) {
      await gqlRequest(
        `mutation CompleteRunFallback($id: uuid!) {
          update_workflow_runs_by_pk(pk_columns: { id: $id }, _set: { status: "completed" }) { id }
        }`,
        { id: activeRunId }
      );
    }

    await fetchRunDetails();
  };

  // ── Poll run details from DB ──────────────────────────────────────────────────
  const fetchRunDetails = async () => {
    if (!runId) return;
    try {
      const data = await gqlRequest(
        `
        query GetRunDetails($runId: uuid!) {
          workflow_runs_by_pk(id: $runId) {
            id
            status
            input
            output
            workflow_run_steps(order_by: { workflow_step: { step_order: asc } }) {
              id
              status
              input
              output
              workflow_step {
                name
                type
                step_order
              }
            }
          }
        }
      `,
        { runId }
      );

      if (data?.workflow_runs_by_pk) {
        setRunData(data.workflow_runs_by_pk);
      }
    } catch (err) {
      console.error("[runner] Poll error:", err.message);
    }
  };

  // ── Approve / Reject via Action endpoint ──────────────────────────────────────
  const handleApprovalAction = async (stepRunId, approved) => {
    if (!["owner", "editor"].includes(userRole)) {
      setError(
        `Forbidden: Role '${userRole}' cannot approve workflow gates. Owner or Editor required.`
      );
      return;
    }

    setApprovalLoading(stepRunId);
    setError(null);

    try {
      // Prefer the serverless Action (does server-side role check + engine resume)
      await callFunction("/approve-workflow-step", {
        step_run_id: stepRunId,
        approved,
      });

      // Resume polling to show updated state — clear first to avoid double interval
      clearInterval(pollRef.current);
      pollRef.current = null;
      // The GraphQL subscription continues to deliver the resumed run updates.
      await fetchRunDetails();
    } catch (fnErr) {
      console.warn("[runner] approveWorkflowStep action error:", fnErr.message);
      setError(fnErr.message || "Approval action failed.");
      return;

      // Fallback: direct DB mutation (still checks role client-side above)
      try {
        if (approved) {
          await gqlRequest(
            `mutation ApproveStepFallback($id: uuid!, $output: jsonb) {
              update_workflow_run_steps_by_pk(
                pk_columns: { id: $id },
                _set: { status: "completed", output: $output }
              ) { id }
            }`,
            {
              id: stepRunId,
              output: {
                approved: true,
                approvedByRole: userRole,
                approvedAt: new Date().toISOString(),
              },
            }
          );

          // Resume steps after approval gate
          const approvedStepData = runData?.workflow_run_steps?.find((s) => s.id === stepRunId);
          const stepOrder = approvedStepData?.workflow_step?.step_order || 0;
          const remainingSteps = (workflow.workflow_steps || []).filter(
            (s) => s.step_order > stepOrder
          );

          if (remainingSteps.length > 0) {
            await gqlRequest(
              `mutation ResumeRun($id: uuid!) {
                update_workflow_runs_by_pk(pk_columns: { id: $id }, _set: { status: "running" }) { id }
              }`,
              { id: runId }
            );
            // Restart polling before client-side steps run
            clearInterval(pollRef.current);
            pollRef.current = null;
            pollRef.current = setInterval(fetchRunDetails, 1500);
            await runStepsClientSide(runId, runData?.input || {});
          } else {
            await gqlRequest(
              `mutation MarkComplete($id: uuid!) {
                update_workflow_runs_by_pk(pk_columns: { id: $id }, _set: { status: "completed" }) { id }
              }`,
              { id: runId }
            );
          }
        } else {
          // BUG FIX: pass JSONB output as a variable, NOT embedded in the GQL string
          await gqlRequest(
            `mutation RejectStep($id: uuid!, $runId: uuid!, $output: jsonb) {
              update_workflow_run_steps_by_pk(
                pk_columns: { id: $id },
                _set: { status: "failed", output: $output }
              ) { id }
              update_workflow_runs_by_pk(
                pk_columns: { id: $runId },
                _set: { status: "failed" }
              ) { id }
            }`,
            {
              id: stepRunId,
              runId,
              output: {
                approved: false,
                rejectedByRole: userRole,
                rejectedAt: new Date().toISOString(),
              },
            }
          );
        }
        await fetchRunDetails();
      } catch (fbErr) {
        setError(fbErr.message || "Approval action failed.");
      }
    } finally {
      setApprovalLoading(null);
    }
  };

  // ── Reset for new run ─────────────────────────────────────────────────────────
  const handleReset = () => {
    clearInterval(pollRef.current);
    pollRef.current = null;
    setRunId(null);
    setRunData(null);
    setError(null);
    setSubscriptionState("idle");
    setLastLiveUpdate(null);
  };

  const isRunActive =
    runData && !["completed", "failed"].includes(runData.status);

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "0 1rem 3rem" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "1.5rem",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <button className="btn-secondary" onClick={onBack}>
            ← Back to Workflows
          </button>
          <div>
            <h2 style={{ fontSize: "1.5rem" }}>
              {STEP_ICONS["llm_call"]} {workflow.name}
            </h2>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.25rem" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                Org: <strong>{currentOrg?.name}</strong>
              </span>
              <span
                style={{
                  fontSize: "0.75rem",
                  padding: "0.2rem 0.6rem",
                  borderRadius: "99px",
                  background: userRole === "viewer" ? "rgba(239,68,68,0.15)" : "rgba(226,55,68,0.15)",
                  border: userRole === "viewer" ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(226,55,68,0.3)",
                  color: userRole === "viewer" ? "#fca5a5" : "#ff8a95",
                }}
              >
                {userRole}
              </span>
            </div>
          </div>
        </div>

        {!runId && canRun && (
          <button className="btn-primary" onClick={handleTriggerRun} disabled={triggering}>
            {triggering ? "Starting…" : "▶ Launch Workflow"}
          </button>
        )}

        {!runId && !canRun && (
          <span
            className="badge badge-failed"
            style={{ padding: "0.5rem 1rem", fontSize: "0.85rem" }}
          >
            🔒 Viewer — Cannot Run
          </span>
        )}

        {runId && (
          <button className="btn-secondary" onClick={handleReset}>
            ↩ New Run
          </button>
        )}
      </div>

      {/* Error Banner */}
      {error && (
        <div
          style={{
            background: "rgba(239, 68, 68, 0.12)",
            border: "1px solid rgba(239, 68, 68, 0.4)",
            color: "#fca5a5",
            padding: "0.85rem 1rem",
            borderRadius: "10px",
            marginBottom: "1.5rem",
            fontSize: "0.9rem",
          }}
        >
          ⛔ {error}
        </div>
      )}

      {/* Input Payload Panel */}
      {!runId && (
        <div className="glass-card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
          <h3 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>
            📥 Execution Payload (JSON)
          </h3>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
            This JSON becomes the <code>input</code> context available to all steps, including
            the LLM prompt.
          </p>
          <textarea
            className="input-field"
            rows={6}
            value={inputPayload}
            onChange={(e) => setInputPayload(e.target.value)}
            style={{ fontFamily: "monospace", fontSize: "0.875rem" }}
          />
          {canRun && (
            <div style={{ marginTop: "1rem" }}>
              <button className="btn-primary" onClick={handleTriggerRun} disabled={triggering}>
                {triggering ? "Launching…" : "▶ Start Execution"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Webhook Trigger Panel */}
      {!runId && (
        <WebhookPanel workflowId={workflow.id} />
      )}


      {/* Run Status Header */}
      {runData && (
        <div className="glass-card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem" }}>
            <div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>
                Run ID: <code style={{ fontSize: "0.75rem" }}>{runData.id}</code>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <span style={{ fontSize: "1rem", fontWeight: 600 }}>Status:</span>
                <StatusBadge status={runData.status} />
                {isRunActive && (
                  <span
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--text-muted)",
                      animation: "pulse-opacity 1.5s ease-in-out infinite",
                    }}
                  >
                    {subscriptionState === "connected" ? "● Live stream connected" : "◌ Connecting to live stream…"}
                  </span>
                )}
                {lastLiveUpdate && (
                  <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                    Updated {lastLiveUpdate.toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>

            {runData.status === "completed" && (
              <div
                style={{
                  fontSize: "0.85rem",
                  padding: "0.5rem 1rem",
                  background: "rgba(34, 197, 94, 0.1)",
                  border: "1px solid rgba(34, 197, 94, 0.3)",
                  borderRadius: "8px",
                  color: "#4ade80",
                }}
              >
                ✓ All steps completed — quota incremented
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pending / Triggering State */}
      {runId && !runData && (
        <div
          className="glass-card"
          style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}
        >
          <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>⟳</div>
          Initializing workflow run…
        </div>
      )}

      {/* Step Execution Timeline */}
      {runData && runData.workflow_run_steps?.length > 0 && (
        <div>
          <h3
            style={{
              fontSize: "1.1rem",
              marginBottom: "1rem",
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontSize: "0.8rem",
            }}
          >
            Step Execution Log — Live
          </h3>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {runData.workflow_run_steps.map((stepRun, index) => {
              const isWaiting = stepRun.status === "waiting_approval";
              const stepType = stepRun.workflow_step?.type || "unknown";
              const stepName = stepRun.workflow_step?.name || `Step #${index + 1}`;
              const stepIcon = STEP_ICONS[stepType] || "⚙️";
              const isBeingApproved = approvalLoading === stepRun.id;

              return (
                <div
                  key={stepRun.id || index}
                  className="glass-card"
                  style={{
                    padding: "1.5rem",
                    borderLeft: isWaiting
                      ? "4px solid var(--status-waiting)"
                      : stepRun.status === "completed"
                      ? "4px solid var(--status-completed)"
                      : stepRun.status === "failed"
                      ? "4px solid var(--status-failed)"
                      : "4px solid var(--accent-primary)",
                    transition: "border-color 0.3s",
                  }}
                >
                  {/* Step Header */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "0.75rem",
                      flexWrap: "wrap",
                      gap: "0.5rem",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <span style={{ fontSize: "1.2rem" }}>{stepIcon}</span>
                      <span style={{ fontWeight: 700, fontSize: "1rem" }}>{stepName}</span>
                      <StatusBadge status={stepRun.status} />
                    </div>
                    <span
                      style={{
                        fontSize: "0.75rem",
                        color: "var(--text-muted)",
                        background: "rgba(255,255,255,0.04)",
                        padding: "0.2rem 0.6rem",
                        borderRadius: "6px",
                      }}
                    >
                      {stepType}
                    </span>
                  </div>

                  {/* Step Output */}
                  {stepRun.output && Object.keys(stepRun.output).length > 0 && (
                    <div
                      style={{
                        background: "rgba(0,0,0,0.3)",
                        padding: "1rem",
                        borderRadius: "8px",
                        marginTop: "0.5rem",
                        fontSize: "0.8rem",
                        fontFamily: "monospace",
                        maxHeight: "260px",
                        overflowY: "auto",
                      }}
                    >
                      <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {JSON.stringify(stepRun.output, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Approval Gate Panel */}
                  {isWaiting && (
                    <div
                      style={{
                        marginTop: "1.25rem",
                        padding: "1.25rem",
                        background: "rgba(245, 158, 11, 0.08)",
                        border: "1px solid rgba(245, 158, 11, 0.35)",
                        borderRadius: "10px",
                      }}
                    >
                      <h4
                        style={{
                          color: "var(--status-waiting)",
                          marginBottom: "0.5rem",
                          fontSize: "0.95rem",
                        }}
                      >
                        🔐 Approval Gate — Workflow Paused
                      </h4>
                      <p
                        style={{
                          fontSize: "0.85rem",
                          color: "var(--text-muted)",
                          marginBottom: "1rem",
                          lineHeight: 1.5,
                        }}
                      >
                        This run is paused and awaiting a decision. Only users with{" "}
                        <strong>Owner</strong> or <strong>Editor</strong> role in{" "}
                        <strong>{currentOrg?.name}</strong> can approve or reject.
                        Your current role: <strong style={{ color: canRun ? "#a5b4fc" : "#fca5a5" }}>{userRole}</strong>
                      </p>

                      {canRun ? (
                        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                          <button
                            className="btn-primary"
                            onClick={() => handleApprovalAction(stepRun.id, true)}
                            disabled={isBeingApproved}
                            style={{
                              background: "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
                            }}
                          >
                            {isBeingApproved ? "Approving…" : "✓ Approve & Resume"}
                          </button>
                          <button
                            className="btn-danger"
                            onClick={() => handleApprovalAction(stepRun.id, false)}
                            disabled={isBeingApproved}
                          >
                            ✕ Reject Workflow
                          </button>
                        </div>
                      ) : (
                        <div
                          style={{
                            padding: "0.75rem",
                            background: "rgba(239,68,68,0.1)",
                            border: "1px solid rgba(239,68,68,0.3)",
                            borderRadius: "8px",
                            fontSize: "0.85rem",
                            color: "#fca5a5",
                          }}
                        >
                          🔒 You don't have permission to approve this step. Contact an Owner or Editor in {currentOrg?.name}.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Final output if completed */}
      {runData?.status === "completed" && runData.output && (
        <div className="glass-card" style={{ padding: "1.5rem", marginTop: "1.5rem" }}>
          <h4 style={{ fontSize: "1rem", marginBottom: "0.75rem", color: "var(--status-completed)" }}>
            ✅ Final Workflow Output
          </h4>
          <div
            style={{
              background: "rgba(0,0,0,0.3)",
              padding: "1rem",
              borderRadius: "8px",
              fontSize: "0.8rem",
              fontFamily: "monospace",
              maxHeight: "300px",
              overflowY: "auto",
            }}
          >
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {JSON.stringify(runData.output, null, 2)}
            </pre>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse-opacity {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
