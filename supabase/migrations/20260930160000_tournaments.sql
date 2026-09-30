-- §11 local and national 8-clan brackets.
--
-- NOT applied by the app deploy. Run this file in the Supabase SQL editor
-- (project cchcuhksccbeccendewt) after the earlier migrations. Town-vs-town
-- brackets stay parked. Rounds are ordinary clan meets: same side_score
-- top-9, same roster rule, park_seed neutral-v1. This file does not touch
-- physics, k, or the swing path.
--
-- Additive: tournaments, tournament_entries, tournament_player_locks
-- (anti-farm snapshot), and meets.tournament_id / round / bracket_slot.
-- player_locks_at is the "QF window has frozen clan membership" marker.
-- A freeze with zero players still counts, so late joiners cannot sneak in.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  level public.meet_level not null,
  kind public.meet_kind not null default 'clan_vs_clan',
  size integer not null default 8,
  status public.meet_status not null default 'scheduled',
  round_hours integer not null default 24,
  creator_player_id uuid not null references public.players (id),
  champion_clan_id uuid references public.clans (id),
  player_locks_at timestamptz,
  created_at timestamptz not null default now(),
  constraint tournaments_name_len check (char_length(trim(name)) between 1 and 40),
  constraint tournaments_size_8 check (size = 8),
  constraint tournaments_kind_clan check (kind = 'clan_vs_clan'),
  constraint tournaments_round_hours check (round_hours between 1 and 168),
  constraint tournaments_final_has_champion check (
    status <> 'final' or champion_clan_id is not null
  )
);

create index tournaments_status_idx on public.tournaments (status);
create index tournaments_level_idx on public.tournaments (level);

create table public.tournament_entries (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  clan_id uuid not null references public.clans (id),
  seed smallint not null,
  primary key (tournament_id, clan_id),
  constraint tournament_entries_seed_uq unique (tournament_id, seed),
  constraint tournament_entries_seed_rng check (seed between 1 and 8)
);

create index tournament_entries_clan_idx on public.tournament_entries (clan_id);

-- Clan a player may score for in this bracket: their clan at QF window open.
-- No select grant — scoring reads it inside security definer functions.
create table public.tournament_player_locks (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  player_id uuid not null references public.players (id),
  clan_id uuid not null references public.clans (id),
  primary key (tournament_id, player_id)
);

alter table public.meets
  add column tournament_id uuid references public.tournaments (id),
  add column round smallint,
  add column bracket_slot smallint;

alter table public.meets
  add constraint meets_bracket_chk check (
    (
      tournament_id is null
      and round is null
      and bracket_slot is null
    )
    or (
      tournament_id is not null
      and kind = 'clan_vs_clan'
      and round between 1 and 3
      and (
        (round = 1 and bracket_slot between 1 and 4)
        or (round = 2 and bracket_slot between 1 and 2)
        or (round = 3 and bracket_slot = 1)
      )
    )
  );

create unique index meets_bracket_slot_uq
  on public.meets (tournament_id, round, bracket_slot)
  where tournament_id is not null;

alter table public.tournaments enable row level security;
alter table public.tournament_entries enable row level security;
alter table public.tournament_player_locks enable row level security;

create policy tournaments_select on public.tournaments
  for select to anon, authenticated using (true);
create policy tournament_entries_select on public.tournament_entries
  for select to anon, authenticated using (true);

grant select on public.tournaments, public.tournament_entries to anon, authenticated;

-- One scheduled or live bracket per clan. Final brackets do not block.
create or replace function private.guard_one_live_tournament()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from public.tournament_entries e
    join public.tournaments t on t.id = e.tournament_id
    where e.clan_id = new.clan_id
      and e.tournament_id <> new.tournament_id
      and t.status in ('scheduled', 'live')
  ) then
    raise exception 'That club is already in a live bracket';
  end if;
  return new;
end;
$$;

