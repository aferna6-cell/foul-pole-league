-- Slice 2: make "create a club" and "challenge someone" real actions.
--
-- The RPCs already existed but nothing could reach them from the board, and
-- three pieces were missing:
--   * clans.colors was declared and never written
--   * clan codes were mandatory, so there was no "just make me a club" path
--   * anyone anonymous could author a club or a meet
--
-- Invariants kept: sanctioned meets still get park_seed = 'neutral-v1' and
-- nothing here reads clans.colors during scoring, so a club's colors cannot
-- move a fence, an exit velo, or a pitch clock. Practice swings are untouched:
-- post_swing still never asks for a display name.

-- ---------------------------------------------------------------------------
-- Authorship gate. A club or a meet goes on a public board with a name on it,
-- so it needs one. The first swing deliberately does not.
-- ---------------------------------------------------------------------------
create or replace function private.require_named(p_player_id uuid)
returns public.players
language plpgsql
as $$
declare
  pl public.players;
begin
  pl := private.ensure_player(p_player_id);
  if private.clamp_name(pl.display_name, 24) is null then
    raise exception 'Set a display name before you put something on the board';
  end if;
  return pl;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invite codes. Supplying one is optional; leaving it blank mints one.
-- Ambiguous glyphs (0/O, 1/I) are excluded so a code survives being read aloud.
-- ---------------------------------------------------------------------------
create or replace function private.gen_clan_code()
returns text
language plpgsql
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  i int;
  attempt int := 0;
begin
  loop
    attempt := attempt + 1;
    candidate := '';
    for i in 1..5 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.clans where code = candidate);
    if attempt >= 40 then
      raise exception 'Could not mint a free club code, try again';
    end if;
  end loop;
  return candidate;
end;
$$;

