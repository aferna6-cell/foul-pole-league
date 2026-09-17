-- Foul Pole League slice 1: shared live scoreboard
-- Invariants: max 1 town + 1 clan; 48h clan switch cooldown; Meet.level local|national;
-- best-1-per-player, top 9, empty slots visible; roster non-empty => listed-only;
-- dual-count; town credit only inside an active town-vs-town meet; neutral park_seed.
-- Cosmetics/ads/shop are intentionally absent.

create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to postgres, service_role;

create type public.meet_level as enum ('local', 'national');
create type public.meet_kind as enum ('clan_vs_clan', 'town_vs_town');
create type public.meet_status as enum ('scheduled', 'live', 'final');
create type public.meet_side as enum ('home', 'away');
create type public.clan_scope as enum ('local', 'national');

create table public.towns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  region_key text not null,
  created_at timestamptz not null default now(),
  constraint towns_name_len check (char_length(trim(name)) between 1 and 40)
);

create unique index towns_name_lower_idx on public.towns (lower(name));
create index towns_region_key_idx on public.towns (region_key);

create table public.clans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,
  scope public.clan_scope not null default 'local',
  town_id uuid references public.towns (id),
  captain_player_id uuid,
  colors jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint clans_name_len check (char_length(trim(name)) between 1 and 40),
  constraint clans_code_fmt check (code ~ '^[A-Z0-9]{3,8}$'),
  constraint clans_local_needs_town check (scope = 'national' or town_id is not null)
);

create unique index clans_code_idx on public.clans (code);
create index clans_town_id_idx on public.clans (town_id);
create index clans_scope_idx on public.clans (scope);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  display_name text,
  town_id uuid references public.towns (id),
  clan_id uuid references public.clans (id),
  clan_joined_at timestamptz,
  clan_cooldown_until timestamptz,
  created_at timestamptz not null default now(),
  constraint players_display_name_len check (
    display_name is null or char_length(trim(display_name)) between 1 and 24
  )
);

create index players_town_id_idx on public.players (town_id);
create index players_clan_id_idx on public.players (clan_id);

alter table public.clans
  add constraint clans_captain_fk
  foreign key (captain_player_id) references public.players (id);

create table public.meets (
  id uuid primary key default gen_random_uuid(),
  kind public.meet_kind not null,
  level public.meet_level not null,
  home_side_id uuid not null,
  away_side_id uuid not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  park_seed text not null default 'neutral-v1',
  status public.meet_status not null default 'scheduled',
  home_wins integer not null default 0,
  away_wins integer not null default 0,
  created_at timestamptz not null default now(),
  constraint meets_window_chk check (window_end > window_start),
  constraint meets_sides_distinct check (home_side_id <> away_side_id),
  constraint meets_wins_nonneg check (home_wins >= 0 and away_wins >= 0)
);

create index meets_status_window_idx on public.meets (status, window_start, window_end);
create index meets_kind_level_idx on public.meets (kind, level);
create index meets_home_side_idx on public.meets (home_side_id);
create index meets_away_side_idx on public.meets (away_side_id);

create table public.meet_roster (
  meet_id uuid not null references public.meets (id) on delete cascade,
  side public.meet_side not null,
  player_id uuid not null references public.players (id),
  listed_at timestamptz not null default now(),
  primary key (meet_id, player_id)
);

create index meet_roster_side_idx on public.meet_roster (meet_id, side);
create index meet_roster_player_idx on public.meet_roster (player_id);

create table public.swings (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id),
  feet integer not null,
  is_homer boolean not null default false,
  at timestamptz not null default now(),
  park_seed text not null,
  meet_id uuid references public.meets (id),
  town_meet_id uuid references public.meets (id),
  clan_id uuid references public.clans (id),
  town_id uuid references public.towns (id),
  counts_for_clan_meet boolean not null default false,
  counts_for_town_rollup boolean not null default false,
  constraint swings_feet_nonneg check (feet >= 0)
);

create index swings_player_at_idx on public.swings (player_id, at desc);
create index swings_at_idx on public.swings (at desc);
create index swings_meet_id_idx on public.swings (meet_id) where meet_id is not null;
create index swings_town_meet_id_idx on public.swings (town_meet_id) where town_meet_id is not null;
create index swings_clan_credit_idx on public.swings (meet_id, player_id, feet desc)
  where counts_for_clan_meet;
create index swings_town_credit_idx on public.swings (town_meet_id, player_id, feet desc)
  where counts_for_town_rollup;

