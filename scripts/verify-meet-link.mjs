#!/usr/bin/env node
/**
 * §5b follow-up: /play?meet= pointing at a scheduled or final meet must not
 * take swings against that meet. A live meet the player can score loads
 * (park lock included). Otherwise the swing is free and the UI says so.
 */
import fs from "node:fs";
import path from "node:path";
import { resolvePlayTarget, scoringParkSeed } from "../lib/playMeet.ts";
import { selectBlurbText } from "../lib/shareCard.ts";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

function side(id, name, listed = 0) {
  return {
    id,
    name,
    total_feet: 0,
    slots: 0,
    listed,
    slot_rows: [],
  };
}

function meet(partial) {
  return {
    kind: "clan_vs_clan",
    level: "local",
    park_seed: "neutral-v1",
    window_end: "2026-09-30T23:00:00.000Z",
    home_wins: 0,
    away_wins: 0,
    roster_cap: 15,
    ticker: `${partial.id} ticker`,
    home: side("clan-home", "Home"),
    away: side("clan-away", "Away"),
    ...partial,
  };
}

const player = { clan_id: "clan-home", town_id: "town-home" };

const finalMeet = meet({
  id: "meet-final",
  status: "final",
  window_start: "2026-09-28T22:00:00.000Z",
  ticker: "FINAL CARD 10 ft (1/9) vs OTHER 0 ft (0/9)",
});

const scheduledMeet = meet({
  id: "meet-scheduled",
  status: "scheduled",
  window_start: "2026-09-30T23:00:00.000Z",
  ticker: "SCHEDULED CARD 0 ft (0/9) vs OTHER 0 ft (0/9)",
});

const liveClan = meet({
  id: "meet-live-clan",
  status: "live",
  window_start: "2026-09-30T18:00:00.000Z",
  park_seed: "neutral-v1",
  ticker: "NAVY 400 ft (2/9) vs RED 100 ft (1/9)",
  home: side("clan-home", "Navy"),
  away: side("clan-away", "Red"),
});

const liveOther = meet({
  id: "meet-live-other",
  status: "live",
  window_start: "2026-09-30T17:00:00.000Z",
  park_seed: "neutral-v1",
  home: side("clan-strangers", "Strangers"),
  away: side("clan-other", "Other"),
});

const liveTown = meet({
  id: "meet-live-town",
  kind: "town_vs_town",
  status: "live",
  window_start: "2026-09-30T19:00:00.000Z",
  park_seed: "neutral-v1",
  ticker: "OXFORD 20 ft (1/9) vs DERBY 0 ft (0/9)",
  home: side("town-home", "Oxford"),
  away: side("town-away", "Derby"),
});

/**
 * post_swing drops a live meet when the swing's park_seed is not that meet's.
 * A free swing sends the game's own park, never a meet seed we failed to lock.
 */
function serverMeetId(sentSeed, live) {
  if (!live) return null;
  if (sentSeed == null || sentSeed !== live.park_seed) return null;
  return live.id;
}

function expectCounts(target, live, label) {
  const seed = scoringParkSeed(target.scoringMeet);
  assert(target.scoringMeet?.status === "live", `${label}: scoring meet must be live`);
  assert(target.scoringMeet.id === live.id, `${label}: loaded the player's live meet`);
  assert(seed === live.park_seed, `${label}: park lock is the live meet seed`);
  assert(serverMeetId(seed, live) === live.id, `${label}: post_swing would credit this swing`);
  assert(target.notice, `${label}: banner is shown`);
  assert(!target.notice.text.includes("don't count"), `${label}: banner must not say the swing is free`);
  assert(target.notice.liveMeetId === live.id, `${label}: Go to live meet targets that meet`);
  assert(target.scoringMeet.id !== "meet-final" && target.scoringMeet.id !== "meet-scheduled", `${label}: not the linked meet`);
}

function expectFree(target, label) {
  const seed = scoringParkSeed(target.scoringMeet);
  assert(target.scoringMeet == null, `${label}: no scoring meet`);
  assert(seed == null, `${label}: default park, no meet lock`);
  assert(serverMeetId(seed, null) == null, `${label}: nothing to credit`);
  assert(target.notice?.liveMeetId == null, `${label}: no live meet button`);
  assert(
    target.notice.text.includes("don't count"),
    `${label}: banner says the swing does not count (${target.notice.text})`
  );
  assert(!target.notice.text.includes("ft ("), `${label}: banner is not a score ticker`);
}

// 1. Linked final meet, player's clan has a live meet.
{
  const target = resolvePlayTarget(
    [liveOther, finalMeet, liveClan],
    "meet-final",
    player,
    []
  );
  expectCounts(target, liveClan, "final + clan live");
  assert(target.notice.text === "This meet is final", `final banner: ${target.notice.text}`);
  assert(target.scoringMeet.id !== liveOther.id, "another clan's live meet is not the target");
}

// 2. Linked scheduled meet, player's clan has a live meet.
{
  const target = resolvePlayTarget(
    [scheduledMeet, liveClan],
    "meet-scheduled",
    player,
    []
  );
  expectCounts(target, liveClan, "scheduled + clan live");
  assert(target.notice.text.startsWith("Starts "), `scheduled banner: ${target.notice.text}`);
  assert(target.notice.text.includes("ET"), "scheduled banner uses ET");
  assert(target.notice.text.includes("7:00"), `ET clock: ${target.notice.text}`);
}

