/** Meet window presets. A start/end datetime pair is a bad ask on a phone. */

export type WindowChoice = "3h" | "6h" | "tonight" | "24h";

export const WINDOW_CHOICES: { value: WindowChoice; label: string }[] = [
  { value: "3h", label: "Next 3 hours" },
  { value: "6h", label: "Next 6 hours" },
  { value: "tonight", label: "Tonight (until 11pm ET)" },
  { value: "24h", label: "Next 24 hours" },
];

const ZONE = "America/New_York";

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function wallClock(at: Date) {
  const parts = PARTS.formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // hourCycle h23 vs h24: midnight can come back as 24.
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Zone offset in ms at a given instant (negative west of UTC). */
function offsetAt(at: Date): number {
  const w = wallClock(at);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * The instant at which the Eastern wall clock reads the given date at 23:00.
 *
 * Resolved in two passes. One pass is wrong on a DST changeover day, because
 * the offset in force at "now" is not the offset in force at 11pm — measuring
 * once at 00:30 on 2026-11-01 lands the window at 10pm, not 11pm. The second
 * pass re-measures at the candidate instant, which settles it.
 */
function elevenPmEastern(year: number, month: number, day: number): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, 23, 0, 0);
  let instant = wallAsUtc - offsetAt(new Date(wallAsUtc));
  instant = wallAsUtc - offsetAt(new Date(instant));
  return new Date(instant);
}

/** Returns the [start, end] instants for a preset. Start is always now. */
export function windowFor(choice: WindowChoice, now: Date = new Date()): [Date, Date] {
  const plus = (h: number) => new Date(now.getTime() + h * 3600_000);
  if (choice === "3h") return [now, plus(3)];
  if (choice === "6h") return [now, plus(6)];
  if (choice === "24h") return [now, plus(24)];

  // "tonight" — 11pm ET today, or tomorrow once that is within 5 minutes.
  // The server rejects a window that has already closed, so never send one.
  const today = wallClock(now);
  let end = elevenPmEastern(today.year, today.month, today.day);
  if (end.getTime() <= now.getTime() + 5 * 60_000) {
    const t = wallClock(new Date(now.getTime() + 24 * 3600_000));
    end = elevenPmEastern(t.year, t.month, t.day);
  }
  return [now, end];
}