-- ---------------------------------------------------------------------------
-- RLS: public read for the live board; all writes go through RPCs.
-- ---------------------------------------------------------------------------
alter table public.towns enable row level security;
alter table public.clans enable row level security;
alter table public.players enable row level security;
alter table public.meets enable row level security;
alter table public.meet_roster enable row level security;
alter table public.swings enable row level security;

create policy towns_select on public.towns for select to anon, authenticated using (true);
create policy clans_select on public.clans for select to anon, authenticated using (true);
create policy players_select on public.players for select to anon, authenticated using (true);
create policy meets_select on public.meets for select to anon, authenticated using (true);
create policy meet_roster_select on public.meet_roster for select to anon, authenticated using (true);
create policy swings_select on public.swings for select to anon, authenticated using (true);

grant usage on schema public to anon, authenticated;
grant select on public.towns, public.clans, public.players, public.meets, public.meet_roster, public.swings
  to anon, authenticated;

-- Realtime: posted swings appear on other clients in a few seconds.
do $$
begin
  begin
    alter publication supabase_realtime add table public.swings;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.meets;
  exception when duplicate_object then null;
  end;
end $$;

alter table public.swings replica identity full;
alter table public.meets replica identity full;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.clamp_name(p text, p_max int)
returns text
language sql
immutable
as $$
  select nullif(left(trim(coalesce(p, '')), p_max), '');
$$;

create or replace function private.side_name(p_kind public.meet_kind, p_side_id uuid)
returns text
language plpgsql
stable
as $$
declare
  n text;
begin
  if p_kind = 'clan_vs_clan' then
    select name into n from public.clans where id = p_side_id;
  else
    select name into n from public.towns where id = p_side_id;
  end if;
  return coalesce(n, 'Unknown');
end;
$$;

create or replace function private.roster_nonempty(p_meet_id uuid, p_side public.meet_side)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.meet_roster r
    where r.meet_id = p_meet_id and r.side = p_side
  );
$$;

create or replace function private.player_eligible_for_side(
  p_meet public.meets,
  p_side public.meet_side,
  p_player public.players
) returns boolean
language plpgsql
stable
as $$
declare
  sid uuid;
  listed boolean;
begin
  sid := case when p_side = 'home' then p_meet.home_side_id else p_meet.away_side_id end;
  listed := exists (
    select 1 from public.meet_roster r
    where r.meet_id = p_meet.id and r.side = p_side and r.player_id = p_player.id
  );
  if private.roster_nonempty(p_meet.id, p_side) then
    return listed;
  end if;
  if p_meet.kind = 'clan_vs_clan' then
    return p_player.clan_id is not null and p_player.clan_id = sid;
  end if;
  return p_player.town_id is not null and p_player.town_id = sid;
end;
$$;

create or replace function private.player_side_for_meet(
  p_meet public.meets,
  p_player public.players
) returns public.meet_side
language plpgsql
stable
as $$
begin
  if private.player_eligible_for_side(p_meet, 'home', p_player) then
    return 'home';
  end if;
  if private.player_eligible_for_side(p_meet, 'away', p_player) then
    return 'away';
  end if;
  return null;
end;
$$;

create or replace function private.touch_meet_statuses()
returns void
language plpgsql
as $$
declare
  m public.meets;
  home_total int;
  away_total int;
begin
  update public.meets
  set status = 'live'
  where status = 'scheduled'
    and now() >= window_start
    and now() <= window_end;

  for m in
    select * from public.meets
    where status = 'live' and now() > window_end
  loop
    home_total := (private.side_score(m, 'home')).total_feet;
    away_total := (private.side_score(m, 'away')).total_feet;
    update public.meets
    set
      status = 'final',
      home_wins = home_wins + case when home_total > away_total then 1 else 0 end,
      away_wins = away_wins + case when away_total > home_total then 1 else 0 end
    where id = m.id;
  end loop;
end;
$$;

create or replace function private.credited_swings(p_meet public.meets)
returns table (player_id uuid, feet int, at timestamptz, clan_id uuid, town_id uuid)
language sql
stable
as $$
  select s.player_id, s.feet, s.at, s.clan_id, s.town_id
  from public.swings s
  where s.at >= p_meet.window_start
    and s.at <= p_meet.window_end
    and (
      (p_meet.kind = 'clan_vs_clan'
        and s.counts_for_clan_meet
        and s.meet_id = p_meet.id)
      or
      (p_meet.kind = 'town_vs_town'
        and s.counts_for_town_rollup
        and coalesce(s.town_meet_id, s.meet_id) = p_meet.id)
    );
