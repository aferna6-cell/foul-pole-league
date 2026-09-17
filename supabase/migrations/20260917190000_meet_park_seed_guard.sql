-- Meet credit only when the client actually swung on meet.park_seed.
-- /play forces the iframe onto that seed; this stops zip-porch feet from
-- being relabeled as the meet park after the fact.

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

  -- Do not rewrite a zip (or other) park onto the meet. Physics already ran.
  if clan_m.id is not null and seed is distinct from clan_m.park_seed then
    clan_m := null;
  end if;
  if town_m.id is not null and seed is distinct from town_m.park_seed then
    town_m := null;
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

alter function private.post_swing(uuid, int, boolean, text) set search_path = public;
