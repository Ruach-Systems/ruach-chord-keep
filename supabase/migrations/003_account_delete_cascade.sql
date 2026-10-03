-- FORWARD fix after applied 002. Do not rewrite the already-applied migration.
-- Physical account cleanup must not depend on the order of auth.users cascade triggers.
-- App song deletion remains a revision-checked UPDATE to deleted=true, not a physical DELETE.
begin;

alter table public.setlist_songs
    drop constraint setlist_songs_owner_id_song_id_fkey,
    add constraint setlist_songs_owner_id_song_id_fkey
        foreign key (owner_id,song_id)
        references public.songs(owner_id,id)
        on delete cascade
        deferrable initially immediate;

comment on constraint setlist_songs_owner_id_song_id_fkey on public.setlist_songs is
    'Same-owner membership. Physical parent deletion cascades for administrative/account cleanup; ordinary app deletes use song tombstones and retain membership until explicit setlist repair.';

notify pgrst,'reload schema';
commit;