create trigger tournament_entries_one_live
before insert or update of clan_id, tournament_id on public.tournament_entries
for each row execute function private.guard_one_live_tournament();

-- ---------------------------------------------------------------------------
-- Bracket helpers. Scoring stays private.side_score — no second formula.
-- ---------------------------------------------------------------------------
create or replace function private.round_label(p_round integer)
returns text
language sql
immutable
as $$
  select case p_round
    when 1 then 'QF'
    when 2 then 'SF'
    when 3 then 'F'
    else null
  end;
$$;

-- Feet for one clan off the same JSON the clan board already returns.
create or replace function private.board_feet_for(p_board jsonb, p_clan_id uuid)
returns integer
language sql
immutable
as $$
  select coalesce(
    (
      select (elem->>'feet')::int
      from jsonb_array_elements(coalesce(p_board, '[]'::jsonb)) elem
      where elem->>'id' = p_clan_id::text
      limit 1
    ),
    0
  );
$$;

-- Same top-9 as a normal meet. On a bracket meet the swing's club snapshot
-- has to be that side, so listing yourself on the other club cannot move feet.
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
      (
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
    )
    and (
      p_meet.tournament_id is null
      or p_meet.kind <> 'clan_vs_clan'
      or cs.clan_id = sid
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

-- Higher top-9 total, then higher best scoring swing, then higher seed
-- (lower seed number). Zero scoring swings loses; both empty → higher seed.
create or replace function private.meet_winner_clan(p_meet public.meets)
returns uuid
language plpgsql
stable
as $$
declare
  home_s private.side_score_t;
  away_s private.side_score_t;
  home_best integer;
  away_best integer;
  home_seed integer;
  away_seed integer;
begin
  if p_meet.tournament_id is null then
    raise exception 'Not a bracket meet';
  end if;

  home_s := private.side_score(p_meet, 'home');
  away_s := private.side_score(p_meet, 'away');

  select coalesce(max((e->>'feet')::int), 0) into home_best
  from jsonb_array_elements(coalesce(home_s.slots_json, '[]'::jsonb)) e;
  select coalesce(max((e->>'feet')::int), 0) into away_best
  from jsonb_array_elements(coalesce(away_s.slots_json, '[]'::jsonb)) e;

  select seed into home_seed
  from public.tournament_entries
  where tournament_id = p_meet.tournament_id and clan_id = p_meet.home_side_id;
  select seed into away_seed
  from public.tournament_entries
  where tournament_id = p_meet.tournament_id and clan_id = p_meet.away_side_id;

  if home_seed is null or away_seed is null then
    raise exception 'Bracket is missing a seed';
  end if;

  if coalesce(home_s.slots, 0) = 0 and coalesce(away_s.slots, 0) = 0 then
    if home_seed <= away_seed then
      return p_meet.home_side_id;
    end if;
    return p_meet.away_side_id;
  end if;
  if coalesce(home_s.slots, 0) = 0 then
    return p_meet.away_side_id;
  end if;
  if coalesce(away_s.slots, 0) = 0 then
    return p_meet.home_side_id;
  end if;

  if home_s.total_feet <> away_s.total_feet then
    if home_s.total_feet > away_s.total_feet then
      return p_meet.home_side_id;
    end if;
    return p_meet.away_side_id;
  end if;

  if home_best <> away_best then
    if home_best > away_best then
      return p_meet.home_side_id;
    end if;
    return p_meet.away_side_id;
  end if;

  if home_seed <= away_seed then
    return p_meet.home_side_id;
  end if;
  return p_meet.away_side_id;
end;
$$;

-- Higher seed (lower number) is home. Park is always the neutral seed.
create or replace function private.spawn_bracket_meet(
  p_tournament_id uuid,
  p_round integer,
  p_slot integer,
  p_clan_a uuid,
  p_clan_b uuid,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_status public.meet_status
) returns uuid
language plpgsql
as $$
declare
  seed_a integer;
  seed_b integer;
  home_id uuid;
  away_id uuid;
  lvl public.meet_level;
  rec public.meets;
begin
  if p_clan_a is null or p_clan_b is null or p_clan_a = p_clan_b then
    raise exception 'Bracket meet needs two clubs';
  end if;
  if exists (
    select 1 from public.meets
    where tournament_id = p_tournament_id
      and round = p_round
      and bracket_slot = p_slot
  ) then
    return null;
  end if;

  select seed into seed_a
  from public.tournament_entries
  where tournament_id = p_tournament_id and clan_id = p_clan_a;
  select seed into seed_b
  from public.tournament_entries
  where tournament_id = p_tournament_id and clan_id = p_clan_b;
  if seed_a is null or seed_b is null then
    raise exception 'Bracket is missing a seed';
  end if;

  if seed_a <= seed_b then
    home_id := p_clan_a;
    away_id := p_clan_b;
  else
    home_id := p_clan_b;
    away_id := p_clan_a;
  end if;

  select level into lvl from public.tournaments where id = p_tournament_id;

  insert into public.meets (
    kind, level, home_side_id, away_side_id,
    window_start, window_end, park_seed, status,
    tournament_id, round, bracket_slot
  ) values (
    'clan_vs_clan', lvl, home_id, away_id,
    p_window_start, p_window_end, 'neutral-v1', p_status,
    p_tournament_id, p_round, p_slot
  ) returning * into rec;
  return rec.id;
end;
$$;

create or replace function private.freeze_tournament_locks(p_id uuid)
returns void
language plpgsql
as $$
declare
  t public.tournaments;
begin
  select * into t from public.tournaments where id = p_id for update;
  if t.id is null or t.player_locks_at is not null then
    return;
  end if;

  insert into public.tournament_player_locks (tournament_id, player_id, clan_id)
  select t.id, p.id, p.clan_id
  from public.players p
  join public.tournament_entries e
    on e.tournament_id = t.id
   and e.clan_id = p.clan_id
  where p.clan_id is not null
  on conflict (tournament_id, player_id) do nothing;

  update public.tournaments
  set player_locks_at = now()
  where id = t.id
    and player_locks_at is null;
end;
$$;

create or replace function private.advance_tournament(p_id uuid)
returns void
language plpgsql
as $$
declare
  t public.tournaments;
  cur_round integer;
  unfinished integer;
  next_round integer;
  w_start timestamptz;
  w_end timestamptz;
  st public.meet_status;
  champ uuid;
  m public.meets;
  winner uuid;
  a_id uuid;
  b_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('fpl-tourn:' || p_id::text, 0));

  select * into t from public.tournaments where id = p_id;
  if t.id is null or t.status = 'final' then
    return;
  end if;

  select max(round) into cur_round
  from public.meets
  where tournament_id = t.id;
  if cur_round is null then
    return;
  end if;

  select count(*) into unfinished
  from public.meets
  where tournament_id = t.id
    and round = cur_round
    and status <> 'final';
  if unfinished > 0 then
    return;
  end if;

  if cur_round >= 3 then
    select * into m
    from public.meets
    where tournament_id = t.id and round = 3
    order by bracket_slot
    limit 1;
    champ := private.meet_winner_clan(m);
    if champ is null then
      raise exception 'Final has no winner';
    end if;
    update public.tournaments
    set status = 'final', champion_clan_id = champ
    where id = t.id;
    return;
  end if;

  next_round := cur_round + 1;
  if exists (
    select 1 from public.meets
    where tournament_id = t.id and round = next_round
  ) then
    return;
  end if;

  select max(window_end) into w_start
  from public.meets
  where tournament_id = t.id and round = cur_round;
  w_end := w_start + make_interval(hours => t.round_hours);

  if now() >= w_start then
    st := 'live';
  else
    st := 'scheduled';
  end if;

  if next_round = 2 then
    -- SF: winners of QF slots 1 and 2, then 3 and 4.
    select * into m from public.meets
    where tournament_id = t.id and round = 1 and bracket_slot = 1;
    a_id := private.meet_winner_clan(m);
    select * into m from public.meets
    where tournament_id = t.id and round = 1 and bracket_slot = 2;
    b_id := private.meet_winner_clan(m);
    perform private.spawn_bracket_meet(t.id, 2, 1, a_id, b_id, w_start, w_end, st);

    select * into m from public.meets
    where tournament_id = t.id and round = 1 and bracket_slot = 3;
    a_id := private.meet_winner_clan(m);
    select * into m from public.meets
    where tournament_id = t.id and round = 1 and bracket_slot = 4;
    b_id := private.meet_winner_clan(m);
    perform private.spawn_bracket_meet(t.id, 2, 2, a_id, b_id, w_start, w_end, st);
  else
    select * into m from public.meets
    where tournament_id = t.id and round = 2 and bracket_slot = 1;
    a_id := private.meet_winner_clan(m);
    select * into m from public.meets
    where tournament_id = t.id and round = 2 and bracket_slot = 2;
    b_id := private.meet_winner_clan(m);
    perform private.spawn_bracket_meet(t.id, 3, 1, a_id, b_id, w_start, w_end, st);
  end if;

  update public.tournaments
  set status = 'live'
  where id = t.id and status = 'scheduled';

  -- Catch-up: the next window already ended (nobody opened the board in time).
  -- Both sides are empty unless swings landed in that window, so the higher
  -- seed advances. Then keep going until the bracket is current.
  if now() >= w_end then
    for m in
      select * from public.meets
      where tournament_id = t.id and round = next_round
    loop
      winner := private.meet_winner_clan(m);
      update public.meets
      set
        status = 'final',
        home_wins = case when winner = home_side_id then 1 else 0 end,
        away_wins = case when winner = away_side_id then 1 else 0 end
      where id = m.id;
    end loop;
    perform private.advance_tournament(t.id);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ticker gains a QF / SF / F prefix. Totals still come from side_score.
