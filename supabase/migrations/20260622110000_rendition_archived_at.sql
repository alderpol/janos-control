alter table public.renditions
  add column if not exists archived_at timestamptz;

create index if not exists renditions_owner_archived_idx
  on public.renditions (owner_id, archived_at)
  where archived_at is null;
