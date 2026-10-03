-- Run after 001_library.sql in a DISPOSABLE Supabase database:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_and_revisions.sql
-- The transaction rolls back the fixture users and all fixture documents.
begin;

insert into auth.users(id, aud, role, email)
values ('ac100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'chord-test-a@example.invalid'),
       ('ac100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'chord-test-b@example.invalid');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ac100000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare
    first_result jsonb;
    retry_result jsonb;
    update_result jsonb;
    conflict_result jsonb;
    first_revision bigint;
    second_revision bigint;
begin
    first_result := public.apply_library_document('songs', 'legacy:song/1', '{"id":"legacy:song/1","title":"Original","custom":{"preserved":true}}', false, null);
    if not (first_result ->> 'applied')::boolean then raise exception 'Initial insert failed'; end if;
    first_revision := (first_result #>> '{document,revision}')::bigint;

    retry_result := public.apply_library_document('songs', 'legacy:song/1', '{"id":"legacy:song/1","title":"Original","custom":{"preserved":true}}', false, null);
    if not (retry_result ->> 'applied')::boolean or (retry_result #>> '{document,revision}')::bigint <> first_revision then
        raise exception 'Retry is not idempotent';
    end if;

    update_result := public.apply_library_document('songs', 'legacy:song/1', '{"id":"legacy:song/1","title":"Changed","custom":{"preserved":true}}', false, first_revision);
    second_revision := (update_result #>> '{document,revision}')::bigint;
    if not (update_result ->> 'applied')::boolean or second_revision <= first_revision then raise exception 'Revision did not advance'; end if;

    conflict_result := public.apply_library_document('songs', 'legacy:song/1', '{"id":"legacy:song/1","title":"Stale"}', false, first_revision);
    if (conflict_result ->> 'applied')::boolean or conflict_result #>> '{document,payload,title}' <> 'Changed' then
        raise exception 'Stale update overwrote data';
    end if;

    conflict_result := public.apply_library_document('songs', 'legacy:song/1', '{"id":"legacy:song/1","title":"Import collision"}', false, null);
    if (conflict_result ->> 'applied')::boolean then raise exception 'Insert-only collision overwrote data'; end if;

    update_result := public.apply_library_document('songs', 'legacy:song/1', '{"id":"legacy:song/1","title":"Changed","deleted":true}', true, second_revision);
    if not (update_result #>> '{document,deleted}')::boolean then raise exception 'Delete did not create a tombstone'; end if;

    perform public.apply_library_document('setlists', 'legacy-playlist', '{"id":"legacy-playlist","name":"Sunday","songIds":["legacy:song/1"]}', false, null);

    begin
        perform public.apply_library_document('songs', 'mismatch', '{"id":"other"}', false, null);
        raise exception 'Mismatched payload id accepted';
    exception when invalid_parameter_value then null;
    end;
    begin
        insert into public.library_documents(owner_id, collection, id, payload)
          values ('ac100000-0000-4000-8000-000000000002','songs','direct','{"id":"direct"}');
        raise exception 'Direct insert allowed';
    exception when insufficient_privilege then null;
    end;
    begin
        update public.library_documents set payload = '{"id":"legacy:song/1","title":"bypass"}';
        raise exception 'Direct update allowed';
    exception when insufficient_privilege then null;
    end;
    begin
        delete from public.library_documents;
        raise exception 'Direct delete allowed';
    exception when insufficient_privilege then null;
    end;
end;
$$;

select set_config('request.jwt.claims', '{"sub":"ac100000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
begin
    if exists(select 1 from public.library_documents) then raise exception 'User B can read user A data'; end if;
    perform public.apply_library_document('songs', 'legacy:song/1', '{"id":"legacy:song/1","title":"User B"}', false, null);
    if (select count(*) from public.library_documents) <> 1 then raise exception 'User B own data missing'; end if;
end;
$$;

select set_config('request.jwt.claims', '{"sub":"ac100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
begin
    if (select count(*) from public.library_documents) <> 2 then raise exception 'User A cannot read its own documents'; end if;
    if exists(select 1 from public.library_documents where payload ->> 'title' = 'User B') then raise exception 'User A can read user B'; end if;
    if not exists(select 1 from public.library_documents where deleted) then raise exception 'Tombstones not visible for synchronization'; end if;
end;
$$;

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
    begin
        perform * from public.library_documents;
        raise exception 'Anonymous read allowed';
    exception when insufficient_privilege then null;
    end;
    begin
        perform public.apply_library_document('songs', 'anonymous', '{"id":"anonymous"}', false, null);
        raise exception 'Anonymous RPC allowed';
    exception when insufficient_privilege then null;
    end;
end;
$$;

rollback;
\echo 'PASS: RLS, denied direct writes, account isolation, preserved JSON, idempotent retries, revisions, conflicts and tombstones.'
