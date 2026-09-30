import { deadlineCopy } from "./format";
import type { MeetPayload } from "./types";

/** Clan or town membership the scoreboard already returns. Roster lists stay on the server. */
export type PlayPlayer = {
  clan_id: string | null;
  town_id: string | null;
} | null;

export type PlayNotice = {
  /** "This meet is final" or "Starts {ET time}". */
  text: string;
  /** Player's live meet, when one exists. Null means a free swing. */
  liveMeetId: string | null;
};

export type PlayTarget = {
  /**
   * Meet the ticker, share button, and park lock follow.
   * Null is a free swing on the default park — nothing counts.
   */
  scoringMeet: MeetPayload | null;
  /** Set only when ?meet= points at a scheduled or final meet. Swings never use that meet. */
  notice: PlayNotice | null;
};

function bannerText(meet: Pick<MeetPayload, "status" | "window_start">): string {
  if (meet.status === "final") return "This meet is final";
  return `Starts ${deadlineCopy(meet.window_start)}`;
}

/**
 * Same question as private.find_live_meet / player_eligible_for_side, using
 * fields the scoreboard payload already has. A non-empty roster (listed > 0)
 * means only named players score; my_meet_ids is that name list.
 */
export function playerEligibleForMeet(
  meet: MeetPayload,
  player: PlayPlayer,
  myMeetIds: readonly string[]
): boolean {
  if (!player || meet.status !== "live") return false;
  const sideId = meet.kind === "clan_vs_clan" ? player.clan_id : player.town_id;
  if (!sideId) return false;
  const side =
    sideId === meet.home.id ? meet.home : sideId === meet.away.id ? meet.away : null;
  if (!side) return false;
  if ((side.listed ?? 0) > 0 && !myMeetIds.includes(meet.id)) return false;
  return true;
}

/** First live meet of this kind the player can actually score, by window_start. */
export function playerLiveMeet(
  meets: readonly MeetPayload[],
  player: PlayPlayer,
  myMeetIds: readonly string[],
  kind: MeetPayload["kind"]
): MeetPayload | null {
  const hits = meets
    .filter((m) => m.kind === kind && playerEligibleForMeet(m, player, myMeetIds))
    .sort((a, b) => a.window_start.localeCompare(b.window_start));
  return hits[0] ?? null;
}

/**
 * Where /play?meet= should swing.
 *
 * A live link loads that meet and its park. A scheduled or final link never
 * becomes the swing target: the player's own live clan meet (else town meet)
 * is loaded instead, or the swing stays free on the default park.
 */
export function resolvePlayTarget(
  meets: readonly MeetPayload[],
  meetId: string | null,
  player: PlayPlayer,
  myMeetIds: readonly string[] = []
): PlayTarget {
  const id = meetId?.trim() || null;
  const linked = id ? meets.find((m) => m.id === id) : undefined;

  if (linked && (linked.status === "scheduled" || linked.status === "final")) {
    const live =
      playerLiveMeet(meets, player, myMeetIds, "clan_vs_clan") ??
      playerLiveMeet(meets, player, myMeetIds, "town_vs_town");
    const base = bannerText(linked);
    return {
      scoringMeet: live,
      notice: {
        text: live ? base : `${base}. Swings don't count toward a meet.`,
        liveMeetId: live?.id ?? null,
      },
    };
  }

  if (linked && linked.status === "live") {
    return { scoringMeet: linked, notice: null };
  }

  const live = meets.find((m) => m.status === "live") ?? null;
  return { scoringMeet: live, notice: null };
}

/** Park lock for a live scoring meet. Scheduled, final, and free swings stay unlocked. */
export function scoringParkSeed(meet: MeetPayload | null): string | null {
  if (!meet || meet.status !== "live") return null;
  const seed = meet.park_seed?.trim();
  return seed || null;
}