-- ---------------------------------------------------------------------------
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
  home_listed integer;
  away_listed integer;
  v_label text;
  ticker text;
begin
  home_s := private.side_score(p_meet, 'home');
  away_s := private.side_score(p_meet, 'away');
  home_n := private.side_name(p_meet.kind, p_meet.home_side_id);
  away_n := private.side_name(p_meet.kind, p_meet.away_side_id);
  select count(*) into home_listed from public.meet_roster where meet_id = p_meet.id and side = 'home';
  select count(*) into away_listed from public.meet_roster where meet_id = p_meet.id and side = 'away';
  v_label := private.round_label(p_meet.round);
  ticker := format(
    '%s%s %s ft (%s/9) vs %s %s ft (%s/9)',
    case when v_label is null then '' else v_label || ' ' end,
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
    'roster_cap', 15,
    'tournament_id', p_meet.tournament_id,
    'round', p_meet.round,
    'bracket_slot', p_meet.bracket_slot,
    'round_label', v_label,
    'home', jsonb_build_object(
      'id', p_meet.home_side_id,
      'name', home_n,
      'total_feet', home_s.total_feet,
      'slots', home_s.slots,
      'listed', home_listed,
      'slot_rows', home_s.slots_json
    ),
    'away', jsonb_build_object(
      'id', p_meet.away_side_id,
      'name', away_n,
      'total_feet', away_s.total_feet,
      'slots', away_s.slots,
      'listed', away_listed,
      'slot_rows', away_s.slots_json
    ),
    'ticker', ticker
  );
