export type MeetSide = {
  id: string;
  name: string;
  total_feet: number;
  slots: number;
  /** Players named on the card. Distinct from `slots`, which is scoring balls. */
  listed: number;
  slot_rows: { player_id: string; display_name: string | null; feet: number }[];
};

export type MeetPayload = {
  id: string;
  kind: "clan_vs_clan" | "town_vs_town";
  level: "local" | "national";
  status: "scheduled" | "live" | "final";
  park_seed: string;
  window_start: string;
  window_end: string;
  home_wins: number;
  away_wins: number;
  home: MeetSide;
  away: MeetSide;
  /** Hard cap on names per side, enforced by a trigger. */
  roster_cap: number;
  ticker: string;
};

export type BoardRow = {
  id: string;
  name: string;
  feet: number;
  region_key?: string | null;
  scope?: string | null;
};

export type PlayerPayload = {
  id: string;
  display_name: string | null;
  town_id: string | null;
  town_name: string | null;
  region_key: string | null;
  clan_id: string | null;
  clan_name: string | null;
  clan_code: string | null;
  clan_joined_at: string | null;
  clan_cooldown_until: string | null;
  created_at: string;
};

export type TownOption = { id: string; name: string; region_key: string };

/** Cosmetic only. Nothing in scoring reads these. */
export type ClanColors = { primary?: string; secondary?: string };

export type ClanOption = {
  id: string;
  name: string;
  code: string;
  scope: "local" | "national";
  town_id: string | null;
  town_name: string | null;
  colors: ClanColors;
  captain_player_id: string | null;
  members: number;
};

export type ScoreboardPayload = {
  now: string;
  region_key: string;
  player: PlayerPayload | null;
  meets: MeetPayload[];
  /** Meets this player is named on. */
  my_meet_ids: string[];
  towns: TownOption[];
  clans: ClanOption[];
  boards: {
    tonight: BoardRow[];
    local_towns: BoardRow[];
    local_clans: BoardRow[];
    national_towns: BoardRow[];
    national_clans: BoardRow[];
    personal_best: BoardRow[];
  };
  personal_best_feet: number | null;
};