// 3. Linked final, no live meet for this player (someone else's live meet is on the board).
{
  const target = resolvePlayTarget([finalMeet, liveOther], "meet-final", player, []);
  expectFree(target, "final + no live");
  assert(target.notice.text.startsWith("This meet is final"), target.notice.text);
}

// 4. Linked scheduled, no live meet at all.
{
  const target = resolvePlayTarget([scheduledMeet], "meet-scheduled", player, []);
  expectFree(target, "scheduled + no live");
  assert(target.notice.text.startsWith("Starts "), target.notice.text);
}

// Town live meet counts when the clan has none.
{
  const target = resolvePlayTarget([finalMeet, liveTown], "meet-final", player, []);
  expectCounts(target, liveTown, "final + town live");
}

// Clan live wins over town live (one park lock; clan is the meet the ticker shows).
{
  const target = resolvePlayTarget(
    [finalMeet, liveTown, liveClan],
    "meet-final",
    player,
    []
  );
  assert(target.scoringMeet.id === liveClan.id, "clan live preferred over town live");
}

// Named roster: a member who is not on the card cannot score, so it is a free swing.
{
  const rostered = meet({
    ...liveClan,
    id: "meet-live-roster",
    home: side("clan-home", "Navy", 3),
  });
  const offCard = resolvePlayTarget([finalMeet, rostered], "meet-final", player, []);
  expectFree(offCard, "rostered live, player not listed");
  const onCard = resolvePlayTarget([finalMeet, rostered], "meet-final", player, ["meet-live-roster"]);
  expectCounts(onCard, rostered, "rostered live, player listed");
}

// Earlier window wins when two of the player's clan meets are live.
{
  const later = meet({ ...liveClan, id: "meet-live-later", window_start: "2026-09-30T20:00:00.000Z" });
  const target = resolvePlayTarget([finalMeet, later, liveClan], "meet-final", player, []);
  assert(target.scoringMeet.id === liveClan.id, "earlier live window is the one find_live_meet returns");
}

// A live link still loads that meet and its park. No banner.
{
  const target = resolvePlayTarget([liveClan, finalMeet], "meet-live-clan", player, []);
  assert(target.notice == null, "live link has no banner");
  assert(scoringParkSeed(target.scoringMeet) === "neutral-v1", "live link locks park");
  assert(serverMeetId(scoringParkSeed(target.scoringMeet), liveClan) === liveClan.id, "live link counts");
}

// No ?meet= still picks a live meet (existing /play behavior) and locks its park.
{
  const target = resolvePlayTarget([scheduledMeet, liveClan], null, player, []);
  assert(target.notice == null, "no link, no banner");
  assert(target.scoringMeet.id === liveClan.id, "no link falls through to a live meet");
}

// The old bug: a non-live link cleared the park while the ticker stayed on that meet.
// Swings then missed every live meet. The scoring meet must not be the linked one,
// and a cleared park must not sit under a meet ticker.
{
  const target = resolvePlayTarget([finalMeet, liveClan], "meet-final", player, []);
  assert(target.scoringMeet.ticker === liveClan.ticker, "ticker is the live meet, not the final card");
  assert(scoringParkSeed(target.scoringMeet) != null, "park is not cleared out from under a live ticker");
}

const play = read("app/play/page.tsx");
const share = read("app/components/ShareMeet.tsx");
const html = read("public/foul-pole-league.html");
const sql = read("supabase/migrations/20260917190000_meet_park_seed_guard.sql");

assert(play.includes("resolvePlayTarget(meets, deepMeetId, player, myMeetIds)"), "page resolves ?meet=");
assert(play.includes("scoringParkSeed(activeMeet)"), "park lock comes from the scoring meet");
assert(play.includes("gameIframeSrc(meetParkSeed)"), "iframe still follows the park lock");
assert(play.includes('className="play-notice"'), "banner markup");
assert(play.includes("Go to live meet"), "banner button");
assert(play.includes('type: "clear_park"'), "free swing still clears the meet park");
assert(!play.includes("setMeetParkSeed"), "page no longer clears the park for a non-live selection");
assert(html.includes("const CONTACT={barrel:.03,good:.09,solid:.36,fair:.58}"), "CONTACT left at .36/.58");
assert(html.includes('id="goQuick"'), "first swing CTA untouched");
assert(sql.includes("seed is distinct from clan_m.park_seed"), "post_swing guard untouched");
assert(share.includes("selectBlurbText(blurbRef.current)"), "clipboard fallback selects the textarea");
assert(share.includes("setClipboardFallback(!canUseClipboard())"), "missing Clipboard API shows the fallback");
assert(share.includes("data-clipboard-fallback"), "fallback state is on the textarea");

const calls = [];
const blurb = "Navy 400 ft — https://example.test/play?meet=1";
selectBlurbText({
  focus() { calls.push("focus"); },
  select() { calls.push("select"); },
  value: blurb,
  setSelectionRange(start, end) { calls.push(`range:${start}-${end}`); },
});
assert(
  calls.join(",") === `focus,select,range:0-${blurb.length}`,
  `selection calls: ${calls.join(",")}`
);
selectBlurbText(null);

console.log("ok — ?meet= scheduled/final banner, live fallback, free swing");
