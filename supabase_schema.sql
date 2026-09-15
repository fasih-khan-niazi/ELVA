-- ============================================================
-- ELVA Supabase Setup
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- IMPORTANT: nomic-embed-text produces 768-dim vectors.
-- If you switch embedding models, change every vector(768) below.
-- ============================================================

-- 1. Extensions
create extension if not exists "uuid-ossp";
create extension if not exists vector;

-- 2. Document chunks (the only Supabase table ELVA actually uses in production)
create table if not exists public.document_chunks (
  id          uuid primary key default uuid_generate_v4(),
  content     text not null,
  embedding   vector(768),          -- nomic-embed-text = 768 dims
  metadata    jsonb,
  created_at  timestamptz default now()
);

-- 3. Index for fast ANN search
create index if not exists document_chunks_embedding_idx
  on public.document_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- 4. The RPC the AI service calls for every RAG query.
-- filter_tenant_id / filter_agent_id scope results to one agent (required in multi-agent setups).
create or replace function match_documents (
  query_embedding    vector(768),
  match_threshold    float  default 0.32,
  match_count        int    default 5,
  filter_tenant_id   text   default null,
  filter_agent_id    text   default null
)
returns table (
  id        uuid,
  content   text,
  metadata  jsonb,
  similarity float
)
language sql stable
as $$
  select
    document_chunks.id,
    document_chunks.content,
    document_chunks.metadata,
    1 - (document_chunks.embedding <=> query_embedding) as similarity
  from document_chunks
  where 1 - (document_chunks.embedding <=> query_embedding) > match_threshold
    and (filter_tenant_id is null or metadata->>'tenant_id' = filter_tenant_id)
    and (filter_agent_id is null or metadata->>'agent_id' = filter_agent_id)
  order by document_chunks.embedding <=> query_embedding
  limit match_count;
$$;

-- 5. Storage bucket for PDFs (run once; skip if bucket already exists)
-- Do this in the Supabase dashboard under Storage → New bucket,
-- OR uncomment and run this block:
-- insert into storage.buckets (id, name, public)
-- values ('documents', 'documents', false)
-- on conflict do nothing;

-- 6. RLS: Allow the service-role key to read/write everything
--    (your backend uses SUPABASE_SERVICE_ROLE_KEY which bypasses RLS by default)
alter table public.document_chunks enable row level security;

create policy "service role full access" on public.document_chunks
  for all
  using (true)
  with check (true);
