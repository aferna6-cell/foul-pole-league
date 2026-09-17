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
  return m;
}
