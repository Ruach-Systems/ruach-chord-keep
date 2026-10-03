-- Run only after 001 + 002 + 003 in a test Supabase database. All fixtures roll back.
-- Pure SQL: usable in the SQL editor or psql -v ON_ERROR_STOP=1 -f this-file.sql.
begin;

do $$
begin
    if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname in ('songs','setlists','setlist_songs') and c.relkind='r') <> 3 then
        raise exception 'Expected three actual relational storage tables';
    end if;
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname='library_documents' and c.relkind='v'
            and c.reloptions @> array['security_invoker=true']) then
        raise exception 'Compatibility API must be a security-invoker view';
    end if;
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='chordlibrary_private' and c.relname='library_documents_001' and c.relkind='r') then
        raise exception 'Original 001 table was not archived';
    end if;
    if not exists(select 1 from pg_constraint where conrelid='public.setlist_songs'::regclass
        and conname='setlist_songs_owner_id_song_id_fkey' and confrelid='public.songs'::regclass
        and contype='f' and confdeltype='c') then
        raise exception 'Apply 003: physical song/account deletion must cascade to memberships';
    end if;
    if exists(select 1 from information_schema.columns where table_schema='public'
        and table_name in ('songs','setlists','setlist_songs') and column_name='payload') then
        raise exception 'Relational tables must not persist document payloads';
    end if;
    if (select data_type from information_schema.columns where table_schema='public' and table_name='songs' and column_name='created_at') <> 'timestamp with time zone'
        or (select data_type from information_schema.columns where table_schema='public' and table_name='songs' and column_name='transpose_steps') <> 'smallint'
        or (select data_type from information_schema.columns where table_schema='public' and table_name='songs' and column_name='two_column') <> 'boolean' then
        raise exception 'Known song attributes must have PostgreSQL types';
    end if;
end;
$$;

insert into auth.users(id,aud,role,email) values
 ('ac200000-0000-4000-8000-000000000001','authenticated','authenticated','relational-a@example.invalid'),
 ('ac200000-0000-4000-8000-000000000002','authenticated','authenticated','relational-b@example.invalid');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ac200000-0000-4000-8000-000000000001","role":"authenticated"}',true);

do $$
declare
    v_song jsonb := '{"id":"legacy:song/1","title":"Original","artist":"Artist","content":"[C]First line","transposeSteps":2,"twoColumn":true,"createdAt":1700000000123,"updatedAt":1700000000456,"future":{"preserved":true}}';
    v_list jsonb := '{"id":"legacy-list","name":"Ordered set","description":"Description","songIds":["s2","legacy:song/1","s2"],"createdAt":0,"updatedAt":-1,"occasion":"test"}';
    v_result jsonb;
    v_retry jsonb;
    v_song_revision bigint;
    v_second_revision bigint;
    v_list_revision bigint;
    v_order jsonb;
