#!/usr/bin/env node
/**
 * QA helper: prove zip parks change fence geometry vs the meet seed,
 * and that /play actually points the iframe at that seed.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const html = fs.readFileSync(path.join(root, "public/foul-pole-league.html"), "utf8");
const play = fs.readFileSync(path.join(root, "app/play/page.tsx"), "utf8");
const meetPark = fs.readFileSync(path.join(root, "lib/meetPark.ts"), "utf8");
const sql = fs.readFileSync(
  path.join(root, "supabase/migrations/20260917190000_meet_park_seed_guard.sql"),
  "utf8"
);

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

assert(html.includes("const dt=1/200,k=0.00116,g=32.174"), "physics k must stay 0.00116");
assert(html.includes("URLSearchParams(location.search).get('park_seed')"), "HTML must read park_seed from the iframe URL");
assert(html.includes("function lockMeetPark"), "HTML must lock the live meet park");
assert(html.includes("Live meet locks the park"), "zip setup must not rebuild park during a live meet");
assert(html.includes("meetParkSeed ||"), "swing postMessage must report the meet seed");
assert(play.includes("gameIframeSrc(meetParkSeed)"), "/play must drive the iframe src from the live meet park");
assert(play.includes("type: \"set_park\""), "/play must postMessage set_park into the iframe");
assert(sql.includes("seed is distinct from clan_m.park_seed"), "post_swing must not relabel zip parks as the meet");
assert(sql.includes("seed is distinct from town_m.park_seed"), "post_swing must not relabel zip parks as the town meet");
assert(meetPark.includes("park_seed=${encodeURIComponent(seed)}"), "iframe helper must pass park_seed");

function liveMeetParkSeed(meets) {
  const live = meets?.find((m) => m.status === "live");
  const seed = live?.park_seed?.trim();
  return seed || null;
}
function gameIframeSrc(parkSeed) {
  const seed = parkSeed?.trim();
  if (!seed) return "/foul-pole-league.html";
  return `/foul-pole-league.html?park_seed=${encodeURIComponent(seed)}`;
}

assert(liveMeetParkSeed([]) === null, "no live meet → no forced park");
assert(
  liveMeetParkSeed([
    { status: "scheduled", park_seed: "neutral-v1" },
    { status: "live", park_seed: "neutral-v1" },
  ]) === "neutral-v1",
  "live meet park_seed is used"
);
assert(
  gameIframeSrc("neutral-v1") === "/foul-pole-league.html?park_seed=neutral-v1",
  "iframe src carries park_seed"
);
assert(gameIframeSrc(null) === "/foul-pole-league.html", "no meet → no query param");

const start = html.indexOf("function hashStr");
const end = html.indexOf("// fence distance at a spray angle");
const src = html.slice(start, end);
const fn = new Function(`${src}; return { hashStr, mulberry, makePark };`);
const { makePark } = fn();
const zip = makePark("06478", "Oxford", "");
const other = makePark("10001", "Brooklyn", "");
const meet = makePark("neutral-v1", "Neutral park", "Neutral Park");
assert(meet.name === "Neutral Park", "meet park uses the Neutral Park label");
assert(meet.zip === "neutral-v1", "meet park zip/seed is the meet seed");
assert(
  zip.lf !== meet.lf || zip.cf !== meet.cf || zip.rf !== meet.rf || zip.wallH !== meet.wallH,
  "zip 06478 geometry must differ from neutral-v1 (short-porch farming)"
);
assert(
  other.lf !== meet.lf || other.cf !== meet.cf || other.rf !== meet.rf,
  "a short-porch zip must not match the meet seed"
);
const meet2 = makePark("neutral-v1", "Neutral park", "Neutral Park");
assert(meet.lf === meet2.lf && meet.cf === meet2.cf && meet.rf === meet2.rf, "neutral-v1 is deterministic");

console.log("ok — meet park is forced; k unchanged");
console.log(
  JSON.stringify(
    {
      zip06478: { lf: zip.lf, cf: zip.cf, rf: zip.rf, wallH: zip.wallH },
      zip10001: { lf: other.lf, cf: other.cf, rf: other.rf, wallH: other.wallH },
      "neutral-v1": { lf: meet.lf, cf: meet.cf, rf: meet.rf, wallH: meet.wallH, name: meet.name },
    },
    null,
    2
  )
);
