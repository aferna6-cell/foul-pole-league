#!/usr/bin/env node
/**
 * Difficulty regression check.
 *
 * Louis on the live site: "almost every hit is a HR". This measures the real
 * thing rather than eyeballing constants — it lifts qualityFrom(), flight(),
 * makePark() and CONTACT straight out of the shipped prototype, then plays
 * Monte Carlo swings at neutral-v1 and reports the home-run rate.
 *
 * The player model is a tap aimed at the gold centre with Gaussian timing
 * error. The meter is a single 1.60s sweep, so an error of d ms lands at
 * off = 2d/1600. Sigma 35ms is an expert, 95ms is a first-timer on a phone.
 *
 * Fails if the game drifts back toward "everything is a homer", or if the
 * gold bar stops meaning "barreled".
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const html = fs.readFileSync(path.join(root, "public/foul-pole-league.html"), "utf8");

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

/** Pull the real functions out of the HTML so this never tests a stale copy. */
function loadGame(src) {
  const grab = (a, b) => {
    const i = src.indexOf(a);
    assert(i >= 0, `could not find ${a} in the prototype`);
    const j = src.indexOf(b, i);
    assert(j >= 0, `could not find ${b} after ${a}`);
    return src.slice(i, j).replace(/\/\*\s*=+\s*$/, "");
  };
  // flight() only ever constructs THREE.Vector3; the rest of the browser
  // surface the sliced code touches is the embed sniff and localStorage.
  const stub =
    "const THREE={Vector3:class{constructor(x,y,z){this.x=x;this.y=y;this.z=z}}};" +
    "const window={parent:1},document={documentElement:{setAttribute(){}}}," +
    "localStorage={getItem:()=>null,setItem(){}};";
  const body = [
    stub,
    grab("const clamp=(v,a,b)", "/* ---------- storage ---------- */"),
    grab("const PARK_SUFFIX=", "   OPPONENT CLUBS"),
    grab("function flight(mph", "   AUDIO"),
    grab("const CONTACT={", "function doSwing"),
  ].join("\n");
  return new Function(`${body}\nreturn {qualityFrom,flight,makePark,fenceAt,CONTACT};`)();
}

const G = loadGame(html);
const PARK = G.makePark("neutral-v1", "Neutral park", "Neutral Park");
globalThis.P = PARK; // flight() reads the module-level park

function swing(t) {
  const r = G.qualityFrom(t);
  const F = G.flight(r.mph, r.la, r.spray, 0);
  const foul = Math.abs(r.spray) > 45;
  return { homer: !foul && (F.cleared || F.boardHit), wall: F.wallHit, foul };
}

const PITCH_DUR = 1.6;
function rateAt(sigmaMs, n = 6000) {
  let hr = 0;
  let gold = 0;
  let wall = 0;
  for (let i = 0; i < n; i++) {
    let u = 0;
    let v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    const err = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigmaMs;
    const t = Math.min(1, Math.max(0, 0.5 + err / 1000 / PITCH_DUR));
    const o = swing(t);
    if (o.homer) hr++;
    if (o.wall) wall++;
    if (Math.abs(t - 0.5) * 2 < G.CONTACT.barrel) gold++;
  }
  return { hr: (100 * hr) / n, gold: (100 * gold) / n, wall: (100 * wall) / n };
}

function bandRate(lo, hi, n = 4000) {
  let hr = 0;
  for (let i = 0; i < n; i++) {
    const off = lo + Math.random() * (hi - lo);
    const t = Math.random() < 0.5 ? 0.5 - off / 2 : 0.5 + off / 2;
    if (swing(t).homer) hr++;
  }
  return (100 * hr) / n;
}

// Baselines measured on the PR #3 build (commit 4db7fc3), 20k swings per cell.
const BASELINE = { 35: 94, 50: 89, 70: 81, 95: 72 };
// Ceilings with headroom for Monte Carlo noise at n=6000 (~+-1.2pp at 2 sigma).
const CEILING = { 35: 84, 50: 72, 70: 60, 95: 50 };

const rows = [35, 50, 70, 95].map((s) => ({ sigma: s, ...rateAt(s) }));

console.log("home run rate at neutral-v1, 1.60s sweep, 6000 swings per row\n");
console.log("  tap sigma   was    now    gold   off-the-wall");
for (const r of rows) {
  console.log(
    `  ${String(r.sigma).padStart(3)}ms      ${String(BASELINE[r.sigma]).padStart(3)}%   ` +
      `${r.hr.toFixed(0).padStart(3)}%   ${r.gold.toFixed(0).padStart(3)}%   ${r.wall.toFixed(0).padStart(3)}%`
  );
}
console.log();

for (const r of rows) {
  assert(
    r.hr <= CEILING[r.sigma],
    `HR rate at sigma ${r.sigma}ms is ${r.hr.toFixed(1)}%, over the ${CEILING[r.sigma]}% ceiling ` +
      `(PR #3 baseline was ${BASELINE[r.sigma]}%) — the derby drifted back to "everything is a homer"`
  );
  assert(
    r.hr < BASELINE[r.sigma] - 8,
    `HR rate at sigma ${r.sigma}ms is ${r.hr.toFixed(1)}%, not clearly below the ${BASELINE[r.sigma]}% baseline`
  );
}

// Gold has to keep meaning "gone", or the yellow bar is lying to the player.
const goldHr = bandRate(0, G.CONTACT.barrel);
assert(goldHr >= 99, `a barreled ball should always leave the yard, got ${goldHr.toFixed(1)}%`);

// ...and the band just outside gold has to be a genuine near miss, not a
// second kind of homer. That plateau was the actual bug.
const goodHr = bandRate(G.CONTACT.barrel, G.CONTACT.good);
assert(
  goodHr < 45,
  `the squared-up band homers ${goodHr.toFixed(1)}% of the time — it is a second gold zone, not a near miss`
);
assert(goodHr > 5, `the squared-up band homers only ${goodHr.toFixed(1)}% — too punishing to be a reward`);

assert(html.includes("const dt=1/200,k=0.00116,g=32.174"), "difficulty must not come from drag k");
assert(!/k=0\.0(?!0116)/.test(html), "drag k must not be retuned to fake difficulty");

console.log("ok — HR rate tightened, gold still means gone, k untouched");
console.log(
  JSON.stringify(
    {
      park: { lf: PARK.lf, cf: PARK.cf, rf: PARK.rf, wallH: PARK.wallH },
      CONTACT: G.CONTACT,
      goldWindowMs: Math.round(G.CONTACT.barrel * PITCH_DUR * 1000),
      goodWindowMs: Math.round(G.CONTACT.good * PITCH_DUR * 1000),
      bandHomerRate: { gold: `${goldHr.toFixed(0)}%`, good: `${goodHr.toFixed(0)}%` },
    },
    null,
    2
  )
);