end;
$$;

-- Titles are championships (champion_clan_id). They do not change the feet sort.
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
        'feet', feet,
        'titles', (
          select count(*)::int
          from public.tournaments champ
          where champ.champion_clan_id = summed.clan_id
            and champ.status = 'final'
        )
      ) order by feet desc, clan_name
    ),
    '[]'::jsonb
  )
  from summed;
$$;

create or replace function private.tournament_payload(p_t public.tournaments)
returns jsonb
language plpgsql
stable
as $$
declare
  meets_json jsonb;
  entries_json jsonb;
  champ_name text;
begin
  select c.name into champ_name
  from public.clans c
  where c.id = p_t.champion_clan_id;

  select coalesce(
    jsonb_agg(private.meet_payload(m) order by m.round, m.bracket_slot),
    '[]'::jsonb
  )
  into meets_json
  from public.meets m
  where m.tournament_id = p_t.id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'clan_id', e.clan_id,
      'name', c.name,
      'seed', e.seed
    ) order by e.seed
  ), '[]'::jsonb)
  into entries_json
  from public.tournament_entries e
  join public.clans c on c.id = e.clan_id
  where e.tournament_id = p_t.id;

  return jsonb_build_object(
    'id', p_t.id,
    'name', p_t.name,
    'level', p_t.level,
    'kind', p_t.kind,
    'size', p_t.size,
    'status', p_t.status,
    'round_hours', p_t.round_hours,
    'creator_player_id', p_t.creator_player_id,
    'champion_clan_id', p_t.champion_clan_id,
    'champion_name', champ_name,
    'created_at', p_t.created_at,
    'entries', entries_json,
    'meets', meets_json
  );