$$;

create type private.side_score_t as (
  total_feet int,
  slots int,
  slots_json jsonb
);

create or replace function private.side_score(p_meet public.meets, p_side public.meet_side)
returns private.side_score_t
language plpgsql
stable
as $$
declare
  sid uuid;
  rec private.side_score_t;
  roster_on boolean;
begin
  sid := case when p_side = 'home' then p_meet.home_side_id else p_meet.away_side_id end;
  roster_on := private.roster_nonempty(p_meet.id, p_side);

  with eligible as (
    select cs.player_id, cs.feet, cs.at
    from private.credited_swings(p_meet) cs
    where (
      roster_on and exists (
        select 1 from public.meet_roster r
        where r.meet_id = p_meet.id and r.side = p_side and r.player_id = cs.player_id
      )
    ) or (
      not roster_on and (
        (p_meet.kind = 'clan_vs_clan' and cs.clan_id = sid)
        or (p_meet.kind = 'town_vs_town' and cs.town_id = sid)
      )
    )
  ),
  best as (
    select distinct on (player_id) player_id, feet, at
    from eligible
    order by player_id, feet desc, at asc
  ),
  top9 as (
    select b.player_id, b.feet, b.at, p.display_name,
           row_number() over (order by b.feet desc, b.at asc) as rn
    from best b
    join public.players p on p.id = b.player_id
    order by b.feet desc, b.at asc
    limit 9
  )
  select
    coalesce(sum(feet), 0)::int,
    count(*)::int,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'player_id', player_id,
          'display_name', display_name,
          'feet', feet
        ) order by rn
      ),
      '[]'::jsonb
    )
  into rec.total_feet, rec.slots, rec.slots_json
  from top9;

  rec.total_feet := coalesce(rec.total_feet, 0);
  rec.slots := coalesce(rec.slots, 0);
  rec.slots_json := coalesce(rec.slots_json, '[]'::jsonb);
  return rec;
end;
$$;

create or replace function private.meet_payload(p_meet public.meets)
returns jsonb
language plpgsql
stable
as $$
declare
  home_s private.side_score_t;
  away_s private.side_score_t;
  home_n text;
  away_n text;
  ticker text;
begin
  home_s := private.side_score(p_meet, 'home');
  away_s := private.side_score(p_meet, 'away');
  home_n := private.side_name(p_meet.kind, p_meet.home_side_id);
  away_n := private.side_name(p_meet.kind, p_meet.away_side_id);
  ticker := format(
    '%s %s ft (%s/9) vs %s %s ft (%s/9)',
    home_n,
    trim(to_char(home_s.total_feet, 'FM999,999')),
    home_s.slots,
    away_n,
    trim(to_char(away_s.total_feet, 'FM999,999')),
    away_s.slots
  );
  return jsonb_build_object(
    'id', p_meet.id,
    'kind', p_meet.kind,
    'level', p_meet.level,
    'status', p_meet.status,
    'park_seed', p_meet.park_seed,
    'window_start', p_meet.window_start,
    'window_end', p_meet.window_end,
    'home_wins', p_meet.home_wins,
    'away_wins', p_meet.away_wins,
    'home', jsonb_build_object(
      'id', p_meet.home_side_id,
      'name', home_n,
      'total_feet', home_s.total_feet,
      'slots', home_s.slots,
      'slot_rows', home_s.slots_json
    ),
    'away', jsonb_build_object(
      'id', p_meet.away_side_id,
      'name', away_n,
      'total_feet', away_s.total_feet,
      'slots', away_s.slots,
      'slot_rows', away_s.slots_json
    ),
    'ticker', ticker
  );
end;
$$;

create or replace function private.find_live_meet(
  p_player public.players,
  p_kind public.meet_kind
) returns public.meets
language plpgsql
stable
as $$
declare
  m public.meets;
begin
  for m in
    select *
    from public.meets
    where kind = p_kind
      and status = 'live'
      and now() >= window_start
      and now() <= window_end
    order by window_start asc
  loop
    if private.player_side_for_meet(m, p_player) is not null then
      return m;
    end if;
  end loop;
  return null;
end;
$$;

create or replace function private.ny_today_start()
returns timestamptz
language sql
stable
as $$
  select (date_trunc('day', timezone('America/New_York', now()))
    at time zone 'America/New_York');
$$;

