export function formatFeet(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function formatTicker(homeName: string, homeFt: number, homeSlots: number, awayName: string, awayFt: number, awaySlots: number): string {
  return `${homeName} ${formatFeet(homeFt)} ft (${homeSlots}/9) vs ${awayName} ${formatFeet(awayFt)} ft (${awaySlots}/9)`;
}

export function deadlineCopy(iso: string): string {
  const end = new Date(iso);
  const t = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(end);
  return `${t} ET`;
}

export function needMoreCopy(slots: number, windowEnd: string): string {
  const n = Math.max(0, 9 - slots);
  if (n === 0) return "Card is full";
  return `Need ${n} more by ${deadlineCopy(windowEnd)}`;
}

export function rpcMessage(err: { message?: string } | null): string {
  if (!err?.message) return "That did not go through.";
  const m = err.message.replace(/^.*error: /i, "");

  // The cooldown raise carries a raw Postgres timestamp and the word "clan",
  // which is not what the board calls it. Say it the way a person would.
  const cooldown = m.match(/clan switch cooldown until (.+)$/i);
  if (cooldown) {
    // Postgres hands back "2026-09-19 20:21:45.783199+00": a space instead of
    // T, and a two-digit offset that Date rejects.
    const iso = cooldown[1]
      .trim()
      .replace(" ", "T")
      .replace(/([+-]\d{2})$/, "$1:00");
    const until = new Date(iso);
    if (!Number.isNaN(until.getTime())) {
      return `You already switched clubs. You can move again after ${until.toLocaleString(
        undefined,
        { weekday: "short", hour: "numeric", minute: "2-digit" }
      )}.`;
    }
    return "You already switched clubs recently — there is a 48-hour cooldown.";
  }
  return m;
}
