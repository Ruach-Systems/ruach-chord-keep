-- FORWARD migration after 001_library.sql. Review/apply manually, once.
-- Storage becomes PostgreSQL relations. library_documents is only a compatibility SELECT view.
-- Original rows are archived privately; any conversion/reference error rolls back the whole migration.
begin;

lock table public.library_documents in access exclusive mode;
create schema if not exists chordlibrary_private;
revoke all on schema chordlibrary_private from public, anon, authenticated;

alter table public.library_documents set schema chordlibrary_private;
alter table chordlibrary_private.library_documents rename to library_documents_001;
revoke all on chordlibrary_private.library_documents_001 from public, anon, authenticated;
drop policy library_documents_read_own on chordlibrary_private.library_documents_001;

-- Helpers are private and run only through the owner-derived write RPC or this migration.
create function chordlibrary_private.library_integer(
    p_payload jsonb, p_field text, p_default bigint, p_min bigint, p_max bigint
) returns bigint language plpgsql immutable set search_path = '' as $$
declare v_value numeric;
begin
    if not (p_payload ? p_field) then return p_default; end if;
    if jsonb_typeof(p_payload -> p_field) is distinct from 'number' then
        raise exception '% must be an integer number', p_field using errcode = '22023';
    end if;
    v_value := (p_payload ->> p_field)::numeric;
    if v_value <> trunc(v_value) or v_value < p_min or v_value > p_max then
        raise exception '% must be an integer between % and %; timestamps use Unix milliseconds for years 0001 through 9999',
            p_field, p_min, p_max using errcode = '22023';
    end if;
    return v_value::bigint;
end;
$$;

create function chordlibrary_private.library_text(
    p_payload jsonb, p_field text, p_max integer, p_required boolean default false
) returns text language plpgsql immutable set search_path = '' as $$
declare v_value text;
begin
    if not (p_payload ? p_field) or p_payload -> p_field = 'null'::jsonb then
        if p_required then raise exception '% is required', p_field using errcode = '22023'; end if;
        return '';
    end if;
    if jsonb_typeof(p_payload -> p_field) is distinct from 'string' then
        raise exception '% must be text', p_field using errcode = '22023';
    end if;
    v_value := p_payload ->> p_field;
    if length(v_value) > p_max or (p_required and length(btrim(v_value)) = 0) then
        raise exception '% must be %text of at most % characters', p_field,
            case when p_required then 'nonempty ' else '' end, p_max using errcode = '22023';
    end if;
    return v_value;
end;
$$;

create function chordlibrary_private.library_timestamp(p_milliseconds bigint)
returns timestamptz language sql immutable strict set search_path = '' as $$
    -- No floating-point seconds and no session-timezone/DST day arithmetic.
    select (timestamp '1970-01-01 00:00:00'
        + (p_milliseconds / 86400000) * interval '1 day'
        + (p_milliseconds % 86400000) * interval '1 millisecond') at time zone 'UTC';
$$;

create function chordlibrary_private.normalize_library_payload(
    p_collection text, p_id text, p_payload jsonb, p_deleted boolean
) returns jsonb language plpgsql immutable set search_path = '' as $$
declare
    v_created bigint;
    v_updated bigint;
    v_result jsonb;
    v_ids jsonb;
    v_two_column boolean;