-- ---------------------------------------------------------------------------
-- Colors are cosmetic only. Validated here so the column cannot collect junk,
-- and read nowhere in scoring.
-- ---------------------------------------------------------------------------
create or replace function private.clean_colors(p_colors jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  primary_c text;
  secondary_c text;
begin
  if p_colors is null or jsonb_typeof(p_colors) <> 'object' then
    return '{}'::jsonb;
  end if;
  primary_c := upper(trim(coalesce(p_colors ->> 'primary', '')));
  secondary_c := upper(trim(coalesce(p_colors ->> 'secondary', '')));
  if primary_c !~ '^#[0-9A-F]{6}$' then
    primary_c := null;
  end if;
  if secondary_c !~ '^#[0-9A-F]{6}$' then
    secondary_c := null;
  end if;
  return jsonb_strip_nulls(
    jsonb_build_object('primary', primary_c, 'secondary', secondary_c)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- create_town now records who made it, so the same "name yourself first" rule
-- applies to a town as to a club.
-- ---------------------------------------------------------------------------
create or replace function private.create_town(
  p_player_id uuid,
  p_name text,
  p_region_key text
) returns public.towns
language plpgsql
as $$
declare
  rec public.towns;
  n text;
  r text;
begin
  perform private.require_named(p_player_id);
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

-- ---------------------------------------------------------------------------
-- create_clan: optional code, colors, display name required.
-- Still auto-joins the creator when they have no clan, and still refuses to
-- move somebody who is inside a 48h cooldown (join_clan raises).
-- ---------------------------------------------------------------------------
create or replace function private.create_clan(
  p_player_id uuid,
  p_name text,
  p_code text,
  p_scope public.clan_scope,
  p_town_id uuid,
  p_colors jsonb
) returns public.clans
language plpgsql
as $$
declare
  rec public.clans;
  n text;
  c text;
  pl public.players;
begin
  pl := private.require_named(p_player_id);
  n := private.clamp_name(p_name, 40);
  if n is null then
    raise exception 'Clan name required';
  end if;

  c := upper(trim(coalesce(p_code, '')));
  if c = '' then
    c := private.gen_clan_code();
  elsif c !~ '^[A-Z0-9]{3,8}$' then
    raise exception 'Club code must be 3-8 letters or numbers';
  end if;

  if p_scope = 'local' and p_town_id is null then
    raise exception 'Local clans need a town';
  end if;
  if p_town_id is not null and not exists (select 1 from public.towns where id = p_town_id) then
    raise exception 'Unknown town';
  end if;

  -- Refuse before inserting, so a cooldown cannot strand a captainless club.
  if pl.clan_id is not null
     and pl.clan_cooldown_until is not null
     and now() < pl.clan_cooldown_until then
    raise exception 'Clan switch cooldown until %', pl.clan_cooldown_until;
  end if;

  insert into public.clans (name, code, scope, town_id, captain_player_id, colors)
  values (n, c, coalesce(p_scope, 'local'), p_town_id, p_player_id, private.clean_colors(p_colors))
  returning * into rec;

  -- Your club is the club you are in. join_clan is the single place that
  -- enforces one-clan-at-a-time and stamps the next 48h cooldown; the
  -- cooldown was already checked above, so this cannot raise here.
  perform private.join_clan(p_player_id, rec.id);
  return rec;
exception when unique_violation then
  raise exception 'That club code is taken';
end;
$$;

-- ---------------------------------------------------------------------------
-- Join by invite code — the thing you hand someone when you challenge them.
-- Enforces the same one-clan + 48h cooldown rule as join_clan, because it
-- delegates to it rather than reimplementing it.
-- ---------------------------------------------------------------------------
create or replace function private.join_clan_by_code(p_player_id uuid, p_code text)
returns public.players
language plpgsql
as $$
declare
  target uuid;
  c text;
begin
  perform private.ensure_player(p_player_id);
  c := upper(trim(coalesce(p_code, '')));
  if c = '' then
    raise exception 'Enter a club code';
  end if;
  select id into target from public.clans where code = c;
  if target is null then
    raise exception 'No club with code %', c;
  end if;
  return private.join_clan(p_player_id, target);
end;
$$;

-- ---------------------------------------------------------------------------
-- create_meet: same rules, plus the authorship gate, plus a guard against
-- posting a meet that is already over.
-- ---------------------------------------------------------------------------
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
  pl := private.require_named(p_player_id);
  if p_home_side_id is null or p_away_side_id is null or p_home_side_id = p_away_side_id then
    raise exception 'Need two different sides';
  end if;
  if p_window_start is null or p_window_end is null or p_window_end <= p_window_start then
    raise exception 'Meet window is invalid';
  end if;
  if p_window_end <= now() then
    raise exception 'That window has already closed';
  end if;

  if p_kind = 'clan_vs_clan' then
    if not exists (select 1 from public.clans where id = p_home_side_id)
      or not exists (select 1 from public.clans where id = p_away_side_id) then
      raise exception 'Both sides must be clubs';
    end if;
    if not exists (
      select 1 from public.clans
      where id = p_home_side_id and captain_player_id = p_player_id
    ) and pl.clan_id is distinct from p_home_side_id then
      raise exception 'Only the home club captain (or a home member) can post this meet';
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

  if now() >= p_window_start then
    st := 'live';
  else
    st := 'scheduled';
  end if;

  -- park_seed is assigned by the system, never by the caller. Sanctioned meets
  -- are played on the neutral park so nobody can farm a short porch.
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

-- ---------------------------------------------------------------------------
-- meet_payload gains the listed-roster counts so the board can show how much
-- room is left against the 15-per-side cap. Scoring is unchanged: the 9 slots
-- and totals come from the same side_score call as before.
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
  home_listed int;
  away_listed int;
  ticker text;
begin
  home_s := private.side_score(p_meet, 'home');
  away_s := private.side_score(p_meet, 'away');
  home_n := private.side_name(p_meet.kind, p_meet.home_side_id);
  away_n := private.side_name(p_meet.kind, p_meet.away_side_id);
  select count(*) into home_listed from public.meet_roster where meet_id = p_meet.id and side = 'home';
  select count(*) into away_listed from public.meet_roster where meet_id = p_meet.id and side = 'away';
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
    'roster_cap', 15,
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

-- ---------------------------------------------------------------------------
-- scoreboard_payload gains what the create/challenge forms need: club colors,
-- who captains what, member counts, and which meets this player is listed on.
-- ---------------------------------------------------------------------------
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
-- Public wrappers. The old create_town/create_clan signatures are replaced
-- outright rather than left beside the new ones, so there is no second door
-- into clan creation that skips the display-name gate.
-- ---------------------------------------------------------------------------
drop function if exists public.create_town(text, text);
drop function if exists public.create_clan(uuid, text, text, public.clan_scope, uuid);

create or replace function public.create_town(
  p_player_id uuid,
  p_name text,
  p_region_key text
) returns public.towns
language sql
security definer
set search_path = public
as $$
  select * from private.create_town(p_player_id, p_name, p_region_key);
$$;

create or replace function public.create_clan(
  p_player_id uuid,
  p_name text,
  p_code text default null,
  p_scope public.clan_scope default 'local',
  p_town_id uuid default null,
  p_colors jsonb default '{}'::jsonb
) returns public.clans
language sql
security definer
set search_path = public
as $$
  select * from private.create_clan(p_player_id, p_name, p_code, p_scope, p_town_id, p_colors);
$$;

create or replace function public.join_clan_by_code(p_player_id uuid, p_code text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select private.player_payload(private.join_clan_by_code(p_player_id, p_code));
$$;

alter function private.require_named(uuid) set search_path = public;
alter function private.gen_clan_code() set search_path = public;
alter function private.clean_colors(jsonb) set search_path = public;
alter function private.create_town(uuid, text, text) set search_path = public;
alter function private.create_clan(uuid, text, text, public.clan_scope, uuid, jsonb) set search_path = public;
alter function private.join_clan_by_code(uuid, text) set search_path = public;
alter function private.create_meet(uuid, public.meet_kind, public.meet_level, uuid, uuid, timestamptz, timestamptz) set search_path = public;
alter function private.meet_payload(public.meets) set search_path = public;
alter function private.scoreboard_payload(uuid, text) set search_path = public;

revoke all on function public.create_town(uuid, text, text) from public;
revoke all on function public.create_clan(uuid, text, text, public.clan_scope, uuid, jsonb) from public;
revoke all on function public.join_clan_by_code(uuid, text) from public;

grant execute on function public.create_town(uuid, text, text) to anon, authenticated;
grant execute on function public.create_clan(uuid, text, text, public.clan_scope, uuid, jsonb) to anon, authenticated;
grant execute on function public.join_clan_by_code(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Roster listing could never pass one player per side.
--
-- private.player_eligible_for_side answers "do this player's swings count for
-- this side", and its roster_nonempty branch is right for that: once a card is
-- named, only named players score. set_roster_self was using the same function
-- to answer a different question — "may this player add themselves" — so the
-- first person to list made the roster non-empty, and every team-mate after
-- them was told to "join that clan or town" even though they already had.
-- Side effect on the board: that side's card was stuck at 1/9, because scoring
-- was then restricted to the single listed player.
--
-- Membership is its own question, so it gets its own function.
-- player_eligible_for_side is left exactly as it is; scoring is unchanged.
-- ---------------------------------------------------------------------------
create or replace function private.player_membership_side(
  p_meet public.meets,
  p_player public.players
) returns public.meet_side
language plpgsql
stable
as $$
begin
  if p_meet.kind = 'clan_vs_clan' then
    if p_player.clan_id is null then
      return null;
    end if;
    if p_player.clan_id = p_meet.home_side_id then return 'home'; end if;
    if p_player.clan_id = p_meet.away_side_id then return 'away'; end if;
    return null;
  end if;
  if p_player.town_id is null then
    return null;
  end if;
  if p_player.town_id = p_meet.home_side_id then return 'home'; end if;
  if p_player.town_id = p_meet.away_side_id then return 'away'; end if;
  return null;
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

  if not p_on then
    -- Taking your own name off always works, including after you leave the club.
    delete from public.meet_roster where meet_id = m.id and player_id = pl.id;
    return private.meet_payload(m);
  end if;

  side := private.player_membership_side(m, pl);
  if side is null then
    raise exception 'Join one of these two sides before listing on this meet';
  end if;
  insert into public.meet_roster (meet_id, side, player_id)
  values (m.id, side, pl.id)
  on conflict (meet_id, player_id) do nothing;
  return private.meet_payload(m);
end;
$$;

alter function private.player_membership_side(public.meets, public.players) set search_path = public;
alter function private.set_roster_self(uuid, uuid, boolean) set search_path = public;
