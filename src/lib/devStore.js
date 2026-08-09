// Dev Store Helper for local fast-track session testing & multi-tenant isolation

const STORAGE_KEYS = {
  ORGS: "vocallabs_dev_orgs",
  WORKFLOWS: "vocallabs_dev_workflows",
  RUNS: "vocallabs_dev_runs"
};

function getItem(key, defaultValue) {
  try {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

function setItem(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) {
    console.error("DevStore save error:", e);
  }
}

export const devStore = {
  // Get Orgs for user
  getOrgs(userId, userEmail) {
    const allOrgs = getItem(STORAGE_KEYS.ORGS, {});
    let userOrgs = allOrgs[userId];
    if (!userOrgs) {
      // Default initial orgs per user for immediate testing
      // Match the UUID format used by dev fast-track in AuthScreen
      if (userId === "00000000-0000-0000-0000-000000000123" || userId?.includes("123")) {
        userOrgs = [{ id: "org-a-demo-uuid-000000000001", name: "Acme Corp (Org A)", membershipRole: "owner", calls_used: 0, max_quota: 100 }];
      } else if (userId === "00000000-0000-0000-0000-000000000456" || userId?.includes("456")) {
        userOrgs = [{ id: "org-b-demo-uuid-000000000002", name: "Beta Logistics (Org B)", membershipRole: "owner", calls_used: 0, max_quota: 100 }];
      } else {
        const cleanName = userEmail ? userEmail.split("@")[0] : "Developer";
        const capitalized = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
        userOrgs = [{ id: `org-${Date.now()}`, name: `${capitalized}'s Org`, membershipRole: "owner", calls_used: 0, max_quota: 100 }];
      }
      allOrgs[userId] = userOrgs;
      setItem(STORAGE_KEYS.ORGS, allOrgs);
    }
    return userOrgs;
  },

  // Create new Org for user
  createOrg(userId, name) {
    const allOrgs = getItem(STORAGE_KEYS.ORGS, {});
    const userOrgs = allOrgs[userId] || [];
    const newOrg = {
      id: `org-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name,
      membershipRole: "owner"
    };
    userOrgs.push(newOrg);
    allOrgs[userId] = userOrgs;
    setItem(STORAGE_KEYS.ORGS, allOrgs);
    return newOrg;
  },

  // Get Workflows for Org
  getWorkflows(orgId) {
    const allWfs = getItem(STORAGE_KEYS.WORKFLOWS, {});
    let wfs = allWfs[orgId];
    if (!wfs) {
      // Initial sample workflow for quick testing
      wfs = [
        {
          id: `wf-sample-${orgId}`,
          org_id: orgId,
          name: "Customer Support Escalation Workflow",
          workflow_steps: [
            { id: "step-1", name: "1. Analyze Complaint Severity", type: "llm_call", step_order: 1, config: { prompt: "Assess severity" } },
            { id: "step-2", name: "2. Fetch User Account Status", type: "http_request", step_order: 2, config: { url: "https://jsonplaceholder.typicode.com/todos/1", method: "GET" } },
            { id: "step-3", name: "3. Manager Refund Approval Gate", type: "approval_gate", step_order: 3, config: { note: "Owner/Editor approval required" } }
          ],
          workflow_runs: []
        }
      ];
      allWfs[orgId] = wfs;
      setItem(STORAGE_KEYS.WORKFLOWS, allWfs);
    }
    return wfs;
  },

  // Save / Update Workflow
  saveWorkflow(orgId, workflowData) {
    const allWfs = getItem(STORAGE_KEYS.WORKFLOWS, {});
    const wfs = allWfs[orgId] || [];
    let target = wfs.find(w => w.id === workflowData.id);

    if (target) {
      target.name = workflowData.name;
      target.workflow_steps = workflowData.steps;
    } else {
      target = {
        id: `wf-${Date.now()}`,
        org_id: orgId,
        name: workflowData.name,
        workflow_steps: workflowData.steps,
        workflow_runs: []
      };
      wfs.push(target);
    }

    allWfs[orgId] = wfs;
    setItem(STORAGE_KEYS.WORKFLOWS, allWfs);
    return target;
  },

  // Create & Run Workflow
  createRun(workflowId, userId, inputPayload) {
    const allRuns = getItem(STORAGE_KEYS.RUNS, {});
    const runId = `run-${Date.now()}`;

    // Get workflow steps
    let steps = [];
    const allWfs = getItem(STORAGE_KEYS.WORKFLOWS, {});
    for (const orgId in allWfs) {
      const found = allWfs[orgId].find(w => w.id === workflowId);
      if (found) {
        steps = found.workflow_steps || [];
        break;
      }
    }

    const runSteps = [];
    let initialRunStatus = "running";

    for (const s of steps) {
      if (s.type === "approval_gate") {
        runSteps.push({
          id: `steprun-${Date.now()}-${s.id}`,
          status: "waiting_approval",
          output: { message: "Approval required by Organization Owner or Editor", requiredRole: ["owner", "editor"] },
          workflow_step: s
        });
        initialRunStatus = "waiting_approval";
        break; // Pause loop
      } else {
        runSteps.push({
          id: `steprun-${Date.now()}-${s.id}`,
          status: "completed",
          output: {
            stepName: s.name,
            executedType: s.type,
            status: "Success",
            timestamp: new Date().toISOString()
          },
          workflow_step: s
        });
      }
    }

    const newRun = {
      id: runId,
      workflow_id: workflowId,
      user_id: userId,
      status: initialRunStatus,
      input: inputPayload,
      workflow_run_steps: runSteps
    };

    allRuns[runId] = newRun;
    setItem(STORAGE_KEYS.RUNS, allRuns);
    return newRun;
  },

  // Get Run Details
  getRun(runId) {
    const allRuns = getItem(STORAGE_KEYS.RUNS, {});
    return allRuns[runId] || null;
  },

  // Approve / Reject Step Gate
  handleApproval(runId, stepRunId, approved, role) {
    const allRuns = getItem(STORAGE_KEYS.RUNS, {});
    const run = allRuns[runId];
    if (!run) return null;

    const stepRun = run.workflow_run_steps?.find(s => s.id === stepRunId);
    if (stepRun) {
      if (approved) {
        stepRun.status = "completed";
        stepRun.output = {
          approved: true,
          approvedByRole: role,
          approvedAt: new Date().toISOString()
        };
        run.status = "completed";
      } else {
        stepRun.status = "failed";
        run.status = "failed";
      }
    }

    allRuns[runId] = run;
    setItem(STORAGE_KEYS.RUNS, allRuns);
    return run;
  }
};
