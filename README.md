# VocalLabs Workflow Builder

A multi-tenant workflow builder for AI-powered automations. It uses React and Vite for the frontend, with Nhost Auth, Hasura GraphQL, PostgreSQL, and Nhost Functions for backend execution.

Users work inside organizations with one of three roles:

- **Owner** — manages members, workflows, steps, triggers, and runs.
- **Editor** — creates and edits workflows and triggers, and starts runs; cannot manage members. Webhook triggers and `db_write`/`notify` steps are owner-only.
- **Viewer** — read-only; cannot create, edit, run, or approve workflows.

## What the app does

- Nhost email/password authentication and SDK-managed browser sessions.
- Organization-scoped workflows, steps, triggers, runs, and step runs.
- Workflow builder with add, remove, and move-up/move-down step controls.
- Trigger editor for manual, webhook, scheduled, and database-event trigger definitions.
- Manual workflow execution with organization membership and quota checks.
- Real-time step progress through a GraphQL subscription.
- `approval_gate` pause/resume flow. Only an owner or editor in the same organization can approve or reject.
- Google Gemini LLM calls and generic HTTP request steps, each with retry handling.
- Webhook entry point for starting a workflow without using the browser UI.

## Repository layout

```text
src/                         React/Vite frontend
src/lib/nhost.js             Browser Nhost client and GraphQL helpers
src/components/              Auth, organization, builder, runner, and member UI
functions/                   Nhost serverless functions
schema.sql                   Reference PostgreSQL schema and usage analytics view
```

## Prerequisites

- Node.js 20 or newer
- npm
- An Nhost project with Auth, Hasura, PostgreSQL, and Functions enabled
- A Google Gemini API key only if real LLM calls are required

## Install and run the frontend locally

1. Clone the repository and install dependencies.

   ```bash
   git clone <your-repository-url>
   cd vocallabs-workflow
   npm install
   ```

2. Start the Vite development server.

   ```bash
   npm run dev
   ```