create or replace function private.board_rows_players_tonight()
returns jsonb
language sql
stable
as $$
  with eligible as (
    select s.player_id, max(s.feet) as feet
    from public.swings s
    where s.at >= private.ny_today_start()
      and (s.counts_for_clan_meet or s.counts_for_town_rollup)
    group by s.player_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', e.player_id,
        'name', coalesce(nullif(p.display_name, ''), 'Anonymous'),
        'feet', e.feet
      ) order by e.feet desc
    ),
    '[]'::jsonb
  )
  from eligible e
  join public.players p on p.id = e.player_id;
$$;

create or replace function private.town_totals(p_region text)
returns jsonb
language sql
stable
as $$
  with scored as (
    select m.*, t.id as town_id, t.name as town_name, t.region_key,
           case when t.id = m.home_side_id
             then (private.side_score(m, 'home')).total_feet
             else (private.side_score(m, 'away')).total_feet
           end as feet
    from public.meets m
    join public.towns t
      on t.id in (m.home_side_id, m.away_side_id)
    where m.kind = 'town_vs_town'
      and m.status in ('live', 'final')
      and (p_region is null or t.region_key = p_region)
  ),
  summed as (
    select town_id, town_name, region_key, sum(feet)::int as feet
    from scored
    group by town_id, town_name, region_key
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', town_id,
        'name', town_name,
        'region_key', region_key,
        'feet', feet
      ) order by feet desc, town_name
    ),
    '[]'::jsonb
  )
  from summed;
$$;

create or replace function private.clan_totals(p_region text)
returns jsonb
language sql
stable
as $$
  with scored as (
    select m.*, c.id as clan_id, c.name as clan_name, c.scope, t.region_key,
           case when c.id = m.home_side_id
             then (private.side_score(m, 'home')).total_feet
             else (private.side_score(m, 'away')).total_feet
           end as feet
    from public.meets m
    join public.clans c
      on c.id in (m.home_side_id, m.away_side_id)
    left join public.towns t on t.id = c.town_id
    where m.kind = 'clan_vs_clan'
      and m.status in ('live', 'final')
      and (p_region is null or t.region_key = p_region)
  ),
  summed as (
    select clan_id, clan_name, scope, region_key, sum(feet)::int as feet
    from scored
    group by clan_id, clan_name, scope, region_key
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', clan_id,
        'name', clan_name,
        'scope', scope,
        'region_key', region_key,
        'feet', feet
      ) order by feet desc, clan_name
    ),
    '[]'::jsonb
  )
  from summed;
$$;

create or replace function private.personal_best_board()
returns jsonb
language sql
stable
as $$
  with best as (
    select s.player_id, max(s.feet) as feet
    from public.swings s
    where s.feet > 0
    group by s.player_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', b.player_id,
        'name', coalesce(nullif(p.display_name, ''), 'Anonymous'),
        'feet', b.feet
      ) order by b.feet desc
    ),
    '[]'::jsonb
  )
  from best b
  join public.players p on p.id = b.player_id;
$$;

-- Roster cap ~15 per side (listing, not scoring).
create or replace function private.enforce_roster_cap()
returns trigger
language plpgsql
as $$
begin
  if (
    select count(*) from public.meet_roster
    where meet_id = new.meet_id and side = new.side
  ) >= 15 then
    raise exception 'Roster list is capped at 15 per side';
  end if;
  return new;
end;
$$;

create trigger meet_roster_cap
before insert on public.meet_roster
for each row execute function private.enforce_roster_cap();

-- ---------------------------------------------------------------------------
-- Public RPCs (thin SECURITY DEFINER wrappers; logic lives in private)
-- ---------------------------------------------------------------------------
create or replace function private.ensure_player(p_player_id uuid)
returns public.players
language plpgsql
as $$
declare
  rec public.players;
begin
  if p_player_id is null then
    raise exception 'player id required';
  end if;
  insert into public.players (id)
  values (p_player_id)
  on conflict (id) do nothing;
  select * into rec from public.players where id = p_player_id;
  return rec;
end;
$$;

create or replace function private.set_display_name(p_player_id uuid, p_name text)
returns public.players
language plpgsql
as $$
declare
  rec public.players;
  n text;
begin
  rec := private.ensure_player(p_player_id);
  n := private.clamp_name(p_name, 24);
  update public.players set display_name = n where id = p_player_id
  returning * into rec;
  return rec;
end;
$$;

create or replace function private.set_town(p_player_id uuid, p_town_id uuid)
returns public.players
language plpgsql
as $$
declare
  rec public.players;
