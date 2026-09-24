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
  const railH = 110;
  const railGrad = ctx.createLinearGradient(0, 0, 0, railH);
  railGrad.addColorStop(0, "rgba(14,33,53,0.96)");
  railGrad.addColorStop(1, "rgba(14,33,53,0.78)");
  ctx.fillStyle = railGrad;
  ctx.fillRect(0, 0, W, railH);
  ctx.fillStyle = TOKENS.pole;
  ctx.fillRect(0, railH - 6, W, 6);

  ctx.fillStyle = TOKENS.dim;
  ctx.font = "600 22px Archivo, system-ui, sans-serif";
  ctx.fillText("FOUL POLE LEAGUE", 48, 48);
  ctx.fillStyle = TOKENS.chalk;
  ctx.font = "800 48px 'Barlow Condensed', Archivo, sans-serif";
  ctx.fillText("LIVE BOARD", 48, 96);

  // Status pill
  const status = data.status.toUpperCase();
  const pillX = W - 48;
  ctx.font = "800 28px 'Barlow Condensed', Archivo, sans-serif";
  const pillW = Math.max(120, ctx.measureText(status).width + 40);
  const pillH = 48;
  const px = pillX - pillW;
  const py = 36;
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

  // Main card panel
  const cardX = 40;
  const cardY = 150;
  const cardW = W - 80;
  const cardH = H - 320;
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

  // Ticker strip
  let y = cardY + 70;
  ctx.fillStyle = TOKENS.pole;
  ctx.font = "800 22px 'Barlow Condensed', Archivo, sans-serif";
  const liveLabel = data.status === "live" ? "LIVE  " : data.status === "final" ? "FINAL  " : "";
  ctx.fillText(liveLabel, cardX + 36, y);
  const labelW = liveLabel ? ctx.measureText(liveLabel).width : 0;
  ctx.fillStyle = TOKENS.chalk;
  ctx.font = "800 36px 'Barlow Condensed', Archivo, sans-serif";
  const ticker = `${data.home.name} ${formatFeet(data.home.total_feet)} ft (${data.home.slots}/9) vs ${data.away.name} ${formatFeet(data.away.total_feet)} ft (${data.away.slots}/9)`;
  wrapText(ctx, ticker, cardX + 36 + labelW, y, cardW - 72 - labelW, 40);

  // Two sides
  y = cardY + 220;
  const colW = (cardW - 72) / 2;
  const leftX = cardX + 36;
  const rightX = leftX + colW + 24;
  drawSide(ctx, data.home, leftX, y, colW);
  drawSide(ctx, data.away, rightX, y, colW);

  // Deadline / FINAL
  y = cardY + cardH - 200;
  ctx.fillStyle = TOKENS.line;
  ctx.fillRect(cardX + 36, y, cardW - 72, 2);
  y += 60;
  if (data.status === "final") {
    const winner = meetWinnerName(data);
    ctx.fillStyle = TOKENS.pole;
    ctx.font = "800 56px 'Barlow Condensed', Archivo, sans-serif";
    ctx.fillText("FINAL", cardX + 36, y);
    y += 56;
    ctx.fillStyle = TOKENS.chalk;
    ctx.font = "800 40px 'Barlow Condensed', Archivo, sans-serif";
    ctx.fillText(winner ? `${winner} wins` : "Tie", cardX + 36, y);
  } else {
    ctx.fillStyle = TOKENS.dim;
    ctx.font = "600 22px Archivo, system-ui, sans-serif";
    ctx.fillText("WINDOW", cardX + 36, y - 20);
    ctx.fillStyle = TOKENS.chalk;
    ctx.font = "800 48px 'Barlow Condensed', Archivo, sans-serif";
    ctx.fillText(byDeadline(data.window_end), cardX + 36, y + 36);
    const needHome = Math.max(0, 9 - data.home.slots);
    const needAway = Math.max(0, 9 - data.away.slots);
    y += 90;
    ctx.fillStyle = TOKENS.bulb;
    ctx.font = "700 28px Archivo, system-ui, sans-serif";
    if (needHome + needAway > 0) {
      ctx.fillText(
        `Empty slots open — need ${needHome} / ${needAway} more`,
        cardX + 36,
        y
      );
    } else {
      ctx.fillText("Cards are full", cardX + 36, y);
    }
  }

  // Footer URL
  const footY = H - 100;
  ctx.fillStyle = TOKENS.ink;
  ctx.fillRect(0, footY - 40, W, H - (footY - 40));
  ctx.fillStyle = TOKENS.pole;
  ctx.fillRect(0, footY - 40, W, 4);
  ctx.fillStyle = TOKENS.dim;
  ctx.font = "600 20px Archivo, system-ui, sans-serif";
  ctx.fillText("OPEN THIS MEET", 48, footY + 10);
  ctx.fillStyle = TOKENS.chalk;
  ctx.font = "700 26px Archivo, system-ui, sans-serif";
  wrapText(ctx, url, 48, footY + 48, W - 96, 32);
}

function drawSide(
  ctx: CanvasRenderingContext2D,
  side: ShareMeetData["home"],
  x: number,
  y: number,
  w: number
): void {
  ctx.fillStyle = TOKENS.chalk;
  ctx.font = "800 42px 'Barlow Condensed', Archivo, sans-serif";
  const name = side.name.toUpperCase();
  fitText(ctx, name, x, y, w, 42);

  ctx.fillStyle = TOKENS.pole;
  ctx.font = "800 96px 'Barlow Condensed', Archivo, sans-serif";
  ctx.fillText(`${formatFeet(side.total_feet)}`, x, y + 100);
  const ftW = ctx.measureText(`${formatFeet(side.total_feet)}`).width;
  ctx.font = "800 36px 'Barlow Condensed', Archivo, sans-serif";
  ctx.fillText(" ft", x + ftW, y + 100);

  ctx.fillStyle = TOKENS.dim;
  ctx.font = "700 28px 'Barlow Condensed', Archivo, sans-serif";
  ctx.fillText(`${side.slots}/9 slots`, x, y + 150);

  // All 9 slots — empty ones visibly empty
  const gap = 10;
  const slotW = (w - gap * 8) / 9;
  const slotH = 56;
  const sy = y + 180;
  for (let i = 0; i < 9; i++) {
    const sx = x + i * (slotW + gap);
    const filled = i < side.slots;
    ctx.fillStyle = filled ? TOKENS.slotFilled : TOKENS.slotBg;
    ctx.fillRect(sx, sy, slotW, slotH);
    ctx.strokeStyle = filled ? TOKENS.slotBorderFilled : TOKENS.line;
    ctx.lineWidth = 2;
    ctx.strokeRect(sx + 1, sy + 1, slotW - 2, slotH - 2);
    ctx.fillStyle = filled ? TOKENS.chalk : TOKENS.dim;
    ctx.font = "800 22px 'Barlow Condensed', Archivo, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(filled ? "●" : "—", sx + slotW / 2, sy + 36);
    ctx.textAlign = "left";
  }
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
): void {
  const words = text.split(" ");
  let line = "";
  let cy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, cy);
      line = word;
      cy += lineH;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, cy);
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

/** Browser helper: paint + return a PNG blob. */
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
