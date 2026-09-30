#!/usr/bin/env node
/**
 * §11 bracket checks against the migration SQL (PGlite) plus the share-card
 * round label. Does not touch the production Supabase project.
 *
 * QA: wrong clan never advances (total, best swing, seed, empty side);
 * a round's score matches a normal meet for the same swings; a clan cannot
 * sit in two live brackets; a player cannot score for two clans in one
 * bracket; the next round is created with the 1-2 / 3-4 pairing.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function top9(swings) {
  const best = new Map();
  for (const s of swings) {
    const prev = best.get(s.player);
    if (
      !prev ||
      s.feet > prev.feet ||
      (s.feet === prev.feet && s.at < prev.at)
    ) {
      best.set(s.player, s);
    }
  }
  return [...best.values()]
    .sort((a, b) => b.feet - a.feet || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    .slice(0, 9);
}

function top9Total(swings) {
  return top9(swings).reduce((sum, s) => sum + s.feet, 0);
}

// --- static locks: physics, money, round label on the existing card path ---
const html = read("public/foul-pole-league.html");
const migration = read("supabase/migrations/20260930160000_tournaments.sql");
const shareSrc = read("lib/shareCard.ts");
const drawSrc = read("lib/drawShareCard.ts");
const pageSrc = read("app/page.tsx");
const playSrc = read("app/play/page.tsx");

assert(html.includes("const dt=1/200,k=0.00116,g=32.174"), "k stays 0.00116");
assert(!html.includes("k=0.00098"), "old k must not return");
assert(html.includes("function lockMeetPark"), "neutral park lock still in the game");
assert(!migration.includes("stripe"), "migration has no Stripe");
assert(!migration.includes("price_cents"), "migration has no price");
assert(migration.includes("'neutral-v1'"), "bracket meets use neutral-v1");
assert(migration.includes("private.side_score"), "winner reads side_score, not a new formula");
assert(migration.includes("1, 1, s1, s8"), "QF slot 1 is 1v8");
assert(migration.includes("1, 2, s4, s5"), "QF slot 2 is 4v5");
assert(migration.includes("1, 3, s2, s7"), "QF slot 3 is 2v7");
assert(migration.includes("1, 4, s3, s6"), "QF slot 4 is 3v6");
assert(migration.includes("That club is already in a live bracket"), "one-live-bracket error");
assert(migration.includes("tournament_player_locks"), "server-side clan lock");
assert(shareSrc.includes("round_label"), "share blurb knows the round");
assert(drawSrc.includes("meetTickerLine"), "share card draws the same ticker line");
assert(pageSrc.includes("<BracketBoard"), "board renders the bracket");
assert(pageSrc.includes("showTitles"), "clan board shows titles");
assert(playSrc.includes("id=\"play-ticker\""), "play ticker still renders");
assert(!pageSrc.includes("stripe") && !read("app/components/CreateTournament.tsx").includes("stripe"), "no checkout UI");

const diff = spawnSync("git", ["diff", "--name-only", "--", "public/foul-pole-league.html"], {
  cwd: root,
  encoding: "utf8",
});
assert(diff.status === 0 && diff.stdout.trim() === "", "foul-pole-league.html is untouched");

const ts = createRequire(import.meta.url)("typescript");
const tmpShare = path.join(root, "scripts/.share-round-check.mjs");
const tmpFormat = path.join(root, "scripts/.format-check.mjs");
function transpile(rel) {
  return ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
fs.writeFileSync(tmpFormat, transpile("lib/format.ts"));
fs.writeFileSync(
  tmpShare,
  transpile("lib/shareCard.ts").replace('from "./format"', 'from "./.format-check.mjs"')
);
const { meetTickerLine, shareBlurb } = await import(pathToFileURL(tmpShare).href);
const roundData = {
  id: "fixture-qf-obr-cheshire",
  status: "live",
  window_end: "2026-10-01T01:00:00.000Z",
  round_label: "QF",
  home: { name: "OBR Navy", total_feet: 1240, slots: 6 },
  away: { name: "Cheshire Red", total_feet: 1105, slots: 4 },
};
const line = meetTickerLine(roundData);
assert(line === "QF OBR Navy 1,240 ft (6/9) vs Cheshire Red 1,105 ft (4/9)", line);
const plain = meetTickerLine({ ...roundData, round_label: null });
assert(plain === "OBR Navy 1,240 ft (6/9) vs Cheshire Red 1,105 ft (4/9)", plain);
const blurb = shareBlurb(roundData);
assert(blurb.startsWith(line), blurb);
assert(!blurb.includes("QF QF"), blurb);
console.log("ok share round label");
fs.rmSync(tmpShare, { force: true });
fs.rmSync(tmpFormat, { force: true });

function parse(v) {
  if (v == null) return null;
  if (typeof v === "string") return JSON.parse(v);
  return v;
}

function uuidArray(ids) {
  return `array[${ids.map((id) => `'${id}'::uuid`).join(",")}]`;
}

async function q(db, sql) {
  return db.query(sql);
}

async function mustFail(db, sql, needle) {
  try {
    await db.query(sql);
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    assert(msg.toLowerCase().includes(needle.toLowerCase()), `expected "${needle}" in: ${msg}`);
    return;
  }
  assert(false, `expected failure containing "${needle}"`);
}

async function loadMigrations(db) {
  await db.exec(`
    do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
  `);
  const files = [
    "supabase/migrations/20260917183000_init_live_scoreboard.sql",
    "supabase/migrations/20260917190000_meet_park_seed_guard.sql",
    "supabase/migrations/20260917200000_create_club_and_challenge.sql",
    "supabase/migrations/20260930160000_tournaments.sql",
  ];
  for (const file of files) {
    let sql = read(file);
    sql = sql.replace(
      /do \$\$[\s\S]*?alter publication supabase_realtime[\s\S]*?end \$\$;/,
      "-- publication skipped in local verify"
    );
    try {
      await db.exec(sql);
    } catch (err) {
      console.error("FAIL loading", file);
      console.error(err);
      process.exit(1);
    }
    console.log("loaded", file);
  }
}

const CAPTAIN = "22222222-2222-4222-8222-000000000001";
const STRANGER = "22222222-2222-4222-8222-000000000002";
const TOWN_A = "11111111-1111-4111-8111-0000000000a1";
const TOWN_B = "11111111-1111-4111-8111-0000000000a2";
const TOWN_H = "11111111-1111-4111-8111-0000000000b1";

function clanId(group, n) {
  return `${group}0000000-0000-4000-8000-00000000000${n.toString(16)}`;
}
function playerId(group, n) {
  return `${group}1000000-0000-4000-8000-00000000000${n.toString(16)}`;
}

async function insertClan(db, id, name, code, town, createdAgoDays, captain) {
  await db.exec(`
    insert into public.clans (id, name, code, scope, town_id, captain_player_id, created_at)
    values (
      '${id}', '${name}', '${code}', 'local', ${town ? `'${town}'` : "null"},
      ${captain ? `'${captain}'` : "null"},
      now() - interval '${createdAgoDays} days'
    );
  `);
}

async function insertPlayer(db, id, name, town, clan) {
  await db.exec(`
    insert into public.players (id, display_name, town_id, clan_id, clan_joined_at)
    values (
      '${id}', ${name ? `'${name}'` : "null"},
      ${town ? `'${town}'` : "null"},
      ${clan ? `'${clan}'` : "null"},
      now()
    );
  `);
}

async function createBracket(db, { name, level, ids, start, hours = 24, captain = CAPTAIN }) {
  const res = await q(
    db,
    `select public.create_tournament(
      '${captain}'::uuid,
      '${name}',
      '${level}',
      ${uuidArray(ids)},
      ${start},
      ${hours}
    ) as p`
  );
  return parse(res.rows[0].p);
}

async function meetBySlot(db, tournamentId, round, slot) {
  const res = await q(
    db,
    `select id, home_side_id, away_side_id, park_seed, status, round, bracket_slot
     from public.meets
     where tournament_id = '${tournamentId}' and round = ${round} and bracket_slot = ${slot}`
  );
  assert(res.rows.length === 1, `missing round ${round} slot ${slot}`);
  return res.rows[0];
}

async function winnerOf(db, meetId) {
  const res = await q(
    db,
    `select private.meet_winner_clan(m)::text as id from public.meets m where m.id = '${meetId}'`
  );
  return res.rows[0].id;
}

async function payloadOf(db, meetId) {
  const res = await q(
    db,
    `select private.meet_payload(m) as p from public.meets m where m.id = '${meetId}'`
  );
  return parse(res.rows[0].p);
}

async function addSwing(db, meetId, player, clan, feet, atExpr) {
  await db.exec(`
    insert into public.swings (
      player_id, feet, is_homer, at, park_seed, meet_id, clan_id,
      counts_for_clan_meet, counts_for_town_rollup
    )
    select '${player}', ${feet}, false, ${atExpr}, 'neutral-v1', m.id, '${clan}', true, false
    from public.meets m where m.id = '${meetId}';
  `);
}

async function wipeMeetSwings(db, meetId) {
  await db.exec(`delete from public.swings where meet_id = '${meetId}';`);
}

async function closeRound(db, tournamentId, round) {
  await db.exec(`
    update public.meets
    set window_end = window_start + interval '20 minutes'
    where tournament_id = '${tournamentId}' and round = ${round};
    update public.swings s
    set at = m.window_start + interval '5 minutes'
    from public.meets m
    where s.meet_id = m.id
      and m.tournament_id = '${tournamentId}'
      and m.round = ${round};
  `);
  await q(db, `select private.touch_meet_statuses()`);
}

async function main() {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  await loadMigrations(db);

  await db.exec(`
    insert into public.towns (id, name, region_key) values
      ('${TOWN_A}', 'Seedingville', 'ct-seed'),
      ('${TOWN_B}', 'Otherport', 'ct-other'),
      ('${TOWN_H}', 'Harbor', 'ct-harbor');
  `);
  await insertPlayer(db, CAPTAIN, "Cap", TOWN_H, null);
  await insertPlayer(db, STRANGER, "Guest", TOWN_H, null);

  const groupA = [];
  for (let n = 1; n <= 8; n++) {
    const id = clanId("a", n);
    groupA.push(id);
    await insertClan(
      db,
      id,
      `Seed ${n}`,
      `SD${n}AAA`,
      TOWN_A,
      9 - n,
      n === 1 ? CAPTAIN : null
    );
  }
  const outsider = clanId("a", 9);
  await insertClan(db, outsider, "Outsider", "OUTSIDR", TOWN_B, 1, null);

  await mustFail(
    db,
    `select public.create_tournament(
      '${CAPTAIN}'::uuid, 'Mixed', 'local',
      ${uuidArray([groupA[0], groupA[1], groupA[2], groupA[3], groupA[4], groupA[5], groupA[6], outsider])},
      now(), 24)`,
    "same town"
  );
  await mustFail(
    db,
    `select public.create_tournament(
      '${STRANGER}'::uuid, 'Nope', 'local',
      ${uuidArray(groupA)}, now(), 24)`,
    "captain"
  );
  await mustFail(
    db,
    `select public.create_tournament(
      '${CAPTAIN}'::uuid, 'Short', 'local',
      ${uuidArray(groupA.slice(0, 7))}, now(), 24)`,
    "exactly 8"
  );

  // Newest club has the only board feet, so it is seed 1. Older clubs follow.
  await db.exec(`
    insert into public.meets (
      id, kind, level, home_side_id, away_side_id, window_start, window_end, park_seed, status
    ) values (
      'c0ffee00-0000-4000-8000-0000000000a1',
      'clan_vs_clan', 'local', '${groupA[7]}', '${groupA[6]}',
      now() - interval '2 hours', now() - interval '1 hour', 'neutral-v1', 'final'
    );
    insert into public.players (id, display_name, clan_id, town_id)
    values ('d0ffee00-0000-4000-8000-0000000000a8', 'Ace', '${groupA[7]}', '${TOWN_A}');
    insert into public.swings (
      player_id, feet, is_homer, at, park_seed, meet_id, clan_id, counts_for_clan_meet
    ) values (
      'd0ffee00-0000-4000-8000-0000000000a8', 1000, true,
      now() - interval '90 minutes', 'neutral-v1',
      'c0ffee00-0000-4000-8000-0000000000a1', '${groupA[7]}', true
    );
  `);

  const seeded = await createBracket(db, {
    name: "Seed Check",
    level: "local",
    ids: groupA,
    start: "now() + interval '2 days'",
  });
  assert(seeded.status === "scheduled", `scheduled status, got ${seeded.status}`);
  assert(seeded.entries[0].clan_id === groupA[7], "highest board feet is seed 1 even if newest");
  assert(seeded.entries[1].clan_id === groupA[0], "tie on 0 feet goes to the older club");
  assert(seeded.meets.length === 4, "QF has 4 meets");
  assert(seeded.meets.every((m) => m.park_seed === "neutral-v1"), "QF park is neutral-v1");
  assert(seeded.meets.every((m) => m.round_label === "QF"), "QF round label");
  const pair = (slot) => seeded.meets.find((m) => m.bracket_slot === slot);
  assert(pair(1).home.id === groupA[7] && pair(1).away.id === seeded.entries[7].clan_id, "slot 1 is 1v8");
  assert(pair(2).home.id === seeded.entries[3].clan_id && pair(2).away.id === seeded.entries[4].clan_id, "slot 2 is 4v5");
  assert(pair(3).home.id === seeded.entries[1].clan_id && pair(3).away.id === seeded.entries[6].clan_id, "slot 3 is 2v7");
  assert(pair(4).home.id === seeded.entries[2].clan_id && pair(4).away.id === seeded.entries[5].clan_id, "slot 4 is 3v6");

  await mustFail(
    db,
    `select public.create_tournament(
      '${CAPTAIN}'::uuid, 'Second', 'national',
      ${uuidArray(groupA)}, now(), 24)`,
    "already in a live bracket"
  );
  console.log("ok seeds, pairings, one live bracket, local town, captain");

  // Group B: predictable seeds 1..8 by age, then play the bracket.
  const groupB = [];
  for (let n = 1; n <= 8; n++) {
    const id = clanId("b", n);
    groupB.push(id);
    await insertClan(db, id, `Harbor ${n}`, `HB${n}BBB`, TOWN_H, 20 - n, n === 1 ? CAPTAIN : null);
    await insertPlayer(db, playerId("b", n), `Hitter ${n}`, TOWN_H, id);
  }
  // Captain row was inserted without a clan; point them at club 1 before the bracket freezes locks.
  await db.exec(`
    update public.players
    set clan_id = '${groupB[0]}', clan_joined_at = now(), town_id = '${TOWN_H}'
    where id = '${CAPTAIN}';
  `);

  const bracket = await createBracket(db, {
    name: "Harbor Bracket",
    level: "local",
    ids: groupB,
    start: "now() - interval '3 hours'",
  });
  assert(bracket.status === "live", "window already open → live");
  for (let n = 0; n < 8; n++) {
    assert(bracket.entries[n].clan_id === groupB[n], `seed ${n + 1} is clan ${n + 1}`);
    assert(bracket.entries[n].seed === n + 1, `seed number ${n + 1}`);
  }
  const tid = bracket.id;
  const qf1 = await meetBySlot(db, tid, 1, 1);
  assert(qf1.home_side_id === groupB[0] && qf1.away_side_id === groupB[7], "play QF 1v8");
  assert(qf1.park_seed === "neutral-v1", "play QF park");
  const qfPayload = await payloadOf(db, qf1.id);
  assert(qfPayload.ticker.startsWith("QF "), `ticker prefix: ${qfPayload.ticker}`);
  assert(qfPayload.round_label === "QF", "payload round_label");

  const sfBefore = await q(db, `select count(*)::int as n from public.meets where tournament_id = '${tid}' and round = 2`);
  assert(Number(sfBefore.rows[0].n) === 0, "SF is not created before the round ends");

  // --- winner rules on slot 1 (seed 1 home vs seed 8 away), then restore ---
  const p1 = playerId("b", 1);
  const p8 = playerId("b", 8);
  const home = groupB[0];
  const away = groupB[7];

  // Higher total. The lower total must not advance.
  await addSwing(db, qf1.id, p1, home, 500, "m.window_start + interval '10 minutes'");
  await addSwing(db, qf1.id, p8, away, 100, "m.window_start + interval '11 minutes'");
  assert((await winnerOf(db, qf1.id)) === home, "higher total advances");
  assert((await winnerOf(db, qf1.id)) !== away, "lower total does not advance");
  await wipeMeetSwings(db, qf1.id);

  // Totals tied, best swing decides, and it is NOT the higher seed.
  // Home 80+70 = 150 best 80. Away 100+50 = 150 best 100.
  const p1b = "b2000000-0000-4000-8000-000000000001";
  const p8b = "b2000000-0000-4000-8000-000000000008";
  await insertPlayer(db, p1b, "Mate 1", TOWN_H, home);
  await insertPlayer(db, p8b, "Mate 8", TOWN_H, away);
  await addSwing(db, qf1.id, p1, home, 80, "m.window_start + interval '10 minutes'");
  await addSwing(db, qf1.id, p1b, home, 70, "m.window_start + interval '11 minutes'");
  await addSwing(db, qf1.id, p8, away, 100, "m.window_start + interval '12 minutes'");
  await addSwing(db, qf1.id, p8b, away, 50, "m.window_start + interval '13 minutes'");
  const tied = await payloadOf(db, qf1.id);
  assert(tied.home.total_feet === 150 && tied.away.total_feet === 150, `tied totals ${tied.home.total_feet}/${tied.away.total_feet}`);
  assert((await winnerOf(db, qf1.id)) === away, "best swing advances, not the higher seed");
  assert((await winnerOf(db, qf1.id)) !== home, "higher seed does not advance on a worse best swing");
  await wipeMeetSwings(db, qf1.id);

  // Totals and best swing tied. Swap so the higher seed is the away side.
  await db.exec(`
    update public.meets set home_side_id = '${away}', away_side_id = '${home}' where id = '${qf1.id}';
  `);
  await addSwing(db, qf1.id, p8, away, 100, "m.window_start + interval '10 minutes'");
  await addSwing(db, qf1.id, p1, home, 100, "m.window_start + interval '11 minutes'");
  const seedTie = await payloadOf(db, qf1.id);
  assert(seedTie.home.total_feet === 100 && seedTie.away.total_feet === 100, "seed-tie totals");
  assert((await winnerOf(db, qf1.id)) === home, "higher seed advances when the best swing is tied");
  assert((await winnerOf(db, qf1.id)) !== away, "worse seed does not advance on a tied best swing");
  await wipeMeetSwings(db, qf1.id);

  // Empty side beats seed. Home (worse seed, because sides are still swapped) has a swing.
  await addSwing(db, qf1.id, p8, away, 10, "m.window_start + interval '10 minutes'");
  assert((await winnerOf(db, qf1.id)) === away, "side with swings advances over an empty higher seed");
  assert((await winnerOf(db, qf1.id)) !== home, "empty side does not advance");
  await wipeMeetSwings(db, qf1.id);

  // Both empty → higher seed, which is currently the away side.
  assert((await winnerOf(db, qf1.id)) === home, "both empty → higher seed, even when that side is away");
  assert((await winnerOf(db, qf1.id)) !== away, "both empty → worse seed does not advance");

  await db.exec(`
    update public.meets set home_side_id = '${home}', away_side_id = '${away}' where id = '${qf1.id}';
  `);
  console.log("ok winner rules: total, best swing, seed, empty side");

  // Same swings on a normal meet and this round. Top 9 drops the 10th player and the out-of-window ball.
  const normal = "c0ffee00-0000-4000-8000-0000000000b1";
  await db.exec(`
    insert into public.meets (
      id, kind, level, home_side_id, away_side_id, window_start, window_end, park_seed, status
    )
    select '${normal}', 'clan_vs_clan', 'local', home_side_id, away_side_id,
           window_start, window_end, 'neutral-v1', 'live'
    from public.meets where id = '${qf1.id}';
  `);
  const scorers = [];
  const feet = [100, 90, 70, 60, 50, 40, 30, 20, 10, 5];
  for (let i = 0; i < 10; i++) {
    const id = `e1000000-0000-4000-8000-0000000000${(i + 1).toString(16).padStart(2, "0")}`;
    scorers.push(id);
    await insertPlayer(db, id, `Scorer ${i + 1}`, TOWN_H, home);
  }
  const inside = "m.window_start + interval '15 minutes'";
  const outside = "m.window_start - interval '1 hour'";
  for (const meetId of [qf1.id, normal]) {
    for (let i = 0; i < 10; i++) {
      await addSwing(db, meetId, scorers[i], home, feet[i], inside);
    }
    await addSwing(db, meetId, scorers[0], home, 80, "m.window_start + interval '16 minutes'");
    await addSwing(db, meetId, scorers[0], home, 999, outside);
    await addSwing(db, meetId, p8, away, 40, inside);
  }
  const bracketScore = await payloadOf(db, qf1.id);
  const normalScore = await payloadOf(db, normal);
  const expected = top9Total(
    feet.map((ft, i) => ({ player: scorers[i], feet: ft, at: "2" })).concat([
      { player: scorers[0], feet: 80, at: "3" },
    ])
  );
  assert(expected === 470, `oracle top9 ${expected}`);
  assert(bracketScore.home.total_feet === normalScore.home.total_feet, "round total matches the normal meet");
  assert(bracketScore.home.slots === normalScore.home.slots, "round slots match the normal meet");
  assert(bracketScore.away.total_feet === normalScore.away.total_feet, "away total matches");
  assert(bracketScore.home.total_feet === 470, `top 9 is 470, got ${bracketScore.home.total_feet}`);
  assert(bracketScore.home.slots === 9, `9 slots, got ${bracketScore.home.slots}`);
  assert(bracketScore.away.total_feet === 40, "away scoring swing counted once");
  assert(!bracketScore.ticker.startsWith("Harbor"), "prefix did not replace the ticker");
  assert(normalScore.round_label == null, "normal meet has no round label");
  assert(!normalScore.ticker.startsWith("QF"), `normal ticker stays plain: ${normalScore.ticker}`);
  await wipeMeetSwings(db, qf1.id);
  await db.exec(`update public.meets set status = 'final' where id = '${normal}';`);
  console.log("ok round score equals normal meet scoring");

  // Anti-farm. Town meet still dual-counts; the second clan does not.
  await db.exec(`
    insert into public.meets (
      id, kind, level, home_side_id, away_side_id, window_start, window_end, park_seed, status
    ) values (
      'c0ffee00-0000-4000-8000-0000000000c1',
      'town_vs_town', 'local', '${TOWN_H}', '${TOWN_B}',
      now() - interval '3 hours', now() + interval '21 hours', 'neutral-v1', 'live'
    );
  `);
  const first = parse(
    (await q(db, `select public.post_swing('${CAPTAIN}'::uuid, 300, true, 'neutral-v1') as p`)).rows[0].p
  );
  assert(first.swing.counts_for_clan_meet === true, "locked clan scores");
  assert(first.swing.counts_for_town_rollup === true, "dual-count still credits the town meet");
  assert(first.clan_meet.home.total_feet === 300, "first swing is the meet total");

  const zip = parse(
    (await q(db, `select public.post_swing('${CAPTAIN}'::uuid, 9999, true, 'zip-06478') as p`)).rows[0].p
  );
  assert(zip.swing.counts_for_clan_meet === false, "zip park still does not count");
  assert((await payloadOf(db, qf1.id)).home.total_feet === 300, "zip feet stayed off the meet");

  await q(db, `select public.join_clan('${CAPTAIN}'::uuid, '${away}'::uuid)`);
  const lock = await q(
    db,
    `select clan_id::text as clan from public.tournament_player_locks
     where tournament_id = '${tid}' and player_id = '${CAPTAIN}'`
  );
  assert(lock.rows[0].clan === home, "lock stays the QF-open clan after a switch");

  await db.exec(`
    insert into public.meet_roster (meet_id, side, player_id)
    values ('${qf1.id}', 'away', '${CAPTAIN}')
    on conflict do nothing;
  `);
  const second = parse(
    (await q(db, `select public.post_swing('${CAPTAIN}'::uuid, 900, true, 'neutral-v1') as p`)).rows[0].p
  );
  assert(second.swing.counts_for_clan_meet === false, "switched club does not score in this bracket");
  assert(second.swing.counts_for_town_rollup === true, "town rollup still works after the switch");
  assert(second.clan_meet == null, "no clan meet payload when the lock rejects it");
  const afterSwitch = await payloadOf(db, qf1.id);
  assert(afterSwitch.home.total_feet === 300, "original clan keeps its swing");
  assert(afterSwitch.away.total_feet === 0, "second clan did not receive the swing");

  const late = "22222222-2222-4222-8222-000000000099";
  await insertPlayer(db, late, "Late", TOWN_H, away);
  await q(db, `select public.post_swing('${late}'::uuid, 50, false, 'neutral-v1')`);
  assert((await payloadOf(db, qf1.id)).away.total_feet === 0, "joiner after the freeze cannot score");
  await wipeMeetSwings(db, qf1.id);
  console.log("ok one clan per player, roster does not bypass, zip park still blocked");

  // Script the QF so seeds 1, 4, 2, 3 win. Wrong clubs must not appear in the SF.
  const qfMeets = [];
  for (let slot = 1; slot <= 4; slot++) qfMeets.push(await meetBySlot(db, tid, 1, slot));
  const favored = [
    [groupB[0], groupB[7], 800, 100],
    [groupB[3], groupB[4], 500, 400],
    [groupB[1], groupB[6], 700, 200],
    [groupB[2], groupB[5], 600, 300],
  ];
  for (let i = 0; i < 4; i++) {
    const meet = qfMeets[i];
    const [h, a, hf, af] = favored[i];
    assert(meet.home_side_id === h && meet.away_side_id === a, `QF slot ${i + 1} sides`);
    const hp = playerId("b", groupB.indexOf(h) + 1);
    const ap = playerId("b", groupB.indexOf(a) + 1);
    await addSwing(db, meet.id, hp, h, hf, "m.window_start + interval '10 minutes'");
    await addSwing(db, meet.id, ap, a, af, "m.window_start + interval '11 minutes'");
    assert((await winnerOf(db, meet.id)) === h, `QF slot ${i + 1} higher total wins`);
  }
  await closeRound(db, tid, 1);
  const sf1 = await meetBySlot(db, tid, 2, 1);
  const sf2 = await meetBySlot(db, tid, 2, 2);
  const sfSides = [sf1.home_side_id, sf1.away_side_id, sf2.home_side_id, sf2.away_side_id].sort();
  const expectSf = [groupB[0], groupB[1], groupB[2], groupB[3]].sort();
  assert(JSON.stringify(sfSides) === JSON.stringify(expectSf), `SF sides ${sfSides}`);
  assert(sf1.home_side_id === groupB[0] && sf1.away_side_id === groupB[3], "SF slot 1 is winners of QF 1 and 2");
  assert(sf2.home_side_id === groupB[1] && sf2.away_side_id === groupB[2], "SF slot 2 is winners of QF 3 and 4");
  assert(!sfSides.includes(groupB[7]), "8 seed did not advance");
  assert(sf1.park_seed === "neutral-v1" && sf2.park_seed === "neutral-v1", "SF park");
  const sfLabel = await payloadOf(db, sf1.id);
  assert(sfLabel.round_label === "SF" && sfLabel.ticker.startsWith("SF "), sfLabel.ticker);
  const sfCount = await q(db, `select count(*)::int as n from public.meets where tournament_id = '${tid}' and round = 2`);
  await q(db, `select private.touch_meet_statuses()`);
  const sfCount2 = await q(db, `select count(*)::int as n from public.meets where tournament_id = '${tid}' and round = 2`);
  assert(Number(sfCount.rows[0].n) === 2 && Number(sfCount2.rows[0].n) === 2, "advancing twice does not duplicate the SF");
  console.log("ok next round pairings");

  await addSwing(db, sf1.id, playerId("b", 1), groupB[0], 900, "m.window_start + interval '10 minutes'");
  await addSwing(db, sf1.id, playerId("b", 4), groupB[3], 100, "m.window_start + interval '11 minutes'");
  await addSwing(db, sf2.id, playerId("b", 2), groupB[1], 800, "m.window_start + interval '10 minutes'");
  await addSwing(db, sf2.id, playerId("b", 3), groupB[2], 100, "m.window_start + interval '11 minutes'");
  await closeRound(db, tid, 2);
  const finalMeet = await meetBySlot(db, tid, 3, 1);
  assert(
    [finalMeet.home_side_id, finalMeet.away_side_id].sort().join() === [groupB[0], groupB[1]].sort().join(),
    "final is the two SF winners"
  );
  assert(finalMeet.home_side_id === groupB[0], "higher seed is home in the final");
  const finalLabel = await payloadOf(db, finalMeet.id);
  assert(finalLabel.round_label === "F" && finalLabel.ticker.startsWith("F "), finalLabel.ticker);

  await addSwing(db, finalMeet.id, playerId("b", 1), groupB[0], 1000, "m.window_start + interval '10 minutes'");
  await addSwing(db, finalMeet.id, playerId("b", 2), groupB[1], 10, "m.window_start + interval '11 minutes'");
  await closeRound(db, tid, 3);
  const done = await q(
    db,
    `select status::text as status, champion_clan_id::text as champ from public.tournaments where id = '${tid}'`
  );
  assert(done.rows[0].status === "final", "bracket is final");
  assert(done.rows[0].champ === groupB[0], "champion is the final winner");
  assert(done.rows[0].champ !== groupB[1], "runner-up is not champion");

  const titles = parse((await q(db, `select private.clan_totals('ct-harbor') as p`)).rows[0].p);
  const champRow = titles.find((row) => row.id === groupB[0]);
  const otherRow = titles.find((row) => row.id === groupB[7]);
  assert(champRow && champRow.titles === 1, `titles ${JSON.stringify(champRow)}`);
  assert(!otherRow || otherRow.titles === 0, "non-champion has no title");
  console.log("ok champion and titles");

  await mustFail(
    db,
    `select public.create_tournament(
      '${CAPTAIN}'::uuid, 'While Live', 'national',
      ${uuidArray(groupA)}, now(), 24)`,
    "already in a live bracket"
  );
  // Group A is still scheduled, so it still blocks. Release it, then a national bracket of B is allowed.
  await db.exec(`
    update public.tournaments
    set status = 'final', champion_clan_id = '${groupA[7]}'
    where id = '${seeded.id}';
  `);
  const national = await createBracket(db, {
    name: "National Eight",
    level: "national",
    ids: groupB,
    start: "now()",
  });
  assert(national.level === "national" && national.meets.length === 4, "national bracket is 8 clubs, 4 QF meets");
  assert(national.meets.every((m) => m.park_seed === "neutral-v1" && m.round_label === "QF"), "national QF label and park");
  console.log("ok national bracket after the local one is final");

  console.log("ok — tournament brackets");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