begin
  rec := private.ensure_player(p_player_id);
  if p_town_id is not null and not exists (select 1 from public.towns where id = p_town_id) then
    raise exception 'Unknown town';
  end if;
  update public.players set town_id = p_town_id where id = p_player_id
  returning * into rec;
  return rec;
end;
$$;

create or replace function private.join_clan(p_player_id uuid, p_clan_id uuid)
returns public.players
language plpgsql
as $$
declare
  rec public.players;
begin
  rec := private.ensure_player(p_player_id);
  if p_clan_id is null or not exists (select 1 from public.clans where id = p_clan_id) then
    raise exception 'Unknown clan';
  end if;
  if rec.clan_id is not distinct from p_clan_id then
    return rec;
  end if;
  if rec.clan_cooldown_until is not null and now() < rec.clan_cooldown_until then
    raise exception 'Clan switch cooldown until %', rec.clan_cooldown_until;
  end if;
  update public.players
  set
    clan_id = p_clan_id,
    clan_joined_at = now(),
    clan_cooldown_until = case
      when rec.clan_id is not null then now() + interval '48 hours'
      else rec.clan_cooldown_until
    end
  where id = p_player_id
  returning * into rec;
  return rec;
end;
$$;

create or replace function private.leave_clan(p_player_id uuid)
returns public.players
language plpgsql
as $$
declare
  rec public.players;
begin
  rec := private.ensure_player(p_player_id);
  if rec.clan_id is null then
    return rec;
  end if;
  update public.players
  set
    clan_id = null,
    clan_joined_at = null,
    clan_cooldown_until = now() + interval '48 hours'
  where id = p_player_id
  returning * into rec;
  return rec;
end;
$$;

create or replace function private.create_town(p_name text, p_region_key text)
returns public.towns
language plpgsql
as $$
declare
  rec public.towns;
  n text;
  r text;
begin
  n := private.clamp_name(p_name, 40);
  r := private.clamp_name(p_region_key, 40);
  if n is null or r is null then
    raise exception 'Town name and region are required';
  end if;
  insert into public.towns (name, region_key) values (n, lower(r))
  returning * into rec;
  return rec;
exception when unique_violation then
  raise exception 'A town named % already exists', n;
end;
$$;

create or replace function private.create_clan(
  p_player_id uuid,
  p_name text,
  p_code text,
  p_scope public.clan_scope,
  p_town_id uuid
) returns public.clans
language plpgsql
as $$
declare
  rec public.clans;
  n text;
  c text;
  pl public.players;
begin
  pl := private.ensure_player(p_player_id);
  n := private.clamp_name(p_name, 40);
  c := upper(trim(coalesce(p_code, '')));
  if n is null then
    raise exception 'Clan name required';
  end if;
  if c !~ '^[A-Z0-9]{3,8}$' then
    raise exception 'Clan code must be 3–8 letters or numbers';
  end if;
  if p_scope = 'local' and p_town_id is null then
    raise exception 'Local clans need a town';
  end if;
  insert into public.clans (name, code, scope, town_id, captain_player_id)
  values (n, c, coalesce(p_scope, 'local'), p_town_id, p_player_id)
  returning * into rec;
  if pl.clan_id is null then
    perform private.join_clan(p_player_id, rec.id);
  end if;
  return rec;
exception when unique_violation then
  raise exception 'That clan code is taken';
end;
$$;

create or replace function private.create_meet(
  p_player_id uuid,
  p_kind public.meet_kind,
  p_level public.meet_level,
  p_home_side_id uuid,
  p_away_side_id uuid,
  p_window_start timestamptz,
  p_window_end timestamptz
) returns public.meets
language plpgsql
as $$
declare
  pl public.players;
  rec public.meets;
  st public.meet_status;
