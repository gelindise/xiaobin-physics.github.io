-- VIP-only circuit sandbox saves.
-- Run once in Supabase Dashboard -> SQL Editor before deploying api/circuit-saves.js.

CREATE TABLE IF NOT EXISTS public.circuit_saves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 24),
  scene JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT circuit_saves_username_client_id_key UNIQUE (username, client_id)
);

CREATE INDEX IF NOT EXISTS circuit_saves_owner_created_idx
  ON public.circuit_saves (username, created_at, id);

-- Browser/anon requests must not access this table directly. Only the serverless
-- endpoint uses the service-role key after validating the account session and VIP.
ALTER TABLE public.circuit_saves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.circuit_saves FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.circuit_saves TO service_role;
