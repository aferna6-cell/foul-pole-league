import type { MeetPayload } from "./types";

/** Same live meet /play already uses for the ticker. */
export function liveMeetParkSeed(
  meets: Pick<MeetPayload, "status" | "park_seed">[] | null | undefined
): string | null {
  const live = meets?.find((m) => m.status === "live");
  const seed = live?.park_seed?.trim();
  return seed || null;
}

export function gameIframeSrc(parkSeed: string | null | undefined): string {
  const seed = parkSeed?.trim();
  if (!seed) return "/foul-pole-league.html";
  return `/foul-pole-league.html?park_seed=${encodeURIComponent(seed)}`;
}