begin
    v_result := public.apply_library_document('songs','legacy:song/1',v_song,false,null);
    v_song_revision := (v_result #>> '{document,revision}')::bigint;
    if not (v_result->>'applied')::boolean or v_result #> '{document,payload}' <> v_song then
        raise exception 'Song typed projection did not round-trip the full payload';
    end if;
    if not exists(select 1 from public.songs where id='legacy:song/1' and title='Original'
        and content='[C]First line' and transpose_steps=2 and two_column
        and created_at=timestamptz '2023-11-14 22:13:20.123+00'
        and updated_at=timestamptz '2023-11-14 22:13:20.456+00'
        and extra_fields='{"future":{"preserved":true}}'::jsonb) then
        raise exception 'Song properties were not stored in their typed columns or extras duplicated known fields';
    end if;

    -- Optional defaults and benign explicit deleted=false must normalize identically.
    v_result := public.apply_library_document('songs','s2','{"id":"s2","title":"Second","content":"[G]Second line"}',false,null);
    v_second_revision := (v_result #>> '{document,revision}')::bigint;
    if v_result #> '{document,payload}' <> '{"id":"s2","title":"Second","artist":"","content":"[G]Second line","transposeSteps":0,"twoColumn":false,"createdAt":0,"updatedAt":0}'::jsonb then
        raise exception 'Optional song defaults are incompatible with the native DTO';
    end if;
    v_retry := public.apply_library_document('songs','s2',
        (v_result #> '{document,payload}') || '{"deleted":false}'::jsonb,false,null);
    if not (v_retry->>'applied')::boolean or (v_retry #>> '{document,revision}')::bigint<>v_second_revision then
        raise exception 'Normalized retry produced a conflict or extra revision';
    end if;

    v_result := public.apply_library_document('setlists','legacy-list',v_list,false,null);
    v_list_revision := (v_result #>> '{document,revision}')::bigint;
    if v_result #> '{document,payload}' <> v_list then raise exception 'Ordered setlist did not round-trip'; end if;
    select jsonb_agg(s.id order by m.position) into v_order
        from public.setlist_songs m join public.songs s on s.owner_id=m.owner_id and s.id=m.song_id
        join public.setlists l on l.owner_id=m.owner_id and l.id=m.setlist_id where l.id='legacy-list';
    if v_order <> '["s2","legacy:song/1","s2"]'::jsonb then raise exception 'Typed joins lost membership order or repeated songs'; end if;
    if (select count(*) from public.setlist_songs where setlist_id='legacy-list')<>3
        or (select extra_fields from public.setlists where id='legacy-list')<>'{"occasion":"test"}'::jsonb then
        raise exception 'Setlist membership or extras stored incorrectly';
    end if;
    if (select updated_at from public.setlists where id='legacy-list')<>timestamptz '1969-12-31 23:59:59.999+00' then
        raise exception 'Negative Unix milliseconds were rounded or timezone-shifted';
    end if;

    -- Changing order changes the revision and replaces only this list's membership transactionally.
    v_list := jsonb_set(v_list,'{songIds}','["legacy:song/1","s2","legacy:song/1"]'::jsonb);
    v_result := public.apply_library_document('setlists','legacy-list',v_list,false,v_list_revision);
    if not (v_result->>'applied')::boolean or (v_result #>> '{document,revision}')::bigint<=v_list_revision then
        raise exception 'Membership update did not advance revision';
    end if;
    v_retry := public.apply_library_document('setlists','legacy-list',jsonb_set(v_list,'{name}','"Stale"'),false,v_list_revision);
    if (v_retry->>'applied')::boolean or v_retry #>> '{document,payload,name}'<>'Ordered set' then
        raise exception 'Stale setlist update overwrote relational data';
    end if;
    v_list_revision := (v_result #>> '{document,revision}')::bigint;

    begin
        perform public.apply_library_document('setlists','missing-list','{"id":"missing-list","name":"Missing","songIds":["not-yet-synced"]}',false,null);
        raise exception 'Missing song reference accepted';
    exception when foreign_key_violation then
        if sqlerrm not like '%not been synced for this account%' then raise exception 'Missing-reference error must explain the remedy'; end if;
    end;
    if exists(select 1 from public.setlists where id='missing-list') then raise exception 'Failed membership insert left a partial parent'; end if;
    begin
        perform public.apply_library_document('setlists','legacy-list',jsonb_set(v_list,'{songIds}','["s2","missing"]'),false,v_list_revision);
        raise exception 'Missing membership on existing list accepted';
    exception when foreign_key_violation then null;
    end;
    if (select revision from public.setlists where id='legacy-list')<>v_list_revision
        or (select payload->'songIds' from public.library_documents where collection='setlists' and id='legacy-list')<>v_list->'songIds' then
        raise exception 'Failed reference update changed revision or ordered membership';
    end if;

    -- A song tombstone remains a real FK target until clients explicitly repair their setlists.
    v_result := public.apply_library_document('songs','legacy:song/1',v_song||'{"deleted":true}'::jsonb,true,v_song_revision);
    if not (v_result #>> '{document,deleted}')::boolean or (select count(*) from public.setlist_songs where song_id='legacy:song/1')<>2 then
        raise exception 'Song tombstone unexpectedly removed active memberships';
    end if;
    if not exists(select 1 from public.songs where id='legacy:song/1' and deleted and content='[C]First line') then
        raise exception 'Song tombstone lost its typed content';
    end if;

    -- Deleted lists have no memberships, even if local unsynced references never existed remotely.
    v_list := jsonb_set(v_list,'{songIds}','["never-synced"]'::jsonb)||'{"deleted":true}'::jsonb;
    v_result := public.apply_library_document('setlists','legacy-list',v_list,true,v_list_revision);
    v_list_revision := (v_result #>> '{document,revision}')::bigint;
    if v_result #> '{document,payload,songIds}'<>'[]'::jsonb or exists(select 1 from public.setlist_songs where setlist_id='legacy-list') then
        raise exception 'Deleted setlist retained junction rows or failed to normalize references';
    end if;
    v_retry := public.apply_library_document('setlists','legacy-list',v_list,true,v_list_revision);
    if not (v_retry->>'applied')::boolean or (v_retry #>> '{document,revision}')::bigint<>v_list_revision then
        raise exception 'Deleted setlist retry was not idempotent';
    end if;

    v_result := public.apply_library_document('songs','boundary','{"id":"boundary","title":"Bounds","content":"[C]Bounds","createdAt":-62135596800000,"updatedAt":253402300799999}',false,null);
    if (v_result #>> '{document,payload,createdAt}')::bigint<>-62135596800000
        or (v_result #>> '{document,payload,updatedAt}')::bigint<>253402300799999 then
        raise exception 'Timestamp boundary round-trip lost milliseconds';
    end if;
    begin
        perform public.apply_library_document('songs','fraction','{"id":"fraction","title":"Bad","content":"x","createdAt":1.5}',false,null);
        raise exception 'Fractional timestamp silently rounded';
    exception when invalid_parameter_value then null;
    end;
    begin
        perform public.apply_library_document('songs','too-high','{"id":"too-high","title":"Bad","content":"x","updatedAt":253402300800000}',false,null);
        raise exception 'Out-of-range timestamp accepted';
    exception when invalid_parameter_value then null;
    end;
    begin
        perform public.apply_library_document('songs','wrong-type','{"id":"wrong-type","title":"Bad","content":"x","twoColumn":"true"}',false,null);
        raise exception 'String boolean accepted';
    exception when invalid_parameter_value then null;
    end;
    begin
        perform public.apply_library_document('songs','wrong-steps','{"id":"wrong-steps","title":"Bad","content":"x","transposeSteps":12}',false,null);
        raise exception 'Invalid transpose accepted';
    exception when invalid_parameter_value then null;
    end;
end;
$$;

select set_config('request.jwt.claims','{"sub":"ac200000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$
begin
    if exists(select 1 from public.songs) or exists(select 1 from public.setlists)
        or exists(select 1 from public.setlist_songs) or exists(select 1 from public.library_documents) then
        raise exception 'User B can read user A through a table or compatibility view';
    end if;
    perform public.apply_library_document('songs','legacy:song/1','{"id":"legacy:song/1","title":"User B","content":"[D]Own song"}',false,null);
    perform public.apply_library_document('setlists','b-list','{"id":"b-list","name":"B only","songIds":["legacy:song/1"]}',false,null);
    if (select count(*) from public.library_documents)<>2 or (select count(*) from public.setlist_songs)<>1 then
        raise exception 'User B cannot read its own relational library';
    end if;
    begin
        perform public.apply_library_document('setlists','cross-owner','{"id":"cross-owner","name":"No","songIds":["s2"]}',false,null);
        raise exception 'RPC accepted another account-only song ID';
    exception when foreign_key_violation then null;
    end;
end;
$$;

-- Each real storage table and the compatibility view deny all direct client mutations.
do $$
declare v_table text;
begin
    foreach v_table in array array['songs','setlists','setlist_songs','library_documents'] loop
        begin
            execute format('delete from public.%I',v_table);
            raise exception 'Client direct delete allowed for %',v_table;
        exception when insufficient_privilege or object_not_in_prerequisite_state then null;
        end;
        begin
            execute format('update public.%I set owner_id=owner_id',v_table);
            raise exception 'Client direct update allowed for %',v_table;
        exception when insufficient_privilege or object_not_in_prerequisite_state then null;
        end;
        begin
            execute format('insert into public.%I default values',v_table);
            raise exception 'Client direct insert allowed for %',v_table;
        exception when insufficient_privilege or object_not_in_prerequisite_state then null;
        end;
    end loop;
    begin
        perform * from chordlibrary_private.library_documents_001;
        raise exception 'Client can read original document archive';
    exception when insufficient_privilege then null;
    end;
    begin
        perform chordlibrary_private.library_timestamp(0);
        raise exception 'Client can execute private conversion helpers';
    exception when insufficient_privilege then null;
    end;
end;
$$;

select set_config('request.jwt.claims','{}',true);
do $$
begin
    begin
        perform public.apply_library_document('songs','no-owner','{"id":"no-owner","title":"No","content":"x"}',false,null);
        raise exception 'RPC accepted absent authenticated owner';
    exception when invalid_authorization_specification then null;
    end;
end;
$$;

reset role;
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$
declare v_table text;
begin
    foreach v_table in array array['songs','setlists','setlist_songs','library_documents'] loop
        begin
            execute format('select count(*) from public.%I',v_table);
            raise exception 'Anonymous read allowed for %',v_table;
        exception when insufficient_privilege then null;
        end;
    end loop;
    begin
        perform public.apply_library_document('songs','anonymous','{"id":"anonymous","title":"No","content":"x"}',false,null);
        raise exception 'Anonymous RPC allowed';
    exception when insufficient_privilege then null;
    end;
end;
$$;

reset role;
-- Privileged writes still cannot evade the compound tenant foreign keys or known-field exclusions.
do $$
begin
    begin
        insert into public.setlist_songs(owner_id,setlist_id,song_id,position)
        values('ac200000-0000-4000-8000-000000000002','b-list','s2',10);
        raise exception 'Song FK failed to enforce same owner';
    exception when foreign_key_violation then null;
    end;
    begin
        insert into public.setlist_songs(owner_id,setlist_id,song_id,position)
        values('ac200000-0000-4000-8000-000000000001','b-list','s2',10);
        raise exception 'Setlist FK failed to enforce same owner';
    exception when foreign_key_violation then null;
    end;
    begin
        update public.songs set extra_fields='{"content":"hidden document"}'::jsonb
        where owner_id='ac200000-0000-4000-8000-000000000001' and id='s2';
        raise exception 'Known song property could be hidden in extra_fields';
    exception when check_violation then null;
    end;
end;
$$;

-- Give A an active membership in the same text song ID that B owns independently.
select set_config('request.jwt.claims','{"sub":"ac200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
begin
    perform public.apply_library_document('setlists','a-cascade',
        '{"id":"a-cascade","name":"Cascade fixture","songIds":["legacy:song/1","s2","legacy:song/1"]}',false,null);
end;
$$;

-- Delete A first and check that B's same-ID song, setlist and membership are untouched.
-- No SET CONSTRAINTS workaround: ordinary immediate account deletion must succeed.
delete from auth.users where id='ac200000-0000-4000-8000-000000000001';
do $$
begin
    if exists(select 1 from public.songs where owner_id='ac200000-0000-4000-8000-000000000001')
        or exists(select 1 from public.setlists where owner_id='ac200000-0000-4000-8000-000000000001')
        or exists(select 1 from public.setlist_songs where owner_id='ac200000-0000-4000-8000-000000000001') then
        raise exception 'User A cascade left relational records behind';
    end if;
    if (select count(*) from public.songs where owner_id='ac200000-0000-4000-8000-000000000002')<>1
        or (select count(*) from public.setlists where owner_id='ac200000-0000-4000-8000-000000000002')<>1
        or (select count(*) from public.setlist_songs where owner_id='ac200000-0000-4000-8000-000000000002')<>1 then
        raise exception 'Deleting user A changed user B records';
    end if;
end;
$$;
delete from auth.users where id='ac200000-0000-4000-8000-000000000002';
do $$
begin
    if exists(select 1 from public.songs where owner_id='ac200000-0000-4000-8000-000000000002')
        or exists(select 1 from public.setlists where owner_id='ac200000-0000-4000-8000-000000000002')
        or exists(select 1 from public.setlist_songs where owner_id='ac200000-0000-4000-8000-000000000002') then
        raise exception 'User B cascade left relational records behind';
    end if;
end;
$$;

-- Emit PASS while still inside the transaction: an earlier failure cannot be masked by ROLLBACK.
select 'PASS: relational tables/types/joins, ordered repeats, exact milliseconds/defaults, unknown-only extras, revisions/conflicts/retries, FK failures, tombstones, RLS/view isolation, revoked direct writes, private archive and user cascade. Final statement rolls back fixtures.' as result;
rollback;
