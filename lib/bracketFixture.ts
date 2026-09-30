import type { MeetPayload, MeetSide, ScoreboardPayload, TournamentPayload } from "./types";

/**
 * Screenshot / preview data only. Not read from Supabase.
 * Live matchup is the §2 ticker example with a QF prefix:
 *   QF OBR Navy 1,240 ft (6/9) vs Cheshire Red 1,105 ft (4/9)
 * window_end 2026-10-01T01:00:00.000Z is 9:00 PM ET.
 */
export const FIXTURE_MEET_ID = "fixture-qf-obr-cheshire";

const WINDOW_END = "2026-10-01T01:00:00.000Z";
const WINDOW_START = "2026-09-30T17:00:00.000Z";

function slots(id: string, feet: number, n: number): MeetSide["slot_rows"] {
  if (n <= 0) return [];
  const each = Math.round(feet / n);
  return Array.from({ length: n }, (_, i) => ({
    player_id: `${id}-s${i + 1}`,
    display_name: null,
    feet: i === 0 ? feet - each * (n - 1) : each,
  }));
}

function side(id: string, name: string, feet: number, n: number): MeetSide {
  return {
    id,
    name,
    total_feet: feet,
    slots: n,
    listed: n,
    slot_rows: slots(id, feet, n),
  };
}

function meet(partial: {
  id: string;
  status: MeetPayload["status"];
  round: 1 | 2 | 3;
  slot: number;
  label: "QF" | "SF" | "F";
  home: MeetSide;
  away: MeetSide;
  tournamentId: string;
}): MeetPayload {
  const tag = `${partial.label} `;
  const ticker = `${tag}${partial.home.name} ${partial.home.total_feet.toLocaleString("en-US")} ft (${partial.home.slots}/9) vs ${partial.away.name} ${partial.away.total_feet.toLocaleString("en-US")} ft (${partial.away.slots}/9)`;
  return {
    id: partial.id,
    kind: "clan_vs_clan",
    level: partial.tournamentId.includes("national") ? "national" : "local",
    status: partial.status,
    park_seed: "neutral-v1",
    window_start: WINDOW_START,
    window_end: WINDOW_END,
    home_wins: partial.status === "final" && partial.home.total_feet >= partial.away.total_feet ? 1 : 0,
    away_wins: partial.status === "final" && partial.away.total_feet > partial.home.total_feet ? 1 : 0,
    home: partial.home,
    away: partial.away,
    roster_cap: 15,
    ticker,
    tournament_id: partial.tournamentId,
    round: partial.round,
    bracket_slot: partial.slot,
    round_label: partial.label,
  };
}

const LOCAL_ID = "fixture-local-harbor";
const NATIONAL_ID = "fixture-national-eight";

const clans = {
  obr: "fixture-clan-obr",
  harbor: "fixture-clan-harbor",
  elm: "fixture-clan-elm",
  cheshire: "fixture-clan-cheshire",
  mill: "fixture-clan-mill",
  oak: "fixture-clan-oak",
  river: "fixture-clan-river",
  wharf: "fixture-clan-wharf",
  la: "fixture-clan-la",
};

const qfLive = meet({
  id: FIXTURE_MEET_ID,
  status: "live",
  round: 1,
  slot: 1,
  label: "QF",
  tournamentId: LOCAL_ID,
  home: side(clans.obr, "OBR Navy", 1240, 6),
  away: side(clans.cheshire, "Cheshire Red", 1105, 4),
});

const localMeets: MeetPayload[] = [
  qfLive,
  meet({
    id: "fixture-qf-2",
    status: "final",
    round: 1,
    slot: 2,
    label: "QF",
    tournamentId: LOCAL_ID,
    home: side(clans.elm, "Elm Street", 980, 5),
    away: side(clans.mill, "Mill Town", 640, 3),
  }),
  meet({
    id: "fixture-qf-3",
    status: "final",
    round: 1,
    slot: 3,
    label: "QF",
    tournamentId: LOCAL_ID,
    home: side(clans.harbor, "Harbor Green", 1510, 8),
    away: side(clans.oak, "Oak Hill", 870, 4),
  }),
  meet({
    id: "fixture-qf-4",
    status: "final",
    round: 1,
    slot: 4,
    label: "QF",
    tournamentId: LOCAL_ID,
    home: side(clans.river, "River Bats", 1322, 7),
    away: side(clans.wharf, "Wharf Black", 990, 5),
  }),
];

