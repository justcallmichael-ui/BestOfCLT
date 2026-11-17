create table tournaments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category text not null,
  status text not null default 'draft' check (status in ('draft','nominations','bracket','complete')),
  field_size int not null default 64,
  round_days int not null default 3,
  nominations_open_at timestamptz,
  nominations_close_at timestamptz,
  created_at timestamptz not null default now()
);

create table entrants (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  ig_handle text not null,
  display_name text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn')),
  upvote_count int not null default 0,
  first_nominated_at timestamptz not null default now(),
  seed int,
  region int check (region is null or region between 1 and 4),
  unique (tournament_id, ig_handle)
);
create index entrants_tournament_status_upvotes_idx on entrants (tournament_id, status, upvote_count);

create table voters (
  id uuid primary key default gen_random_uuid(),
  cookie_id text not null unique,
  fingerprint_hash text,
  ip_hash text,
  first_seen_at timestamptz not null default now(),
  flagged boolean not null default false,
  email text
);
create index voters_fingerprint_hash_idx on voters (fingerprint_hash);

create table upvotes (
  id uuid primary key default gen_random_uuid(),
  entrant_id uuid not null references entrants(id) on delete cascade,
  voter_id uuid not null references voters(id) on delete cascade,
  ip_hash text not null,
  created_at timestamptz not null default now(),
  unique (entrant_id, voter_id)
);
create index upvotes_entrant_ip_created_idx on upvotes (entrant_id, ip_hash, created_at);
create index upvotes_voter_idx on upvotes (voter_id);

create table rounds (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  number int not null,
  name text not null,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','open','closed')),
  unique (tournament_id, number)
);

create table matchups (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references rounds(id) on delete cascade,
  slot int not null,
  region int check (region is null or region between 1 and 4),
  entrant_a_id uuid references entrants(id) on delete set null,
  entrant_b_id uuid references entrants(id) on delete set null,
  votes_a int not null default 0,
  votes_b int not null default 0,
  winner_id uuid references entrants(id) on delete set null,
  decided_by text check (decided_by is null or decided_by in ('votes','seed_tiebreak','admin_override','withdrawal')),
  unique (round_id, slot)
);
create index matchups_round_idx on matchups (round_id);

create table votes (
  id uuid primary key default gen_random_uuid(),
  matchup_id uuid not null references matchups(id) on delete cascade,
  voter_id uuid not null references voters(id) on delete cascade,
  choice text not null check (choice in ('a','b')),
  ip_hash text not null,
  excluded boolean not null default false,
  created_at timestamptz not null default now(),
  unique (matchup_id, voter_id)
);
create index votes_matchup_idx on votes (matchup_id);
create index votes_matchup_ip_created_idx on votes (matchup_id, ip_hash, created_at);
create index votes_voter_idx on votes (voter_id);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table tournaments enable row level security;
alter table entrants enable row level security;
alter table voters enable row level security;
alter table upvotes enable row level security;
alter table rounds enable row level security;
alter table matchups enable row level security;
alter table votes enable row level security;
alter table audit_log enable row level security;
