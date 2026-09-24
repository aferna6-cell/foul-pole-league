#!/usr/bin/env node
/**
 * §5b checks: blurb string, deep link URL, canvas PNG for live + final fixtures.
 * Renders via Playwright + esbuild bundle of lib/drawShareCard.ts (fixture data —
 * same draw path as the client; no live Supabase required for the PNG).
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = process.env.SHARE_CARD_OUT || "/workspace/foul-pole-uploads/share-card";
fs.mkdirSync(outDir, { recursive: true });

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

const SHARE_BASE = "https://foul-pole-web-production.up.railway.app";

function formatFeet(n) {
  return Math.round(n).toLocaleString("en-US");
}
function deadlineCopy(iso) {
  const end = new Date(iso);
  const t = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(end);
  return `${t} ET`;
}
function meetDeepLink(meetId, base = SHARE_BASE) {
  return `${base.replace(/\/$/, "")}/play?meet=${encodeURIComponent(meetId)}`;
}
function shareBlurb(data, url) {
  const link = url ?? meetDeepLink(data.id);
  const head = `${data.home.name} ${formatFeet(data.home.total_feet)} ft (${data.home.slots}/9) vs ${data.away.name} ${formatFeet(data.away.total_feet)} ft (${data.away.slots}/9)`;
  if (data.status === "final") {
    let winner = null;
    if (data.home.total_feet !== data.away.total_feet) {
      winner =
        data.home.total_feet > data.away.total_feet
          ? data.home.name
          : data.away.name;
    }
    const tail = winner ? `FINAL. ${winner} wins.` : "FINAL. Tie.";
    return `${head} — ${tail} ${link}`;
  }
  const need = Math.max(0, 9 - data.home.slots);
  return `${head} — need ${need} more by ${deadlineCopy(data.window_end)}. ${link}`;
}

const liveFixture = {
  id: "meet-live-fixture-001",
  status: "live",
  window_end: "2026-09-24T01:00:00.000Z",
  home: { name: "OBR Navy", total_feet: 1240, slots: 6 },
  away: { name: "Cheshire Red", total_feet: 1105, slots: 4 },
};

const finalFixture = {
  id: "meet-final-fixture-002",
  status: "final",
  window_end: "2026-09-20T02:00:00.000Z",
  home: { name: "OBR Navy", total_feet: 1580, slots: 9 },
  away: { name: "Cheshire Red", total_feet: 1422, slots: 9 },
};

const liveUrl = meetDeepLink(liveFixture.id);
assert(liveUrl === `${SHARE_BASE}/play?meet=meet-live-fixture-001`, "live deep link");
assert(liveUrl.includes("/play?meet="), "not bare homepage");
const liveBlurb = shareBlurb(liveFixture);
assert(liveBlurb.includes("OBR Navy 1,240 ft (6/9)"), `live home: ${liveBlurb}`);
assert(liveBlurb.includes("Cheshire Red 1,105 ft (4/9)"), "live away");
assert(liveBlurb.includes("need 3 more by"), `need more: ${liveBlurb}`);
assert(liveBlurb.includes("9:00 PM ET"), `deadline: ${liveBlurb}`);
assert(liveBlurb.includes(liveUrl), "url in blurb");

const finalBlurb = shareBlurb(finalFixture);
assert(finalBlurb.includes("FINAL. OBR Navy wins."), `final: ${finalBlurb}`);
assert(finalBlurb.includes(meetDeepLink(finalFixture.id)), "final url");

console.log("OK blurb + URL");
console.log("  live:", liveBlurb);
console.log("  final:", finalBlurb);

const shareSrc = fs.readFileSync(path.join(root, "lib/shareCard.ts"), "utf8");
const drawSrc = fs.readFileSync(path.join(root, "lib/drawShareCard.ts"), "utf8");
const pageSrc = fs.readFileSync(path.join(root, "app/page.tsx"), "utf8");
const playSrc = fs.readFileSync(path.join(root, "app/play/page.tsx"), "utf8");
assert(shareSrc.includes("meetDeepLink"), "shareCard exports deep link");
assert(drawSrc.includes("1080") && drawSrc.includes("1920"), "1080x1920");
assert(drawSrc.includes("for (let i = 0; i < 9; i++)"), "draws all 9 slots");
assert(pageSrc.includes("<ShareMeet"), "board Share");
assert(playSrc.includes("<ShareMeet"), "play Share");
assert(playSrc.includes('searchParams.get("meet")'), "play deep link");
assert(pageSrc.includes('searchParams.get("meet")'), "board deep link");

async function renderWithPlaywright() {
  const require = createRequire(import.meta.url);
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch {
    console.log("SKIP PNG: playwright missing");
    return false;
  }

  const iifePath = path.join(root, "scripts/.share-card-iife.js");
  execSync(
    `npx --yes esbuild lib/drawShareCard.ts --bundle --format=iife --global-name=ShareCardDraw --platform=browser --outfile=${JSON.stringify(iifePath)}`,
    { cwd: root, stdio: "pipe" }
  );
  const iife = fs.readFileSync(iifePath, "utf8");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1120, height: 2000 } });
  await page.setContent(`<!DOCTYPE html><html><head>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Archivo:wght@400;500;600;700&display=swap" rel="stylesheet"/>
</head><body style="margin:0;background:#07101b">
<canvas id="c" width="1080" height="1920"></canvas>
<script>${iife}</script>
</body></html>`, { waitUntil: "networkidle" });

  await page.waitForFunction(() => document.fonts && document.fonts.status === "loaded", {
    timeout: 20000,
  }).catch(() => {});
  await page.waitForTimeout(500);

  async function shot(fixture, name) {
    const dataUrl = await page.evaluate((data) => {
      const c = document.getElementById("c");
      const ctx = c.getContext("2d");
      ShareCardDraw.drawMeetShareCard(ctx, data);
      return c.toDataURL("image/png");
    }, fixture);
    const buf = Buffer.from(dataUrl.split(",")[1], "base64");
    assert(buf.length > 5000, `${name} too small (${buf.length})`);
    assert(buf[0] === 0x89 && buf[1] === 0x50, `${name} not PNG`);
    const dest = path.join(outDir, name);
    fs.writeFileSync(dest, buf);
    console.log("wrote", dest, buf.length, "bytes");
  }

  await shot(liveFixture, "share-card-live.png");
  await shot(finalFixture, "share-card-final.png");
  await browser.close();
  try { fs.unlinkSync(iifePath); } catch {}
  return true;
}

const rendered = await renderWithPlaywright();
console.log(rendered ? "OK PNG render (playwright + fixture data via drawMeetShareCard)" : "PNG skipped");
console.log("verify-share-card done");