end;
$$;

-- Same finalization as before for ordinary meets. Bracket meets record the
-- tie-break winner so the series line matches who actually advances.
create or replace function private.touch_meet_statuses()
returns void
language plpgsql
as $$
declare
  m public.meets;
  home_total integer;
  away_total integer;
  winner uuid;
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
    if m.tournament_id is not null then
      winner := private.meet_winner_clan(m);
      update public.meets
      set
        status = 'final',
        home_wins = home_wins + case when winner = home_side_id then 1 else 0 end,
        away_wins = away_wins + case when winner = away_side_id then 1 else 0 end
      where id = m.id;
    else
      home_total := (private.side_score(m, 'home')).total_feet;
      away_total := (private.side_score(m, 'away')).total_feet;
      update public.meets
      set
        status = 'final',
        home_wins = home_wins + case when home_total > away_total then 1 else 0 end,
        away_wins = away_wins + case when away_total > home_total then 1 else 0 end
      where id = m.id;
    end if;
  end loop;

  perform private.freeze_tournament_locks(t.id)
  from public.tournaments t
  where t.player_locks_at is null
    and exists (
      select 1 from public.meets qm
      where qm.tournament_id = t.id
        and qm.round = 1
        and now() >= qm.window_start
    );

  update public.tournaments t
  set status = 'live'
  where t.status = 'scheduled'
    and exists (
      select 1 from public.meets qm
      where qm.tournament_id = t.id
        and now() >= qm.window_start
    );

  perform private.advance_tournament(t.id)
  from public.tournaments t
  where t.status in ('scheduled', 'live');
end;
$$;

-- Recreate after meets gained columns. The slice-1 copy returns the old row
-- type, which drops tournament_id and would skip the lock check below.
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