begin
    if p_collection is null or p_collection not in ('songs','setlists')
       or p_id is null or length(p_id) not between 1 and 1024 or length(btrim(p_id)) = 0
       or p_payload is null or jsonb_typeof(p_payload) <> 'object'
       or jsonb_typeof(p_payload -> 'id') is distinct from 'string'
       or (p_payload ->> 'id') is distinct from p_id or p_deleted is null then
        raise exception 'Invalid library record or ID' using errcode = '22023';
    end if;
    if p_payload ? 'deleted' and jsonb_typeof(p_payload -> 'deleted') is distinct from 'boolean' then
        raise exception 'deleted must be true or false' using errcode = '22023';
    end if;
    v_created := chordlibrary_private.library_integer(p_payload,'createdAt',0,-62135596800000,253402300799999);
    v_updated := chordlibrary_private.library_integer(p_payload,'updatedAt',v_created,-62135596800000,253402300799999);
    if p_collection = 'songs' then
        if p_payload ? 'twoColumn' and jsonb_typeof(p_payload -> 'twoColumn') is distinct from 'boolean' then
            raise exception 'twoColumn must be true or false' using errcode = '22023';
        end if;
        v_two_column := coalesce((p_payload ->> 'twoColumn')::boolean,false);
        v_result := (p_payload - array['id','title','artist','content','transposeSteps','twoColumn','createdAt','updatedAt','deleted'])
            || jsonb_build_object('id',p_id,
                'title',chordlibrary_private.library_text(p_payload,'title',2000,not p_deleted),
                'artist',chordlibrary_private.library_text(p_payload,'artist',2000),
                'content',chordlibrary_private.library_text(p_payload,'content',1000000,not p_deleted),
                'transposeSteps',chordlibrary_private.library_integer(p_payload,'transposeSteps',0,-11,11),
                'twoColumn',v_two_column,'createdAt',v_created,'updatedAt',v_updated);
    else
        -- A deleted list has no memberships. Otherwise a never-synced missing reference
        -- could permanently block its deletion; its original 001 payload remains archived.
        v_ids := case when p_deleted then '[]'::jsonb when p_payload ? 'songIds' then p_payload -> 'songIds' else '[]'::jsonb end;
        if jsonb_typeof(v_ids) is distinct from 'array' then
            raise exception 'songIds must be an array' using errcode = '22023';
        end if;
        if jsonb_array_length(v_ids) > 10000 or exists(
            select 1 from jsonb_array_elements(v_ids) as x(value)
            where jsonb_typeof(value) <> 'string' or length(value #>> '{}') not between 1 and 1024
                or length(btrim(value #>> '{}')) = 0
        ) then
            raise exception 'songIds must contain at most 10000 nonempty text IDs' using errcode = '22023';
        end if;
        v_result := (p_payload - array['id','name','description','songIds','createdAt','updatedAt','deleted'])
            || jsonb_build_object('id',p_id,
                'name',chordlibrary_private.library_text(p_payload,'name',2000,not p_deleted),
                'description',chordlibrary_private.library_text(p_payload,'description',100000),
                'songIds',v_ids,'createdAt',v_created,'updatedAt',v_updated);
    end if;
    -- Deleted=false and an omitted deleted field are the same canonical active record.
    if p_deleted then v_result := v_result || jsonb_build_object('deleted',true); end if;
    return v_result;
end;
$$;

revoke all on all functions in schema chordlibrary_private from public, anon, authenticated;

create table public.songs (
    owner_id uuid not null references auth.users(id) on delete cascade,
    id text not null check (length(id) between 1 and 1024 and length(btrim(id)) > 0),
    title text not null check (length(title) <= 2000),
    artist text not null default '' check (length(artist) <= 2000),
    content text not null check (length(content) <= 1000000),
    transpose_steps smallint not null default 0 check (transpose_steps between -11 and 11),
    two_column boolean not null default false,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    revision bigint not null default nextval('public.library_revision_seq') check (revision > 0),
    deleted boolean not null default false,
    server_updated_at timestamptz not null default clock_timestamp(),
    extra_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(extra_fields) = 'object'
        and not (extra_fields ?| array['id','title','artist','content','transposeSteps','twoColumn','createdAt','updatedAt','deleted'])),
    primary key (owner_id,id),
    unique (revision),
    check (created_at >= timestamptz '0001-01-01 00:00:00+00' and created_at <= timestamptz '9999-12-31 23:59:59.999+00'),
    check (updated_at >= timestamptz '0001-01-01 00:00:00+00' and updated_at <= timestamptz '9999-12-31 23:59:59.999+00'),
    check (created_at = date_trunc('milliseconds',created_at) and updated_at = date_trunc('milliseconds',updated_at))
);

create table public.setlists (
    owner_id uuid not null references auth.users(id) on delete cascade,
    id text not null check (length(id) between 1 and 1024 and length(btrim(id)) > 0),
    name text not null check (length(name) <= 2000),
    description text not null default '' check (length(description) <= 100000),
    created_at timestamptz not null,
    updated_at timestamptz not null,
    revision bigint not null default nextval('public.library_revision_seq') check (revision > 0),
    deleted boolean not null default false,
    server_updated_at timestamptz not null default clock_timestamp(),
    extra_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(extra_fields) = 'object'
        and not (extra_fields ?| array['id','name','description','songIds','createdAt','updatedAt','deleted'])),
    primary key (owner_id,id),
    unique (revision),
    check (created_at >= timestamptz '0001-01-01 00:00:00+00' and created_at <= timestamptz '9999-12-31 23:59:59.999+00'),
    check (updated_at >= timestamptz '0001-01-01 00:00:00+00' and updated_at <= timestamptz '9999-12-31 23:59:59.999+00'),
    check (created_at = date_trunc('milliseconds',created_at) and updated_at = date_trunc('milliseconds',updated_at))
);

create table public.setlist_songs (
    owner_id uuid not null,
    setlist_id text not null,
    song_id text not null,
    position integer not null check (position between 0 and 9999),
    primary key (owner_id,setlist_id,position),
    foreign key (owner_id,setlist_id) references public.setlists(owner_id,id) on delete cascade,
    foreign key (owner_id,song_id) references public.songs(owner_id,id) on delete no action deferrable initially immediate
);
create index songs_owner_revision_idx on public.songs(owner_id,revision);
create index setlists_owner_revision_idx on public.setlists(owner_id,revision);
create index setlist_songs_owner_song_idx on public.setlist_songs(owner_id,song_id);

alter table public.songs enable row level security;
alter table public.setlists enable row level security;
alter table public.setlist_songs enable row level security;
create policy songs_read_own on public.songs for select to authenticated using (owner_id = (select auth.uid()));
create policy setlists_read_own on public.setlists for select to authenticated using (owner_id = (select auth.uid()));
create policy setlist_songs_read_own on public.setlist_songs for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.songs,public.setlists,public.setlist_songs from public,anon,authenticated;
grant select on public.songs,public.setlists,public.setlist_songs to authenticated;

-- Convert every old row, retaining its owner, legacy ID, revision, deletion and server timestamp.
insert into public.songs(owner_id,id,title,artist,content,transpose_steps,two_column,created_at,updated_at,revision,deleted,server_updated_at,extra_fields)
select d.owner_id,d.id,p.value->>'title',p.value->>'artist',p.value->>'content',
    (p.value->>'transposeSteps')::smallint,(p.value->>'twoColumn')::boolean,
    chordlibrary_private.library_timestamp((p.value->>'createdAt')::bigint),
    chordlibrary_private.library_timestamp((p.value->>'updatedAt')::bigint),d.revision,d.deleted,d.server_updated_at,
    p.value-array['id','title','artist','content','transposeSteps','twoColumn','createdAt','updatedAt','deleted']
from chordlibrary_private.library_documents_001 d
cross join lateral (select chordlibrary_private.normalize_library_payload(d.collection,d.id,d.payload,d.deleted) as value) p
where d.collection='songs';

insert into public.setlists(owner_id,id,name,description,created_at,updated_at,revision,deleted,server_updated_at,extra_fields)
select d.owner_id,d.id,p.value->>'name',p.value->>'description',
    chordlibrary_private.library_timestamp((p.value->>'createdAt')::bigint),
    chordlibrary_private.library_timestamp((p.value->>'updatedAt')::bigint),d.revision,d.deleted,d.server_updated_at,
    p.value-array['id','name','description','songIds','createdAt','updatedAt','deleted']
from chordlibrary_private.library_documents_001 d
cross join lateral (select chordlibrary_private.normalize_library_payload(d.collection,d.id,d.payload,d.deleted) as value) p
where d.collection='setlists';

do $$
declare v_missing record;
begin
    select d.id as setlist_id,x.song_id into v_missing
    from chordlibrary_private.library_documents_001 d
    cross join lateral jsonb_array_elements_text(coalesce(d.payload->'songIds','[]'::jsonb)) x(song_id)
    left join public.songs s on s.owner_id=d.owner_id and s.id=x.song_id
    where d.collection='setlists' and not d.deleted and s.id is null limit 1;
    if found then
        raise exception 'Cannot migrate setlist "%": referenced song "%" is missing for this owner. Restore the missing song or repair the source; this migration is rolled back.',
            v_missing.setlist_id,v_missing.song_id using errcode='23503';
    end if;
end;
$$;

insert into public.setlist_songs(owner_id,setlist_id,song_id,position)
select d.owner_id,d.id,x.song_id,(x.ordinality-1)::integer
from chordlibrary_private.library_documents_001 d
cross join lateral jsonb_array_elements_text(coalesce(d.payload->'songIds','[]'::jsonb)) with ordinality x(song_id,ordinality)
where d.collection='setlists' and not d.deleted;

-- Compatibility transport only: no persisted payload column exists in any public storage table.
create view public.library_documents with (security_invoker=true) as
select s.owner_id,'songs'::text as collection,s.id,
    s.extra_fields || jsonb_build_object('id',s.id,'title',s.title,'artist',s.artist,'content',s.content,
        'transposeSteps',s.transpose_steps,'twoColumn',s.two_column,
        'createdAt',(extract(epoch from s.created_at)*1000)::bigint,
        'updatedAt',(extract(epoch from s.updated_at)*1000)::bigint)
        || case when s.deleted then jsonb_build_object('deleted',true) else '{}'::jsonb end as payload,
    s.deleted,s.revision,s.server_updated_at
from public.songs s
union all
select l.owner_id,'setlists'::text,l.id,
    l.extra_fields || jsonb_build_object('id',l.id,'name',l.name,'description',l.description,
        'songIds',coalesce((select jsonb_agg(m.song_id order by m.position) from public.setlist_songs m
            where m.owner_id=l.owner_id and m.setlist_id=l.id),'[]'::jsonb),
        'createdAt',(extract(epoch from l.created_at)*1000)::bigint,
        'updatedAt',(extract(epoch from l.updated_at)*1000)::bigint)
        || case when l.deleted then jsonb_build_object('deleted',true) else '{}'::jsonb end,
    l.deleted,l.revision,l.server_updated_at
from public.setlists l;

revoke all on public.library_documents from public,anon,authenticated;
grant select on public.library_documents to authenticated;

create or replace function public.apply_library_document(
    p_collection text,p_id text,p_payload jsonb,p_deleted boolean default false,p_expected_revision bigint default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_owner uuid := auth.uid();
    v_current public.library_documents%rowtype;
    v_payload jsonb;
    v_revision bigint;
    v_missing_song text;
begin
    if v_owner is null then raise exception 'Authentication required' using errcode='28000'; end if;
    if p_expected_revision is not null and p_expected_revision < 1 then
        raise exception 'Expected revision must be positive' using errcode='22023';
    end if;
    v_payload := chordlibrary_private.normalize_library_payload(p_collection,p_id,p_payload,p_deleted);
    -- The same per-owner lock from 001 keeps revision assignment ordered by committed transaction.
    perform pg_advisory_xact_lock(hashtextextended(v_owner::text,572804));
    select * into v_current from public.library_documents
        where owner_id=v_owner and collection=p_collection and id=p_id;
    if found then
        if v_current.payload=v_payload and v_current.deleted=p_deleted then
            return jsonb_build_object('applied',true,'document',to_jsonb(v_current)-'owner_id');
        end if;
        if p_expected_revision is null or v_current.revision<>p_expected_revision then
            return jsonb_build_object('applied',false,'document',to_jsonb(v_current)-'owner_id');
        end if;
    elsif p_expected_revision is not null then
        raise exception 'The expected record no longer exists; pull before retrying' using errcode='40001';
    end if;

    if p_collection='setlists' then
        select x.song_id into v_missing_song from jsonb_array_elements_text(v_payload->'songIds') x(song_id)
        left join public.songs s on s.owner_id=v_owner and s.id=x.song_id
        where s.id is null limit 1;
        if found then
            raise exception 'Setlist "%" references song "%", which has not been synced for this account. Import/sync the missing songs or remove those references, then retry.',
                p_id,v_missing_song using errcode='23503';
        end if;
    end if;
    v_revision := nextval('public.library_revision_seq');
    if p_collection='songs' then
        insert into public.songs(owner_id,id,title,artist,content,transpose_steps,two_column,created_at,updated_at,revision,deleted,server_updated_at,extra_fields)
        values(v_owner,p_id,v_payload->>'title',v_payload->>'artist',v_payload->>'content',
            (v_payload->>'transposeSteps')::smallint,(v_payload->>'twoColumn')::boolean,
            chordlibrary_private.library_timestamp((v_payload->>'createdAt')::bigint),
            chordlibrary_private.library_timestamp((v_payload->>'updatedAt')::bigint),v_revision,p_deleted,clock_timestamp(),
            v_payload-array['id','title','artist','content','transposeSteps','twoColumn','createdAt','updatedAt','deleted'])
        on conflict(owner_id,id) do update set title=excluded.title,artist=excluded.artist,content=excluded.content,
            transpose_steps=excluded.transpose_steps,two_column=excluded.two_column,created_at=excluded.created_at,
            updated_at=excluded.updated_at,revision=excluded.revision,deleted=excluded.deleted,
            server_updated_at=excluded.server_updated_at,extra_fields=excluded.extra_fields;
    else
        insert into public.setlists(owner_id,id,name,description,created_at,updated_at,revision,deleted,server_updated_at,extra_fields)
        values(v_owner,p_id,v_payload->>'name',v_payload->>'description',
            chordlibrary_private.library_timestamp((v_payload->>'createdAt')::bigint),
            chordlibrary_private.library_timestamp((v_payload->>'updatedAt')::bigint),v_revision,p_deleted,clock_timestamp(),
            v_payload-array['id','name','description','songIds','createdAt','updatedAt','deleted'])
        on conflict(owner_id,id) do update set name=excluded.name,description=excluded.description,
            created_at=excluded.created_at,updated_at=excluded.updated_at,revision=excluded.revision,
            deleted=excluded.deleted,server_updated_at=excluded.server_updated_at,extra_fields=excluded.extra_fields;
        delete from public.setlist_songs where owner_id=v_owner and setlist_id=p_id;
        insert into public.setlist_songs(owner_id,setlist_id,song_id,position)
        select v_owner,p_id,x.song_id,(x.ordinality-1)::integer
        from jsonb_array_elements_text(v_payload->'songIds') with ordinality x(song_id,ordinality);
    end if;
    select * into v_current from public.library_documents where owner_id=v_owner and collection=p_collection and id=p_id;
    return jsonb_build_object('applied',true,'document',to_jsonb(v_current)-'owner_id');
end;
$$;

revoke all on function public.apply_library_document(text,text,jsonb,boolean,bigint) from public,anon;
grant execute on function public.apply_library_document(text,text,jsonb,boolean,bigint) to authenticated;
revoke all on sequence public.library_revision_seq from public,anon,authenticated;

-- Preserve a sequence that was already ahead; never reuse an archived or migrated revision.
select setval('public.library_revision_seq',greatest(
    (select last_value from public.library_revision_seq),
    coalesce((select max(revision) from public.library_documents),1)),true);

comment on table public.songs is 'Relational song storage. Known song attributes are typed columns; extra_fields contains unknown extension attributes only.';
comment on table public.setlists is 'Relational setlist storage. Ordered song membership is stored in public.setlist_songs.';
comment on table public.setlist_songs is 'Ordered same-owner song membership; repeated songs at different positions are preserved.';
comment on view public.library_documents is 'Read-only compatibility API synthesized from relational songs, setlists and memberships; stores no JSON documents.';
comment on table chordlibrary_private.library_documents_001 is 'Private read-only-by-client archive retained by migration 002. Not exposed by the app or Data API.';

notify pgrst,'reload schema';
commit;
