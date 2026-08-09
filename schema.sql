-- PostgreSQL & Hasura Schema for VocalLabs AI Agent Workflow Builder

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Organizations Table (with Quota tracking)
CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    calls_used INT NOT NULL DEFAULT 0,
    max_quota INT NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Organization Members Table (Layer 1 Org & Role Security)
CREATE TABLE IF NOT EXISTS public.organization_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(org_id, user_id)
);

-- 3. Workflows Table
CREATE TABLE IF NOT EXISTS public.workflows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Workflow Steps Table (Ordered sequence of nodes)
CREATE TABLE IF NOT EXISTS public.workflow_steps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('llm_call', 'http_request', 'conditional_branch', 'approval_gate', 'db_write', 'notify')),
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    step_order INT NOT NULL
);

-- 5. Workflow Triggers Table
CREATE TABLE IF NOT EXISTS public.workflow_triggers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'webhook', 'scheduled', 'db_event')),
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Workflow Runs Table
CREATE TABLE IF NOT EXISTS public.workflow_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'waiting_approval', 'completed', 'failed')),
    input JSONB DEFAULT '{}'::jsonb,
    output JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Step Runs Table (Tracks execution per step with approval audit fields)
CREATE TABLE IF NOT EXISTS public.step_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id UUID NOT NULL REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
    step_id UUID NOT NULL REFERENCES public.workflow_steps(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'waiting_approval', 'completed', 'failed')),
    input JSONB DEFAULT '{}'::jsonb,
    output JSONB DEFAULT '{}'::jsonb,
    attempt_count INT NOT NULL DEFAULT 1,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Aggregation View: Org Usage & Analytics
CREATE OR REPLACE VIEW public.org_usage_analytics AS
SELECT 
    o.id AS org_id,
    o.name AS org_name,
    o.calls_used,
    o.max_quota,
    (o.max_quota - o.calls_used) AS quota_remaining,
    ROUND((o.calls_used::decimal / GREATEST(o.max_quota, 1)) * 100, 2) AS usage_percentage,
    COUNT(DISTINCT w.id) AS total_workflows,
    COUNT(DISTINCT r.id) AS total_runs
FROM public.organizations o
LEFT JOIN public.workflows w ON w.org_id = o.id
LEFT JOIN public.workflow_runs r ON r.workflow_id = w.id
GROUP BY o.id, o.name, o.calls_used, o.max_quota;

-- Enable Row-Level Security (RLS)
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.step_runs ENABLE ROW LEVEL SECURITY;