-- Park guard unchanged. Bracket meets also require the QF-open clan lock,
-- so one player cannot score for two clubs in the same bracket.
create or replace function private.post_swing(
  p_player_id uuid,
  p_feet integer,
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

  -- Do not rewrite a zip (or other) park onto the meet. Physics already ran.
  if clan_m.id is not null and seed is distinct from clan_m.park_seed then
    clan_m := null;
  end if;
  if town_m.id is not null and seed is distinct from town_m.park_seed then
    town_m := null;
  end if;

  if clan_m.id is not null and clan_m.tournament_id is not null then
    if not exists (
      select 1
      from public.tournament_player_locks l
      where l.tournament_id = clan_m.tournament_id
        and l.player_id = pl.id
        and l.clan_id is not distinct from pl.clan_id
    ) then
      clan_m := null;
    end if;
  end if;

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

create or replace function private.scoreboard_payload(p_player_id uuid, p_region_key text)
returns jsonb
language plpgsql
as $$
declare
  pl public.players;
  region text;
  meets_json jsonb;
  pb integer;
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
    'tournaments', coalesce((
      select jsonb_agg(private.tournament_payload(t) order by t.created_at desc)
      from public.tournaments t
      where t.status in ('scheduled', 'live')
         or (
           t.status = 'final'
           and exists (
             select 1 from public.meets fm
             where fm.tournament_id = t.id
               and fm.window_end >= private.ny_today_start()
           )
         )
    ), '[]'::jsonb),
    'my_meet_ids', coalesce((
      select jsonb_agg(r.meet_id) from public.meet_roster r where r.player_id = pl.id
    ), '[]'::jsonb),
    'towns', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'region_key', t.region_key
      ) order by t.name) from public.towns t
    ), '[]'::jsonb),
    'clans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'code', c.code, 'scope', c.scope,
        'town_id', c.town_id, 'town_name', t.name,
        'colors', c.colors,
        'captain_player_id', c.captain_player_id,
        'members', (select count(*) from public.players m where m.clan_id = c.id)
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

-- ---------------------------------------------------------------------------
-- Create. Seeds come from that level's clan board (feet), then older club.
-- QF is 1v8, 4v5, 2v7, 3v6. No fee, no prize column.
-- ---------------------------------------------------------------------------
create or replace function private.create_tournament(
  p_player_id uuid,
  p_name text,
  p_level public.meet_level,
  p_clan_ids uuid[],
  p_window_start timestamptz,
  p_round_hours integer
) returns public.tournaments
language plpgsql
as $$
declare
  pl public.players;
  rec public.tournaments;
  v_name text;
  v_hours integer;
  v_start timestamptz;
  v_end timestamptz;
  v_status public.meet_status;
  v_region text;
  board jsonb;
  clan_row record;
  s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid; s6 uuid; s7 uuid; s8 uuid;
