export type MeetSide = {
  id: string;
  name: string;
  total_feet: number;
  slots: number;
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
export type ClanOption = {
  id: string;
  name: string;
  code: string;
  scope: "local" | "national";
  town_id: string | null;
  town_name: string | null;
};

export type ScoreboardPayload = {
  now: string;
  region_key: string;
  player: PlayerPayload | null;
  meets: MeetPayload[];
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
