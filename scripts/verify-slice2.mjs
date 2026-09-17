#!/usr/bin/env node
/**
 * Slice 2 checks: CTA safe-area, CONTACT windows vs meter CSS, k unchanged, meet park path.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const html = read("public/foul-pole-league.html");
const play = read("app/play/page.tsx");
const page = read("app/page.tsx");
const css = read("app/globals.css");
const layout = read("app/layout.tsx");
const meetPark = read("lib/meetPark.ts");

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

function num(v) {
  const n = Number(v);
  assert(Number.isFinite(n), `not a number: ${v}`);
  return n;
}

assert(html.includes("const dt=1/200,k=0.00116,g=32.174"), "physics k must stay 0.00116");
assert(!html.includes("k=0.00098"), "old k must not return");
assert(html.includes("function lockMeetPark"), "meet park lock still present");
assert(play.includes("gameIframeSrc(meetParkSeed)"), "/play still drives iframe from live meet park");
assert(meetPark.includes("park_seed=${encodeURIComponent(seed)}"), "iframe helper still passes park_seed");

assert(layout.includes('viewportFit: "cover"'), "Next viewport-fit=cover so env(safe-area-inset-*) is non-zero");
assert(css.includes("env(safe-area-inset-bottom)"), "play chrome / dock must use safe-area-inset-bottom");
assert(css.includes("100dvh - 52px"), "play iframe must have an explicit height (replaced element)");
assert(css.includes("swing-dock"), "mobile Take a swing dock");
assert(css.includes("position: fixed") && css.includes("swing-dock"), "dock is a fixed thumb-zone CTA, not clipped in the top rail");
assert(page.includes('className="swing-dock"'), "board renders the dock CTA");
assert(page.includes('href="/play"'), "Take a swing still goes to /play (no login)");
assert(html.includes("Tap when the bar hits gold"), "plain gold-window copy");
assert(html.includes("id=\"goQuick\""), "first swing still the splash CTA");
assert(html.includes("$('goQuick').onclick=()=>{ac();startMatch('derby',null,10,'Derby')}"), "first swing is free derby — no login");
assert(html.includes("env(safe-area-inset-bottom)"), "in-game HUD uses safe-area-inset-bottom");
assert(html.includes("#swingbtn") && html.includes("min-height:64px"), "SWING is a large thumb target");

const contactM = html.match(
  /const CONTACT=\{barrel:([0-9.]+),good:([0-9.]+),solid:([0-9.]+),fair:([0-9.]+)\}/
);
assert(contactM, "CONTACT object must exist");
const CONTACT = {
  barrel: num(contactM[1]),
  good: num(contactM[2]),
  solid: num(contactM[3]),
  fair: num(contactM[4]),
};
assert(CONTACT.barrel < 0.09, `barrel window should tighten below slice-1 0.09 (got ${CONTACT.barrel})`);
assert(CONTACT.good <= 0.22, `good window should not widen past slice-1 0.22 (got ${CONTACT.good})`);
assert(Math.abs(CONTACT.solid - 0.4) < 1e-9, "solid left at 0.40");
assert(Math.abs(CONTACT.fair - 0.62) < 1e-9, "fair left at 0.62");
assert(html.includes("off<CONTACT.barrel"), "qualityFrom must use CONTACT, not a second copy of the numbers");

function zonePct(id) {
  const m = html.match(new RegExp(`#${id}\\{left:([0-9.]+)%;right:([0-9.]+)%`));
  assert(m, `#${id} CSS left/right missing`);
  const left = num(m[1]);
  const right = num(m[2]);
  assert(left === right, `#${id} left/right must be symmetric (gold bar would lie)`);
  return left;
}
function insetPct(off) {
  return ((1 - off) / 2) * 100;
}
function close(a, b, label) {
  assert(Math.abs(a - b) < 0.05, `${label}: CSS ${a}% vs CONTACT inset ${b}%`);
}

close(zonePct("zBarrel"), insetPct(CONTACT.barrel), "#zBarrel");
close(zonePct("zGood"), insetPct(CONTACT.good), "#zGood");
close(zonePct("zFair"), insetPct(CONTACT.solid), "#zFair");
assert(html.includes("function syncMeterZones"), "runtime meter sync from CONTACT");
assert(html.includes("syncMeterZones()"), "syncMeterZones is called");

console.log("ok — slice 2 CTA + meter sync");
console.log(
  JSON.stringify(
    {
      k: 0.00116,
      CONTACT,
      css: {
        zBarrel: `${zonePct("zBarrel")}%`,
        zGood: `${zonePct("zGood")}%`,
        zFair: `${zonePct("zFair")}%`,
      },
      inset: {
        zBarrel: `${insetPct(CONTACT.barrel)}%`,
        zGood: `${insetPct(CONTACT.good)}%`,
        zFair: `${insetPct(CONTACT.solid)}%`,
      },
      goldMsAt1_60s: Math.round(CONTACT.barrel * 1600),
      goodMsAt1_60s: Math.round(CONTACT.good * 1600),
    },
    null,
    2
  )
);