begin
  pl := private.require_named(p_player_id);
  v_name := private.clamp_name(p_name, 40);
  if v_name is null then
    raise exception 'Bracket name required';
  end if;
  if p_level is null then
    raise exception 'Level required';
  end if;
  if p_clan_ids is null
     or cardinality(p_clan_ids) <> 8
     or (select count(distinct x) from unnest(p_clan_ids) as x) <> 8 then
    raise exception 'Need exactly 8 different clubs';
  end if;
  if (select count(*) from public.clans where id = any (p_clan_ids)) <> 8 then
    raise exception 'Unknown club';
  end if;
  if not exists (
    select 1 from public.clans
    where id = any (p_clan_ids)
      and captain_player_id = p_player_id
  ) then
    raise exception 'You have to captain one of the eight clubs';
  end if;

  if p_level = 'local' then
    if exists (
      select 1 from public.clans
      where id = any (p_clan_ids) and town_id is null
    ) or (
      select count(distinct town_id)
      from public.clans
      where id = any (p_clan_ids)
    ) <> 1 then
      raise exception 'A local bracket is eight clubs from the same town';
    end if;
    select towns.region_key into v_region
    from public.towns towns
    join public.clans clubs on clubs.town_id = towns.id
    where clubs.id = any (p_clan_ids)
    limit 1;
  else
    v_region := null;
  end if;

  v_hours := coalesce(p_round_hours, 24);
  if v_hours < 1 or v_hours > 168 then
    raise exception 'Round length must be between 1 and 168 hours';
  end if;
  v_start := coalesce(p_window_start, now());
  v_end := v_start + make_interval(hours => v_hours);
  if v_end <= now() then
    raise exception 'That window has already closed';
  end if;
  if now() >= v_start then
    v_status := 'live';
  else
    v_status := 'scheduled';
  end if;

  -- Stable lock order so two captains cannot both sneak a club in.
  for clan_row in
    select id
    from public.clans
    where id = any (p_clan_ids)
    order by id::text
  loop
    perform pg_advisory_xact_lock(hashtextextended('fpl-tourn-clan:' || clan_row.id::text, 0));
  end loop;

  if exists (
    select 1
    from public.tournament_entries e
    join public.tournaments t on t.id = e.tournament_id
    where e.clan_id = any (p_clan_ids)
      and t.status in ('scheduled', 'live')
  ) then
    raise exception 'That club is already in a live bracket';
  end if;

  insert into public.tournaments (
    name, level, kind, size, status, round_hours, creator_player_id
  ) values (
    v_name, p_level, 'clan_vs_clan', 8, v_status, v_hours, pl.id
  ) returning * into rec;

  -- Same feet as the clan board for this level. Ties: older club, then id.
  board := private.clan_totals(v_region);
  insert into public.tournament_entries (tournament_id, clan_id, seed)
  select rec.id, clubs.id, row_number() over (
    order by private.board_feet_for(board, clubs.id) desc, clubs.created_at asc, clubs.id asc
  )::smallint
  from public.clans clubs
  where clubs.id = any (p_clan_ids);

  select clan_id into s1 from public.tournament_entries where tournament_id = rec.id and seed = 1;
  select clan_id into s2 from public.tournament_entries where tournament_id = rec.id and seed = 2;
  select clan_id into s3 from public.tournament_entries where tournament_id = rec.id and seed = 3;
  select clan_id into s4 from public.tournament_entries where tournament_id = rec.id and seed = 4;
  select clan_id into s5 from public.tournament_entries where tournament_id = rec.id and seed = 5;
  select clan_id into s6 from public.tournament_entries where tournament_id = rec.id and seed = 6;
  select clan_id into s7 from public.tournament_entries where tournament_id = rec.id and seed = 7;
  select clan_id into s8 from public.tournament_entries where tournament_id = rec.id and seed = 8;

  -- QF slots: 1v8, 4v5, 2v7, 3v6.
  perform private.spawn_bracket_meet(rec.id, 1, 1, s1, s8, v_start, v_end, v_status);
  perform private.spawn_bracket_meet(rec.id, 1, 2, s4, s5, v_start, v_end, v_status);
  perform private.spawn_bracket_meet(rec.id, 1, 3, s2, s7, v_start, v_end, v_status);
  perform private.spawn_bracket_meet(rec.id, 1, 4, s3, s6, v_start, v_end, v_status);

  if v_start <= now() then
    perform private.freeze_tournament_locks(rec.id);
  end if;

  return rec;
end;
$$;

create or replace function public.create_tournament(
  p_player_id uuid,
  p_name text,
  p_level public.meet_level,
  p_clan_ids uuid[],
  p_window_start timestamptz default now(),
  p_round_hours integer default 24
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.tournaments;
begin
  -- Separate statement from the inserts. A stable payload in the same
  -- statement as the write would not see the new rows.
  rec := private.create_tournament(
    p_player_id, p_name, p_level, p_clan_ids, p_window_start, p_round_hours
  );
  return private.tournament_payload(rec);
end;
$$;

revoke all on function public.create_tournament(uuid, text, public.meet_level, uuid[], timestamptz, integer) from public;
grant execute on function public.create_tournament(uuid, text, public.meet_level, uuid[], timestamptz, integer) to anon, authenticated;

do $$
declare r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname = any (array[
        'guard_one_live_tournament',
        'round_label',
        'board_feet_for',
        'side_score',
        'meet_winner_clan',
        'spawn_bracket_meet',
        'freeze_tournament_locks',
        'advance_tournament',
        'meet_payload',
        'clan_totals',
        'tournament_payload',
        'touch_meet_statuses',
        'find_live_meet',
        'post_swing',
        'scoreboard_payload',
        'create_tournament'
      ])
  loop
    execute format(
      'alter function private.%I(%s) set search_path = public',
      r.proname, r.args
    );
  end loop;
end $$;
