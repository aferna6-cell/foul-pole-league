import { deadlineCopy, formatFeet } from "./format";
import type { MeetPayload } from "./types";

/** Production host locked in MVP spec §9. Clipboard URLs always point here. */
export const SHARE_BASE = "https://foul-pole-web-production.up.railway.app";

/** Deep link that opens THAT meet on /play (park + ticker select it). */
export function meetDeepLink(meetId: string, base: string = SHARE_BASE): string {
  return `${base.replace(/\/$/, "")}/play?meet=${encodeURIComponent(meetId)}`;
}

/** Board deep link — scrolls to / highlights the meet card. */
export function meetBoardLink(meetId: string, base: string = SHARE_BASE): string {
  return `${base.replace(/\/$/, "")}/?meet=${encodeURIComponent(meetId)}`;
}

export type ShareMeetData = {
  id: string;
  status: MeetPayload["status"];
  window_end: string;
  home: { name: string; total_feet: number; slots: number };
  away: { name: string; total_feet: number; slots: number };
};

/** Pull the same fields the live ticker already has — no second scoring path. */
export function shareDataFromMeet(meet: MeetPayload): ShareMeetData {
  return {
    id: meet.id,
    status: meet.status,
    window_end: meet.window_end,
    home: {
      name: meet.home.name,
      total_feet: meet.home.total_feet,
      slots: meet.home.slots,
    },
    away: {
      name: meet.away.name,
      total_feet: meet.away.total_feet,
      slots: meet.away.slots,
    },
  };
}

/** "by 9:00 PM ET" from window_end (America/New_York). */
export function byDeadline(windowEnd: string): string {
  return `by ${deadlineCopy(windowEnd)}`;
}

export function meetWinnerName(data: ShareMeetData): string | null {
  if (data.status !== "final") return null;
  if (data.home.total_feet === data.away.total_feet) return null;
  return data.home.total_feet > data.away.total_feet
    ? data.home.name
    : data.away.name;
}

/**
 * One-tap clipboard blurb (§5b).
 * Live/scheduled: need {9-n} more by {deadline}.
 * Final: FINAL + winner.
 */
export function shareBlurb(data: ShareMeetData, url?: string): string {
  const link = url ?? meetDeepLink(data.id);
  const head = `${data.home.name} ${formatFeet(data.home.total_feet)} ft (${data.home.slots}/9) vs ${data.away.name} ${formatFeet(data.away.total_feet)} ft (${data.away.slots}/9)`;
  if (data.status === "final") {
    const winner = meetWinnerName(data);
    const tail = winner ? `FINAL. ${winner} wins.` : "FINAL. Tie.";
    return `${head} — ${tail} ${link}`;
  }
  const need = Math.max(0, 9 - data.home.slots);
  return `${head} — need ${need} more ${byDeadline(data.window_end)}. ${link}`;
}