3. Open the URL printed by Vite, normally [http://localhost:5173](http://localhost:5173).

4. Verify the production build before committing changes.

   ```bash
   npm run build
   npm run lint
   ```

### Frontend Nhost connection

The current frontend project connection is defined in [`src/lib/nhost.js`](src/lib/nhost.js). It uses the configured Nhost subdomain and region and relies on the Nhost SDK to attach the signed-in user’s access token.

Do not put `NHOST_ADMIN_SECRET`, Gemini keys, or webhook secrets in frontend code, Vite environment variables, or browser storage.

## Function environment variables

Create variables in **Nhost Console → Settings → Environment Variables** (or your local Functions environment). Use `.env.example` only as a template; never commit real secrets.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NHOST_SUBDOMAIN` | Yes | Nhost project subdomain used by server functions. |
| `NHOST_REGION` | Yes | Nhost region, for example `ap-south-1`. |
| `NHOST_GRAPHQL_URL` | Recommended | Hasura GraphQL endpoint used by server functions. |
| `NHOST_ADMIN_SECRET` | Yes for server functions | Server-only Hasura admin access. Never expose it to the browser. |
| `GEMINI_API_KEY` | Optional | Enables real Gemini calls for `llm_call` nodes. |
| `GEMINI_MODEL` | Optional | Gemini text model preference. Defaults to `gemini-3.6-flash`; the engine checks compatible fallback models exposed to the API key. |
| `NHOST_WEBHOOK_SECRET` | Recommended | Protects `/webhook-trigger`; send it as `x-webhook-secret`. `WEBHOOK_SECRET` is also accepted for backwards compatibility. |
| `ALLOWED_ORIGINS` | Recommended | Comma-separated frontend origins allowed to call authenticated functions, for example `http://localhost:5173,https://your-app.vercel.app`. |

### Gemini fallback

If `GEMINI_API_KEY` is not set, the workflow engine uses a disclosed deterministic stub response and logs a warning. This permits demo/testing of the remaining workflow flow, but it is **not** a real LLM result.

### Current implementation notes

- `http_request` makes real HTTP requests and retries once on a network or 5xx failure.
- `llm_call` makes a real Gemini request when `GEMINI_API_KEY` exists and retries once for 429/5xx responses.
- `db_write` currently records a structured result in the workflow execution output; it is not a general arbitrary-table writer.
- `notify` is currently a disclosed logging stub. Configure a real Slack/email provider before presenting it as a production notification channel.

## Deploy Nhost Functions

Deploy the `functions/` directory to the same Nhost project as the database. If the Nhost project is connected to GitHub, push the branch and use the Nhost deployment flow. Otherwise use the Nhost CLI configured for your project.

The app expects these deployed function paths:

| Function path | Responsibility |
| --- | --- |
| `/create-organization` | Creates an organization and makes the caller its owner. |
| `/manage-organization-members` | Owner-only member listing, invitation, role change, and removal. |
| `/save-workflow` | Owner/editor workflow and step save, with owner-only sensitive-step enforcement. |
| `/manage-workflow-trigger` | Owner/editor trigger save; webhooks are owner-only. |
| `/trigger-workflow-run` | Authenticated manual run, membership/role/quota validation, then execution. |
| `/approve-workflow-step` | Owner/editor approval or rejection of a paused approval step. |
| `/webhook-trigger` | External webhook or Hasura Event Trigger execution. |
| `/scheduled-trigger` | Cron/scheduled workflow execution. |
| `/engine` | Shared workflow execution engine. |

After a Functions deployment, test the function URLs in the Nhost Console logs. A frontend Vite deployment alone does not deploy these backend functions.

## Hasura and database setup

1. Create/track the application tables and their relationships in Hasura:

   ```text
   organizations → organization_members → workflows
   workflows → workflow_steps, workflow_triggers, workflow_runs
   workflow_runs → workflow_run_steps
   ```

2. Ensure the deployed table names match the function queries. This project’s deployed Functions use `workflow_run_steps` for per-step run records.

3. Add and track the fields used by the approval flow on `workflow_run_steps`:

   ```sql
   ALTER TABLE public.workflow_run_steps
     ADD COLUMN IF NOT EXISTS error jsonb,
     ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS approved_by uuid,
     ADD COLUMN IF NOT EXISTS approved_at timestamptz;
   ```

4. Add and track `workflow_runs.created_at` if newest-run ordering is required:

   ```sql
   ALTER TABLE public.workflow_runs
     ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
   ```

5. Run the organization usage view from `schema.sql`, track it in Hasura as `org_usage_analytics`, and give users a select filter that is scoped through their `organization_members` row.

### Required permission model

Hasura `user` permissions must scope every query to the caller’s organization membership. Do not make application tables publicly writable.

- Owners: full organization/member/workflow control.
- Editors: workflow/step/trigger editing and run creation only within their organization.
- Viewers: read-only within their organization.
- Prefer the secure Functions above for organization creation, member changes, workflow execution, approval, and trigger management; do not expose admin secrets or direct permissive mutations to the browser.

When adding a new column, confirm it is selected for the `user` role if the frontend queries it. The Hasura Console’s admin GraphiQL schema can expose fields that the signed-in `user` schema cannot.

## Hasura Actions and triggers

Register the action endpoints that your deployment uses, including:

- `triggerWorkflowRun` → `/trigger-workflow-run`
- `approveWorkflowStep` → `/approve-workflow-step`
- `createOrganization` → `/create-organization`
- `saveWorkflow` → `/save-workflow`
- `manageWorkflowTrigger` → `/manage-workflow-trigger`

For an additional non-manual trigger, configure at least one of the following and test it:

- **Webhook:** send a JSON body with `workflow_id` and optional `input` to `/webhook-trigger`. When `NHOST_WEBHOOK_SECRET` is configured, include `x-webhook-secret`.
- **Scheduled:** configure an Nhost cron/scheduled event to invoke `/scheduled-trigger`.
- **Database event:** configure a Hasura Event Trigger to POST to `/webhook-trigger` with the configured secret header.

Example webhook request (replace placeholders; do not commit the secret):

```bash
curl -X POST "https://<subdomain>.functions.<region>.nhost.run/v1/webhook-trigger" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: <your-secret>" \
  -d '{
    "workflow_id": "<workflow-uuid>",
    "input": { "source": "webhook-test" }
  }'
```

## End-to-end test checklist

1. Register two users and create two separate organizations.
2. Verify a newly registered user has no organization until they create one or an owner adds them.
3. As an owner, add one editor and one viewer.
4. Create a workflow containing `llm_call`, `http_request`, `conditional_branch`, and `approval_gate` steps.
5. Start it as owner/editor and watch step states update live.
6. At the approval gate, verify viewer cannot approve and owner/editor can approve or reject.
7. Trigger the same workflow through the configured webhook or scheduler.
8. Sign in as a member of the second organization and verify they cannot list, run, approve, or access the first organization’s workflow by ID.

## Deployment

1. Commit and push the frontend and Functions changes.
2. Deploy Functions to Nhost and confirm their environment variables and logs.
3. Deploy the React app to Vercel (or another Vite-compatible host).
4. Add the deployed frontend URL to `ALLOWED_ORIGINS` in Nhost Functions settings.
5. Perform the end-to-end checklist above against the deployed application.