begin
  pl := private.ensure_player(p_player_id);
  if p_home_side_id is null or p_away_side_id is null or p_home_side_id = p_away_side_id then
    raise exception 'Need two different sides';
  end if;
  if p_window_start is null or p_window_end is null or p_window_end <= p_window_start then
    raise exception 'Meet window is invalid';
  end if;
  if p_kind = 'clan_vs_clan' then
    if not exists (select 1 from public.clans where id = p_home_side_id)
      or not exists (select 1 from public.clans where id = p_away_side_id) then
      raise exception 'Both sides must be clans';
    end if;
    if not exists (
      select 1 from public.clans
      where id = p_home_side_id and captain_player_id = p_player_id
    ) and pl.clan_id is distinct from p_home_side_id then
      raise exception 'Only the home clan captain (or a home member) can post this meet';
    end if;
  else
    if not exists (select 1 from public.towns where id = p_home_side_id)
      or not exists (select 1 from public.towns where id = p_away_side_id) then
      raise exception 'Both sides must be towns';
    end if;
    if pl.town_id is distinct from p_home_side_id then
      raise exception 'Join the home town before posting a town meet';
    end if;
  end if;

  if now() > p_window_end then
    st := 'final';
  elsif now() >= p_window_start then
    st := 'live';
  else
    st := 'scheduled';
  end if;

  insert into public.meets (
    kind, level, home_side_id, away_side_id,
    window_start, window_end, park_seed, status
  ) values (
    p_kind, p_level, p_home_side_id, p_away_side_id,
    p_window_start, p_window_end, 'neutral-v1', st
  ) returning * into rec;
  return rec;
end;
$$;

create or replace function private.set_roster_self(
  p_player_id uuid,
  p_meet_id uuid,
  p_on boolean
) returns jsonb
language plpgsql
as $$
declare
  pl public.players;
  m public.meets;
  side public.meet_side;
begin
  pl := private.ensure_player(p_player_id);
  select * into m from public.meets where id = p_meet_id;
  if m.id is null then
    raise exception 'Unknown meet';
  end if;
  if m.status = 'final' then
    raise exception 'Meet is final';
  end if;
  side := private.player_side_for_meet(m, pl);
  if side is null then
    -- Allow listing onto a side that already has a roster only if already listed-or-member.
    -- Empty-roster sides: membership is required (player_side_for_meet covers that).
    -- Non-empty opposite-empty: membership still required.
    raise exception 'Join that clan or town before listing on this meet';
  end if;
  if p_on then
    insert into public.meet_roster (meet_id, side, player_id)
    values (m.id, side, pl.id)
    on conflict (meet_id, player_id) do nothing;
  else
    delete from public.meet_roster where meet_id = m.id and player_id = pl.id;
  end if;
  return private.meet_payload(m);
end;
$$;

create or replace function private.post_swing(
  p_player_id uuid,
  p_feet int,
  p_is_homer boolean,
  p_park_seed text
) returns jsonb
language plpgsql
as $$
declare
  pl public.players;
  clan_m public.meets;
  town_m public.meets;
  sw public.swings;
  seed text;
  out jsonb;
begin
  if p_feet is null or p_feet < 0 then
    raise exception 'feet must be >= 0';
  end if;
  pl := private.ensure_player(p_player_id);
  perform private.touch_meet_statuses();

  clan_m := private.find_live_meet(pl, 'clan_vs_clan');
  town_m := private.find_live_meet(pl, 'town_vs_town');

  seed := coalesce(nullif(trim(p_park_seed), ''), 'neutral-v1');
  if clan_m.id is not null then
    seed := clan_m.park_seed;
  elsif town_m.id is not null then
    seed := town_m.park_seed;
  end if;

  insert into public.swings (
    player_id, feet, is_homer, park_seed,
    meet_id, town_meet_id,
    clan_id, town_id,
    counts_for_clan_meet, counts_for_town_rollup
  ) values (
    pl.id,
    p_feet,
    coalesce(p_is_homer, false),
    seed,
    clan_m.id,
    town_m.id,
    pl.clan_id,
    pl.town_id,
    clan_m.id is not null,
    town_m.id is not null
  ) returning * into sw;

  out := jsonb_build_object(
    'swing', to_jsonb(sw),
    'player', jsonb_build_object(
      'id', pl.id,
      'display_name', pl.display_name,
      'town_id', pl.town_id,
      'clan_id', pl.clan_id,
      'clan_cooldown_until', pl.clan_cooldown_until
    ),
    'clan_meet', case when clan_m.id is null then null else private.meet_payload(clan_m) end,
    'town_meet', case when town_m.id is null then null else private.meet_payload(town_m) end
  );
  return out;
end;
$$;

create or replace function private.player_payload(p_player public.players)
returns jsonb
language plpgsql
stable
as $$
declare
  town_name text;
  clan_name text;
  clan_code text;
  region text;
