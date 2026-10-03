-- Apply manually in a Supabase SQL editor or a disposable local Supabase database.
-- This migration never imports Firebase identities or modifies existing Firebase data.
begin;

create sequence public.library_revision_seq as bigint;

create table public.library_documents (
    owner_id uuid not null references auth.users(id) on delete cascade,
    collection text not null check (collection in ('songs', 'setlists')),
    id text not null check (length(id) between 1 and 1024 and length(btrim(id)) > 0),
    payload jsonb not null check (jsonb_typeof(payload) = 'object' and payload ? 'id'
        and jsonb_typeof(payload -> 'id') = 'string' and payload ->> 'id' = id),
    deleted boolean not null default false,
    revision bigint not null default nextval('public.library_revision_seq'),
    server_updated_at timestamptz not null default clock_timestamp(),
    primary key (owner_id, collection, id),
    unique (revision)
);

create index library_documents_owner_collection_revision_idx
    on public.library_documents (owner_id, collection, revision);

alter table public.library_documents enable row level security;
create policy library_documents_read_own on public.library_documents
    for select to authenticated using (owner_id = (select auth.uid()));

-- Clients read only their own data. Writes go through the revision checked RPC below.
revoke all on public.library_documents from public, anon, authenticated;
grant select on public.library_documents to authenticated;
revoke all on sequence public.library_revision_seq from public, anon, authenticated;

create function public.apply_library_document(
    p_collection text,
    p_id text,
    p_payload jsonb,
    p_deleted boolean default false,
    p_expected_revision bigint default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_owner uuid := auth.uid();
    v_current public.library_documents%rowtype;
begin
    if v_owner is null then
        raise exception 'Authentication required' using errcode = '28000';
    end if;
    if p_collection is null or p_collection not in ('songs', 'setlists')
       or p_id is null or length(p_id) not between 1 and 1024 or length(btrim(p_id)) = 0
       or p_payload is null or jsonb_typeof(p_payload) <> 'object'
       or jsonb_typeof(p_payload -> 'id') is distinct from 'string'
       or (p_payload ->> 'id') is distinct from p_id or p_deleted is null
       or (p_expected_revision is not null and p_expected_revision < 1) then
        raise exception 'Invalid library document' using errcode = '22023';
    end if;

    -- Serialize ALL writes for an owner before assigning a revision. A plain sequence
    -- can commit out of order, which would let a revision cursor permanently skip data.
    perform pg_advisory_xact_lock(hashtextextended(v_owner::text, 572804));
    select * into v_current from public.library_documents
      where owner_id = v_owner and collection = p_collection and id = p_id for update;

    if not found then
        if p_expected_revision is not null then
            raise exception 'The expected document no longer exists; pull before retrying' using errcode = '40001';
        end if;
        insert into public.library_documents (owner_id, collection, id, payload, deleted)
          values (v_owner, p_collection, p_id, p_payload, p_deleted) returning * into v_current;
        return jsonb_build_object('applied', true, 'document', to_jsonb(v_current) - 'owner_id');
    end if;

    -- An identical retry after a lost response is safe and does not create another revision.
    if v_current.payload = p_payload and v_current.deleted = p_deleted then
        return jsonb_build_object('applied', true, 'document', to_jsonb(v_current) - 'owner_id');
    end if;
    if p_expected_revision is null or v_current.revision <> p_expected_revision then
        return jsonb_build_object('applied', false, 'document', to_jsonb(v_current) - 'owner_id');
    end if;

    update public.library_documents
      set payload = p_payload, deleted = p_deleted,
          revision = nextval('public.library_revision_seq'), server_updated_at = clock_timestamp()
      where owner_id = v_owner and collection = p_collection and id = p_id
      returning * into v_current;
    return jsonb_build_object('applied', true, 'document', to_jsonb(v_current) - 'owner_id');
end;
$$;

revoke all on function public.apply_library_document(text, text, jsonb, boolean, bigint) from public, anon;
grant execute on function public.apply_library_document(text, text, jsonb, boolean, bigint) to authenticated;

commit;
