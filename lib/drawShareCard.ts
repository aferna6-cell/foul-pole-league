import { formatFeet } from "./format";
import {
  byDeadline,
  meetDeepLink,
  meetWinnerName,
  type ShareMeetData,
} from "./shareCard";

export const SHARE_CARD_W = 1080;
export const SHARE_CARD_H = 1920;

const TOKENS = {
  bg: "#07101b",
  panel: "#0c2137",
  panelTop: "#123049",
  ink: "#0e2135",
  pole: "#ffd23f",
  chalk: "#f7f2e5",
  dim: "rgba(247, 242, 229, 0.62)",
  line: "rgba(247, 242, 229, 0.18)",
  bulb: "#f4c56b",
  slotBg: "rgba(7,16,27,0.55)",
  slotFilled: "rgba(244,197,107,0.08)",
  slotBorderFilled: "rgba(244,197,107,0.55)",
};

const OUTER = 40;
const INSET = 44; // equal margin inside the panel
const FOOTER_H = 240;

/** Scoreboard chrome — not a poster. Same facts as the ticker. */
export function drawMeetShareCard(
  ctx: CanvasRenderingContext2D,
  data: ShareMeetData,
  opts?: { width?: number; height?: number; url?: string }
): void {
  const W = opts?.width ?? SHARE_CARD_W;
  const H = opts?.height ?? SHARE_CARD_H;
  const url = opts?.url ?? meetDeepLink(data.id);

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = TOKENS.bg;
  ctx.fillRect(0, 0, W, H);

  // Top enamel rail
  const railH = 118;
  const railGrad = ctx.createLinearGradient(0, 0, 0, railH);
  railGrad.addColorStop(0, "rgba(14,33,53,0.96)");
  railGrad.addColorStop(1, "rgba(14,33,53,0.78)");
  ctx.fillStyle = railGrad;
  ctx.fillRect(0, 0, W, railH);
  ctx.fillStyle = TOKENS.pole;
  ctx.fillRect(0, railH - 6, W, 6);

  ctx.fillStyle = TOKENS.dim;
  ctx.font = "600 22px Archivo, system-ui, sans-serif";
  ctx.fillText("FOUL POLE LEAGUE", OUTER, 42);
  ctx.fillStyle = TOKENS.chalk;
  ctx.font = "800 52px 'Barlow Condensed', Archivo, sans-serif";
  ctx.fillText("LIVE BOARD", OUTER, 98);

  const status = data.status.toUpperCase();
  ctx.font = "800 28px 'Barlow Condensed', Archivo, sans-serif";
  const pillW = Math.max(120, ctx.measureText(status).width + 40);
  const pillH = 48;
  const px = W - OUTER - pillW;
  const py = 38;
  if (data.status === "live") {
    ctx.fillStyle = TOKENS.pole;
    roundRect(ctx, px, py, pillW, pillH, 2);
    ctx.fill();
    ctx.fillStyle = "#16202b";
  } else {
    ctx.strokeStyle = TOKENS.line;
    ctx.lineWidth = 2;
    roundRect(ctx, px, py, pillW, pillH, 2);
    ctx.stroke();
    ctx.fillStyle = TOKENS.dim;
  }
  ctx.textAlign = "center";
  ctx.fillText(status, px + pillW / 2, py + 34);
  ctx.textAlign = "left";

  // Main panel
  const cardX = OUTER - 4;
  const cardY = railH + 24;
  const cardW = W - (OUTER - 4) * 2;
  const cardH = H - cardY - FOOTER_H - 16;
  const cardGrad = ctx.createLinearGradient(0, cardY, 0, cardY + cardH);
  cardGrad.addColorStop(0, TOKENS.panelTop);
  cardGrad.addColorStop(1, TOKENS.panel);
  ctx.fillStyle = cardGrad;
  ctx.fillRect(cardX, cardY, cardW, cardH);
  ctx.strokeStyle = TOKENS.line;
  ctx.lineWidth = 2;
  ctx.strokeRect(cardX + 1, cardY + 1, cardW - 2, cardH - 2);
  ctx.fillStyle = TOKENS.pole;
  ctx.fillRect(cardX, cardY, cardW, 8);

  const innerX = cardX + INSET;
  const innerW = cardW - INSET * 2;
  const contentBottom = cardY + cardH - INSET;

  // Header ticker
  let y = cardY + 52;
  ctx.fillStyle = TOKENS.pole;
  ctx.font = "800 24px 'Barlow Condensed', Archivo, sans-serif";
  const liveLabel =
    data.status === "live" ? "LIVE" : data.status === "final" ? "FINAL" : "";
  if (liveLabel) {
    ctx.fillText(liveLabel, innerX, y);
    y += 34;
  }
  ctx.fillStyle = TOKENS.chalk;
  ctx.font = "800 32px 'Barlow Condensed', Archivo, sans-serif";
  const ticker = `${data.home.name} ${formatFeet(data.home.total_feet)} ft (${data.home.slots}/9) vs ${data.away.name} ${formatFeet(data.away.total_feet)} ft (${data.away.slots}/9)`;
  y = wrapText(ctx, ticker, innerX, y, innerW, 38) + 20;

  ctx.fillStyle = TOKENS.line;
  ctx.fillRect(innerX, y, innerW, 2);
  y += 28;

  // Status footer height estimate (used to size team blocks)
  const statusH = data.status === "final" ? 150 : 190;
  const sidesBudget = contentBottom - statusH - y;
  const sideGap = 28;
  const sideH = Math.floor((sidesBudget - sideGap) / 2);

  y = drawSideStacked(ctx, data.home, "HOME", innerX, y, innerW, sideH);
  // VS rule between sides
  const mid = y + Math.floor(sideGap / 2);
  ctx.fillStyle = TOKENS.line;
  ctx.fillRect(innerX, mid - 1, innerW, 2);
  ctx.fillStyle = TOKENS.dim;
  ctx.font = "800 22px 'Barlow Condensed', Archivo, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("VS", innerX + innerW / 2, mid + 8);
  ctx.textAlign = "left";
  y += sideGap;

  y = drawSideStacked(ctx, data.away, "AWAY", innerX, y, innerW, sideH);

  // Deadline / FINAL
  y = Math.max(y + 24, contentBottom - statusH + 16);
  ctx.fillStyle = TOKENS.line;
  ctx.fillRect(innerX, y, innerW, 2);
  y += 44;

  if (data.status === "final") {
    const winner = meetWinnerName(data);
    ctx.fillStyle = TOKENS.pole;
    ctx.font = "800 60px 'Barlow Condensed', Archivo, sans-serif";
    ctx.fillText("FINAL", innerX, y);
    y += 58;
    ctx.fillStyle = TOKENS.chalk;
    fitText(ctx, winner ? `${winner} wins` : "Tie", innerX, y, innerW, 44);
  } else {
    ctx.fillStyle = TOKENS.dim;
    ctx.font = "600 18px Archivo, system-ui, sans-serif";
    ctx.fillText("WINDOW", innerX, y);
    y += 42;
    ctx.fillStyle = TOKENS.chalk;
    ctx.font = "800 48px 'Barlow Condensed', Archivo, sans-serif";
    ctx.fillText(byDeadline(data.window_end), innerX, y);
    y += 52;

    const needHome = Math.max(0, 9 - data.home.slots);
    const needAway = Math.max(0, 9 - data.away.slots);
    ctx.fillStyle = TOKENS.bulb;
    ctx.font = "700 26px Archivo, system-ui, sans-serif";
    if (needHome + needAway > 0) {
      const needLine = `${data.home.name} needs ${needHome} · ${data.away.name} needs ${needAway}`;
      wrapText(ctx, needLine, innerX, y, innerW, 32);
    } else {
      ctx.fillText("Cards are full", innerX, y);
    }
  }

  // Footer — full URL wrapped/shrunk to stay readable
  const footTop = H - FOOTER_H;
  ctx.fillStyle = TOKENS.ink;
  ctx.fillRect(0, footTop, W, FOOTER_H);
  ctx.fillStyle = TOKENS.pole;
  ctx.fillRect(0, footTop, W, 4);
  ctx.fillStyle = TOKENS.dim;
  ctx.font = "600 18px Archivo, system-ui, sans-serif";
  ctx.fillText("OPEN THIS MEET", OUTER, footTop + 42);
  drawWrappedUrl(ctx, url, OUTER, footTop + 82, W - OUTER * 2, FOOTER_H - 110);
}

