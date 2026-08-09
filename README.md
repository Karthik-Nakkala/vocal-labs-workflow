# ⚡ VocalLabs AI Agent Workflow Builder

A full-stack, multi-tenant AI workflow automation platform built with **React**, **Nhost (PostgreSQL + Hasura GraphQL)**, and **Nhost Serverless Functions**.

Inspired by n8n, purpose-built for chaining AI agent steps with **two-layer permission security**, **real-time step execution monitoring**, **human-in-the-loop approval gates**, and **airtight multi-tenant isolation**.

---

## 🌟 Tech Stack

- **Frontend:** React 19, Vite, Vanilla CSS (Glassmorphism & Dark Mode)
- **Backend & Database:** Nhost Cloud (PostgreSQL 14 + Hasura GraphQL Engine)
- **Authentication:** Nhost Auth (JWT session management with role claims)
- **Serverless Functions (Node.js):**
  - `/triggerWorkflowRun` — Validates role & quota, creates run, initiates execution
  - `/approveWorkflowStep` — Validates approver role, records approval audit, resumes workflow engine
  - `/webhookTrigger` — Inbound webhook endpoint for external system integration & Hasura Event Triggers
  - `/scheduledTrigger` — Cron handler for scheduled workflow executions
  - `/createOrganization` — Creates new organization and links creator as Owner
- **AI / LLM Integration:** Google Gemini 1.5 Flash API (with 1 retry on 429/5xx and disclosed stub fallback)

---

## 🏗️ Architecture & Features

### 1. Data Model (PostgreSQL & Hasura Schema)

- **`organizations`** — Usage quotas (`calls_used`, `max_quota`), organization name, timestamps.
- **`organization_members`** — User-to-Org mapping with roles (`owner`, `editor`, `viewer`).
- **`workflows`** — Workflows associated with specific organizations (`org_id`).
- **`workflow_steps`** — Ordered sequence of nodes (`step_order`, `type`, `config`).
- **`workflow_triggers`** — Trigger definitions (`manual`, `webhook`, `scheduled`, `db_event`).
- **`workflow_runs`** — Execution instances (`pending`, `running`, `waiting_approval`, `completed`, `failed`).
- **`step_runs`** — Granular step-level execution logs (`input`, `output`, `status`, `approved_by`, `approved_at`, `attempt_count`).
- **`org_usage_analytics`** (View) — Computed view aggregating org usage percentage, remaining quota, and workflow/run totals.

---

### 2. Two-Layer Security Permissions

#### Layer 1: Org & Role Scoping (Row-Level Security & Action Checks)
- **Org Isolation:** Every GraphQL query and mutation filters strictly by `org_id` derived from `organization_members`. An Editor or Owner in **Org A** can never view, update, or guess IDs belonging to **Org B**.
- **Role Permissions:**
  - `owner`: Full control over workflows, steps, triggers, and organization member management.
  - `editor`: Can create/edit workflows, modify steps, and trigger runs. Cannot invite or alter members.
  - `viewer`: Read-only access. Cannot trigger runs, edit workflows, or approve gates (Run/Save/Approve buttons are automatically locked/hidden).

#### Layer 2: Step-Level Gating & Action-Level Role Checking
- Critical steps and mid-execution decisions (`approval_gate`) cannot be bypassed by database permissions alone.
- Clearing an `approval_gate` requires the Nhost Serverless Action (`/approveWorkflowStep`) to inspect the approver's active role (`owner` or `editor`) before resuming downstream step execution.

---

### 3. Step Types (Nodes)

1. `llm_call`: Calls Google Gemini 1.5 Flash API to analyze input payloads and extract structured JSON responses.
2. `http_request`: Generic external API endpoint call (GET/POST) with retry logic.
3. `conditional_branch`: Dynamic JS condition evaluation against preceding step outputs.
4. `approval_gate`: Pauses workflow execution until an authorized Owner/Editor approves or rejects.
5. `db_write`: Persists aggregated workflow step outputs to PostgreSQL.
6. `notify`: Dispatches alert notifications (Slack / Email event triggers).

---

### 4. Trigger Types

- **Manual**: User clicks "▶ Launch Workflow" in the UI.
- **Webhook**: External systems hit `POST /webhookTrigger` with `{ workflow_id, input }`.
- **Scheduled**: Nhost Cron triggers `POST /scheduledTrigger` to execute scheduled workflows.
- **Database Event**: Hasura Event Trigger forwards table row changes automatically to `/webhookTrigger`.

---

## 🔒 Security Breakdown & Approval-Gate Implementation

### How Two-Layer Security is Enforced Differently
- **Layer 1 (Database & Session Level)**: Handled by Hasura Row-Level Security (RLS) rules and session variables (`x-hasura-user-id`, `x-hasura-org-id`). Ensures queries automatically filter by the user's organization.
- **Layer 2 (Function & Execution Level)**: Enforced inside serverless action handlers (`trigger-workflow-run.js`, `approve-workflow-step.js`). Because approval gates pause execution mid-flow, database permissions alone cannot verify if the person resuming the run has the required role. The action handler fetches the org membership chain, validates the user's role against `["owner", "editor"]`, and records `approved_by` and `approved_at` before resuming the workflow engine.

---

## 🚀 Local Setup Guide

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/your-username/vocallabs-workflow.git
cd vocallabs-workflow
npm install
```

### 2. Configure Environment Variables
Create a `.env` file in the root directory:
```env
NHOST_SUBDOMAIN=mbknwfytawrylgsgbfxw
NHOST_REGION=ap-south-1
NHOST_ADMIN_SECRET=your_hasura_admin_secret
GEMINI_API_KEY=your_google_gemini_api_key
```

### 3. Run Local Development Server
```bash
npm run dev
```
Open **`http://localhost:5173/`** in your browser.

---

## 🧪 Live Final Task Walkthrough (Evaluation Scenario)

To demonstrate the full system live:

1. **Sign In / Dev Access**:
   - Use **Quick Dev Access** (`User A (Org A)`) or register a new user.
2. **Create Workflow in Org A**:
   - Create a workflow containing:
     - `1. AI Complaint Analysis (llm_call)`
     - `2. Fetch CRM Data (http_request)`
     - `3. Manager Refund Approval (approval_gate)`
3. **Execute Run**:
   - Click **▶ Launch Workflow** with sample JSON payload.
   - Watch step 1 & 2 complete in real-time.
   - Run cleanly pauses at step 3 (`approval_gate`) with status **Awaiting Approval**.
4. **Approve & Resume**:
   - Click **✓ Approve & Resume**.
   - Serverless action validates Owner/Editor role, updates `approved_by`/`approved_at`, and finishes the run.
5. **Webhook Test**:
   - Scroll to the **🪝 Webhook Trigger** panel in WorkflowRunner.
   - Copy the `curl` command and run it from any terminal. Execution starts externally without browser login!
6. **Cross-Tenant Isolation Check**:
   - Switch user to `User B (Org B)`.
   - User B sees **0 workflows or runs** from Org A. Direct ID queries return 403 Forbidden.
