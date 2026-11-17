-- Staggered schedule: every matchup has its own window and status.
alter table matchups add column opens_at timestamptz;
alter table matchups add column closes_at timestamptz;
alter table matchups add column status text not null default 'scheduled' check (status in ('scheduled','open','closed'));

alter table tournaments add column bracket_starts_at timestamptz;

-- Carry any existing bracket over: each matchup inherits its round's window and status.
update matchups m
set opens_at = r.opens_at,
    closes_at = r.closes_at,
    status = r.status
from rounds r
where r.id = m.round_id;

create index matchups_status_closes_idx on matchups (status, closes_at);
create index matchups_status_opens_idx on matchups (status, opens_at);