begin
  if p_player.town_id is not null then
    select t.name, t.region_key into town_name, region
    from public.towns t where t.id = p_player.town_id;
  end if;
  if p_player.clan_id is not null then
    select c.name, c.code into clan_name, clan_code
    from public.clans c where c.id = p_player.clan_id;
  end if;
  return jsonb_build_object(
    'id', p_player.id,
    'display_name', p_player.display_name,
    'town_id', p_player.town_id,
    'town_name', town_name,
    'region_key', region,
    'clan_id', p_player.clan_id,
    'clan_name', clan_name,
    'clan_code', clan_code,
    'clan_joined_at', p_player.clan_joined_at,
    'clan_cooldown_until', p_player.clan_cooldown_until,
    'created_at', p_player.created_at
  );
end;
$$;

create or replace function private.scoreboard_payload(p_player_id uuid, p_region_key text)
returns jsonb
language plpgsql
as $$
declare
  pl public.players;
  region text;
  meets_json jsonb;
  pb int;
begin
  perform private.touch_meet_statuses();
  if p_player_id is not null then
    pl := private.ensure_player(p_player_id);
  end if;
  region := coalesce(
    nullif(trim(p_region_key), ''),
    (select t.region_key from public.towns t where t.id = pl.town_id),
    'ct-newhaven'
  );

  select coalesce(jsonb_agg(private.meet_payload(m) order by m.window_start), '[]'::jsonb)
  into meets_json
  from public.meets m
  where m.status in ('scheduled', 'live')
     or (m.status = 'final' and m.window_end >= private.ny_today_start());

  select max(s.feet) into pb from public.swings s where s.player_id = pl.id;

  return jsonb_build_object(
    'now', now(),
    'region_key', region,
    'player', case when pl.id is null then null else private.player_payload(pl) end,
    'meets', coalesce(meets_json, '[]'::jsonb),
    'towns', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'region_key', t.region_key) order by t.name) from public.towns t), '[]'::jsonb),
    'clans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'code', c.code, 'scope', c.scope,
        'town_id', c.town_id, 'town_name', t.name
      ) order by c.name)
      from public.clans c
      left join public.towns t on t.id = c.town_id
    ), '[]'::jsonb),
    'boards', jsonb_build_object(
      'tonight', private.board_rows_players_tonight(),
      'local_towns', private.town_totals(region),
      'local_clans', private.clan_totals(region),
      'national_towns', private.town_totals(null),
      'national_clans', private.clan_totals(null),
      'personal_best', private.personal_best_board()
    ),
    'personal_best_feet', pb
  );
end;
$$;