/**
 * Full-width stacked side. Slots are floored and centered so all 9 sit fully
 * inside `w` with equal left/right margins. Content scales to fill `blockH`.
 * Returns y at the bottom of the allocated block.
 */
function drawSideStacked(
  ctx: CanvasRenderingContext2D,
  side: ShareMeetData["home"],
  label: string,
  x: number,
  y: number,
  w: number,
  blockH: number
): number {
  const top = y;
  const bottom = top + blockH;

  // Floor + center slot row inside w with equal margins (+ small extra inset).
  const slotInset = 10;
  const areaX = x + slotInset;
  const areaW = w - slotInset * 2;
  const gap = clamp(Math.floor(areaW * 0.01), 6, 10);
  let slotW = Math.floor((areaW - gap * 8) / 9);
  let used = 9 * slotW + 8 * gap;
  while (used > areaW && slotW > 20) {
    slotW -= 1;
    used = 9 * slotW + 8 * gap;
  }
  const rowX = areaX + Math.floor((areaW - used) / 2);

  let cy = top + 8;
  ctx.fillStyle = TOKENS.dim;
  ctx.font = "600 18px Archivo, system-ui, sans-serif";
  ctx.fillText(label, x, cy + 16);
  cy += 30;

  const nameSize = clamp(Math.floor(blockH * 0.14), 40, 64);
  ctx.fillStyle = TOKENS.chalk;
  fitText(ctx, side.name.toUpperCase(), x, cy + nameSize * 0.85, w, nameSize);
  cy += nameSize + 14;

  // Feet grow into available headroom; slots then take everything below.
  const feetStr = formatFeet(side.total_feet);
  const minSlot = 64;
  const labelH = 36;
  let feetSize = clamp(Math.floor(blockH * 0.32), 88, 170);
  const maxFeet = Math.max(88, bottom - cy - minSlot - labelH - 24);
  feetSize = Math.min(feetSize, maxFeet);
  ctx.font = `800 ${feetSize}px 'Barlow Condensed', Archivo, sans-serif`;
  while (feetSize > 56 && ctx.measureText(`${feetStr} ft`).width > w) {
    feetSize -= 4;
    ctx.font = `800 ${feetSize}px 'Barlow Condensed', Archivo, sans-serif`;
  }

  ctx.fillStyle = TOKENS.pole;
  ctx.fillText(feetStr, x, cy + feetSize * 0.85);
  const ftW = ctx.measureText(feetStr).width;
  const unitSize = Math.max(28, Math.round(feetSize * 0.36));
  ctx.font = `800 ${unitSize}px 'Barlow Condensed', Archivo, sans-serif`;
  ctx.fillText(" ft", x + ftW, cy + feetSize * 0.85);
  cy += feetSize + 8;

  ctx.fillStyle = TOKENS.dim;
  ctx.font = "700 28px 'Barlow Condensed', Archivo, sans-serif";
  ctx.fillText(`${side.slots}/9 slots`, x, cy + 24);
  cy += labelH;

  // Slots start right under the label and grow to the block bottom — no empty band.
  const slotsY = cy + 4;
  const slotH = Math.max(minSlot, bottom - slotsY - 4);

  for (let i = 0; i < 9; i++) {
    const sx = rowX + i * (slotW + gap);
    const filled = i < side.slots;
    ctx.fillStyle = filled ? TOKENS.slotFilled : TOKENS.slotBg;
    ctx.fillRect(sx, slotsY, slotW, slotH);
    ctx.strokeStyle = filled ? TOKENS.slotBorderFilled : TOKENS.line;
    ctx.lineWidth = 2;
    ctx.strokeRect(sx + 1, slotsY + 1, slotW - 2, slotH - 2);
    ctx.fillStyle = filled ? TOKENS.chalk : TOKENS.dim;
    const markSize = clamp(Math.floor(Math.min(slotW, slotH) * 0.4), 16, 34);
    ctx.font = `800 ${markSize}px 'Barlow Condensed', Archivo, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(filled ? "●" : "—", sx + slotW / 2, slotsY + slotH * 0.62);
    ctx.textAlign = "left";
  }

  return bottom;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number
): number {
  const words = text.split(/\s+/);
  let line = "";
  let cy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, cy);
      line = word;
      cy += lineH;
      while (ctx.measureText(line).width > maxW && line.length > 4) {
        let cut = line.length - 1;
        while (cut > 4 && ctx.measureText(line.slice(0, cut)).width > maxW) cut--;
        ctx.fillText(line.slice(0, cut), x, cy);
        line = line.slice(cut);
        cy += lineH;
      }
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, cy);
  return cy;
}

function drawWrappedUrl(
  ctx: CanvasRenderingContext2D,
  url: string,
  x: number,
  y: number,
  maxW: number,
  maxH: number
): void {
  let size = 24;
  ctx.fillStyle = TOKENS.chalk;
  const lineH = (s: number) => Math.round(s * 1.3);

  const layout = (s: number) => {
    ctx.font = `700 ${s}px Archivo, system-ui, sans-serif`;
    return breakUrl(ctx, url, maxW);
  };

  while (size > 15) {
    const lines = layout(size);
    if (lines.length * lineH(size) <= maxH) break;
    size -= 1;
  }
  const lines = layout(size);
  let cy = y;
  for (const line of lines) {
    ctx.fillText(line, x, cy);
    cy += lineH(size);
  }
}

function breakUrl(
  ctx: CanvasRenderingContext2D,
  url: string,
  maxW: number
): string[] {
  // Keep a visible right margin; force wrap for long Railway deep links.
  const softMax = Math.min(maxW - 8, maxW * 0.92);
  const playAt = url.indexOf("/play?");
  if (playAt > 0 && ctx.measureText(url).width > softMax * 0.85) {
    const a = url.slice(0, playAt);
    const b = url.slice(playAt);
    // Recurse each segment in case the meet id alone is still wide
    return [...breakUrlSimple(ctx, a, softMax), ...breakUrlSimple(ctx, b, softMax)];
  }
  return breakUrlSimple(ctx, url, softMax);
}

function breakUrlSimple(
  ctx: CanvasRenderingContext2D,
  url: string,
  softMax: number
): string[] {
  if (ctx.measureText(url).width <= softMax) return [url];
  const lines: string[] = [];
  let rest = url;
  while (rest.length) {
    if (ctx.measureText(rest).width <= softMax) {
      lines.push(rest);
      break;
    }
    let cut = rest.length - 1;
    while (cut > 8 && ctx.measureText(rest.slice(0, cut)).width > softMax) cut--;
    const window = rest.slice(0, cut);
    const soft = Math.max(
      window.lastIndexOf("/"),
      window.lastIndexOf("?"),
      window.lastIndexOf("&"),
      window.lastIndexOf("="),
      window.lastIndexOf("-")
    );
    if (soft > 12) cut = soft + 1;
    lines.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  return lines;
}

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  baseSize: number
): void {
  let size = baseSize;
  ctx.font = `800 ${size}px 'Barlow Condensed', Archivo, sans-serif`;
  while (size > 22 && ctx.measureText(text).width > maxW) {
    size -= 2;
    ctx.font = `800 ${size}px 'Barlow Condensed', Archivo, sans-serif`;
  }
  ctx.fillText(text, x, y);
}

export async function renderShareCardPng(
  data: ShareMeetData,
  opts?: { url?: string }
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = SHARE_CARD_W;
  canvas.height = SHARE_CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");
  if (typeof document !== "undefined" && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* ignore */
    }
  }
  drawMeetShareCard(ctx, data, opts);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))),
      "image/png"
    );
  });
}