const nationalFinal = meet({
  id: "fixture-national-final",
  status: "final",
  round: 3,
  slot: 1,
  label: "F",
  tournamentId: NATIONAL_ID,
  home: side(clans.obr, "OBR Navy", 2010, 9),
  away: side(clans.la, "LA Select", 1440, 7),
});

function entries(
  rows: { id: string; name: string }[]
): TournamentPayload["entries"] {
  return rows.map((row, i) => ({ clan_id: row.id, name: row.name, seed: i + 1 }));
}

const local: TournamentPayload = {
  id: LOCAL_ID,
  name: "Harbor Bracket",
  level: "local",
  kind: "clan_vs_clan",
  size: 8,
  status: "live",
  round_hours: 24,
  creator_player_id: "fixture-captain",
  champion_clan_id: null,
  champion_name: null,
  created_at: WINDOW_START,
  entries: entries([
    { id: clans.obr, name: "OBR Navy" },
    { id: clans.harbor, name: "Harbor Green" },
    { id: clans.river, name: "River Bats" },
    { id: clans.elm, name: "Elm Street" },
    { id: clans.mill, name: "Mill Town" },
    { id: clans.wharf, name: "Wharf Black" },
    { id: clans.oak, name: "Oak Hill" },
    { id: clans.cheshire, name: "Cheshire Red" },
  ]),
  meets: localMeets,
};

const national: TournamentPayload = {
  id: NATIONAL_ID,
  name: "National Eight",
  level: "national",
  kind: "clan_vs_clan",
  size: 8,
  status: "final",
  round_hours: 24,
  creator_player_id: "fixture-captain",
  champion_clan_id: clans.obr,
  champion_name: "OBR Navy",
  created_at: "2026-09-28T18:00:00.000Z",
  entries: entries([
    { id: clans.obr, name: "OBR Navy" },
    { id: clans.la, name: "LA Select" },
    { id: clans.harbor, name: "Harbor Green" },
    { id: clans.elm, name: "Elm Street" },
    { id: clans.mill, name: "Mill Town" },
    { id: clans.wharf, name: "Wharf Black" },
    { id: clans.oak, name: "Oak Hill" },
    { id: clans.river, name: "River Bats" },
  ]),
  meets: [nationalFinal],
};

/** The live QF card. /play?fixture=bracket puts this line on the ticker. */
export function fixtureLiveMeet(): MeetPayload {
  return qfLive;
}

export function bracketFixture(): ScoreboardPayload {
  return {
    now: "2026-09-30T18:00:00.000Z",
    region_key: "ct-newhaven",
    player: null,
    meets: [qfLive, ...localMeets.slice(1), nationalFinal],
    tournaments: [local, national],
    my_meet_ids: [],
    towns: [{ id: "fixture-town-oxford", name: "Oxford", region_key: "ct-newhaven" }],
    clans: [],
    boards: {
      tonight: [],
      local_towns: [],
      local_clans: [
        { id: clans.obr, name: "OBR Navy", feet: 3250, titles: 1 },
        { id: clans.harbor, name: "Harbor Green", feet: 1510, titles: 0 },
        { id: clans.cheshire, name: "Cheshire Red", feet: 1105, titles: 0 },
      ],
      national_towns: [],
      national_clans: [
        { id: clans.obr, name: "OBR Navy", feet: 5260, titles: 1 },
        { id: clans.la, name: "LA Select", feet: 1440, titles: 0 },
      ],
      personal_best: [],
    },
    personal_best_feet: null,
  };
}