-- Public wrappers
create or replace function public.ensure_player(p_player_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select private.player_payload(private.ensure_player(p_player_id));
$$;

create or replace function public.set_display_name(p_player_id uuid, p_name text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select private.player_payload(private.set_display_name(p_player_id, p_name));
$$;

create or replace function public.set_town(p_player_id uuid, p_town_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select private.player_payload(private.set_town(p_player_id, p_town_id));
$$;

create or replace function public.join_clan(p_player_id uuid, p_clan_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select private.player_payload(private.join_clan(p_player_id, p_clan_id));
$$;

create or replace function public.leave_clan(p_player_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select private.player_payload(private.leave_clan(p_player_id));
$$;

create or replace function public.create_town(p_name text, p_region_key text)
returns public.towns
language sql
security definer
set search_path = public
as $$
  select * from private.create_town(p_name, p_region_key);
$$;

create or replace function public.create_clan(
  p_player_id uuid,
  p_name text,
  p_code text,
  p_scope public.clan_scope,
  p_town_id uuid
) returns public.clans
language sql
security definer
set search_path = public
as $$
  select * from private.create_clan(p_player_id, p_name, p_code, p_scope, p_town_id);
$$;

create or replace function public.create_meet(
  p_player_id uuid,
  p_kind public.meet_kind,
  p_level public.meet_level,
  p_home_side_id uuid,
  p_away_side_id uuid,
  p_window_start timestamptz,
  p_window_end timestamptz
) returns jsonb
language sql
security definer
set search_path = public
as $$
  select private.meet_payload(
    private.create_meet(
      p_player_id, p_kind, p_level, p_home_side_id, p_away_side_id,
      p_window_start, p_window_end
    )
  );
$$;

create or replace function public.set_roster_self(p_player_id uuid, p_meet_id uuid, p_on boolean)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select private.set_roster_self(p_player_id, p_meet_id, p_on);
$$;

create or replace function public.post_swing(
  p_player_id uuid,
  p_feet int,
  p_is_homer boolean,
  p_park_seed text
) returns jsonb
language sql
security definer
set search_path = public
as $$
  select private.post_swing(p_player_id, p_feet, p_is_homer, p_park_seed);
$$;

create or replace function public.scoreboard_payload(p_player_id uuid, p_region_key text default null)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select private.scoreboard_payload(p_player_id, p_region_key);
$$;

revoke all on function public.ensure_player(uuid) from public;
revoke all on function public.set_display_name(uuid, text) from public;
revoke all on function public.set_town(uuid, uuid) from public;
revoke all on function public.join_clan(uuid, uuid) from public;
revoke all on function public.leave_clan(uuid) from public;
revoke all on function public.create_town(text, text) from public;
revoke all on function public.create_clan(uuid, text, text, public.clan_scope, uuid) from public;
revoke all on function public.create_meet(uuid, public.meet_kind, public.meet_level, uuid, uuid, timestamptz, timestamptz) from public;
revoke all on function public.set_roster_self(uuid, uuid, boolean) from public;
revoke all on function public.post_swing(uuid, int, boolean, text) from public;
revoke all on function public.scoreboard_payload(uuid, text) from public;

grant execute on function public.ensure_player(uuid) to anon, authenticated;
grant execute on function public.set_display_name(uuid, text) to anon, authenticated;
grant execute on function public.set_town(uuid, uuid) to anon, authenticated;
grant execute on function public.join_clan(uuid, uuid) to anon, authenticated;
grant execute on function public.leave_clan(uuid) to anon, authenticated;
grant execute on function public.create_town(text, text) to anon, authenticated;
grant execute on function public.create_clan(uuid, text, text, public.clan_scope, uuid) to anon, authenticated;
grant execute on function public.create_meet(uuid, public.meet_kind, public.meet_level, uuid, uuid, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.set_roster_self(uuid, uuid, boolean) to anon, authenticated;
grant execute on function public.post_swing(uuid, int, boolean, text) to anon, authenticated;
grant execute on function public.scoreboard_payload(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Seed: Oxford vs Cheshire Friday-night card + a national clan meet.
-- Empty rosters so any matching member can fill scoring slots.
-- ---------------------------------------------------------------------------
insert into public.towns (id, name, region_key) values
  ('a1111111-1111-4111-8111-111111111111', 'Oxford', 'ct-newhaven'),
  ('a1111111-1111-4111-8111-111111111112', 'Cheshire', 'ct-newhaven'),
  ('a1111111-1111-4111-8111-111111111113', 'Los Angeles', 'ca-la');

insert into public.clans (id, name, code, scope, town_id, colors) values
  ('b1111111-1111-4111-8111-111111111111', 'OBR Navy', 'OBRNAV', 'local',
    'a1111111-1111-4111-8111-111111111111', '{"primary":"#1E4FA8"}'::jsonb),
  ('b1111111-1111-4111-8111-111111111112', 'Cheshire Red', 'CHSRED', 'local',
    'a1111111-1111-4111-8111-111111111112', '{"primary":"#B4261F"}'::jsonb),
  ('b1111111-1111-4111-8111-111111111113', 'LA Select', 'LASEL', 'national',
    'a1111111-1111-4111-8111-111111111113', '{"primary":"#E0A21A"}'::jsonb),
  ('b1111111-1111-4111-8111-111111111114', 'Omaha Select', 'OMSSEL', 'national',
    null, '{"primary":"#0E7A4A"}'::jsonb);

insert into public.meets (
  id, kind, level, home_side_id, away_side_id,
  window_start, window_end, park_seed, status
) values
  (
    'c1111111-1111-4111-8111-111111111111',
    'clan_vs_clan', 'local',
    'b1111111-1111-4111-8111-111111111111',
    'b1111111-1111-4111-8111-111111111112',
    now() - interval '30 minutes',
    now() + interval '4 hours',
    'neutral-v1', 'live'
  ),
  (
    'c1111111-1111-4111-8111-111111111112',
    'town_vs_town', 'local',
    'a1111111-1111-4111-8111-111111111111',
    'a1111111-1111-4111-8111-111111111112',
    now() - interval '30 minutes',
    now() + interval '4 hours',
    'neutral-v1', 'live'
  ),
  (
    'c1111111-1111-4111-8111-111111111113',
    'clan_vs_clan', 'national',
    'b1111111-1111-4111-8111-111111111113',
    'b1111111-1111-4111-8111-111111111114',
    now() - interval '30 minutes',
    now() + interval '4 hours',
    'neutral-v1', 'live'
  );

-- Pin search_path on private helpers (advisor: function_search_path_mutable).
do $$
declare r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
  loop
    execute format('alter function private.%I(%s) set search_path = public', r.proname, r.args);
  end loop;
end $$;
