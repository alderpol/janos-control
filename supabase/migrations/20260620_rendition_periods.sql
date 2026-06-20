-- Rendition periods are determined by the actual work date, with a cutoff on day 20.

alter table public.renditions
  add column if not exists work_date date,
  add column if not exists period_end date;

update public.renditions
set
  work_date = coalesce(work_date, created_at::date),
  period_end = coalesce(
    period_end,
    case
      when extract(day from coalesce(work_date, created_at::date)) <= 20
        then date_trunc('month', coalesce(work_date, created_at::date))::date + 19
      else (date_trunc('month', coalesce(work_date, created_at::date)) + interval '1 month')::date + 19
    end
  )
where work_date is null or period_end is null;

alter table public.renditions
  alter column work_date set not null,
  alter column period_end set not null;

create index if not exists renditions_owner_period_idx
  on public.renditions (owner_id, period_end, status);

