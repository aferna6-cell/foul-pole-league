"use client";

import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rpcMessage } from "@/lib/format";
import { WINDOW_CHOICES, windowFor, type WindowChoice } from "@/lib/meetWindow";
import type { ClanOption, PlayerPayload, TownOption } from "@/lib/types";

type Kind = "clan_vs_clan" | "town_vs_town";

export default function CreateChallenge({
  supabase,
  playerId,
  player,
  towns,
  clans,
  onDone,
}: {
  supabase: SupabaseClient;
  playerId: string;
  player: PlayerPayload | null | undefined;
  towns: TownOption[];
  clans: ClanOption[];
  onDone: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("clan_vs_clan");
  const [awayId, setAwayId] = useState("");
  const [level, setLevel] = useState<"local" | "national">("local");
  const [win, setWin] = useState<WindowChoice>("tonight");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [posted, setPosted] = useState<string | null>(null);

  const named = Boolean(player?.display_name);
  const myClan = clans.find((c) => c.id === player?.clan_id) ?? null;
  const myTown = towns.find((t) => t.id === player?.town_id) ?? null;

  // You post a challenge on behalf of a side you are actually on.
  const home = kind === "clan_vs_clan" ? myClan : myTown;
  const opponents = useMemo(
    () =>
      kind === "clan_vs_clan"
        ? clans.filter((c) => c.id !== myClan?.id).map((c) => ({ id: c.id, name: `${c.name} (${c.code})` }))
        : towns.filter((t) => t.id !== myTown?.id).map((t) => ({ id: t.id, name: t.name })),
    [kind, clans, towns, myClan?.id, myTown?.id]
  );

  async function post() {
    setBusy(true);
    setErr(null);
    try {
      if (!home) {
        setErr(
          kind === "clan_vs_clan"
            ? "Join or start a club first — a challenge is posted by one of its members."
            : "Pick your town in the clubhouse first."
        );
        return;
      }
      const [start, end] = windowFor(win);
      const { error } = await supabase.rpc("create_meet", {
        p_player_id: playerId,
        p_kind: kind,
        p_level: level,
        p_home_side_id: home.id,
        p_away_side_id: awayId,
        p_window_start: start.toISOString(),
        p_window_end: end.toISOString(),
      });
      if (error) {
        setErr(rpcMessage(error));
        return;
      }
      const away = opponents.find((o) => o.id === awayId);
      setPosted(`${home.name} vs ${away?.name ?? "them"} is on the board.`);
      setAwayId("");
      await onDone();
    } finally {
      setBusy(false);
    }
  }

  const blocked =
    !named
      ? "Name yourself in Start a club first. Swinging never needs a name; posting a meet does."
      : kind === "clan_vs_clan" && !myClan
        ? "Join or start a club first."
        : kind === "town_vs_town" && !myTown
          ? "Pick your town in the clubhouse first."
          : null;

  return (
    <section className="card" id="challenge">
      <h2>Challenge someone</h2>
      <p className="sub">
        Pick who you want, set how long the window stays open, and the meet goes on the
        board with nine empty slots per side. Anyone on either side can fill one.
      </p>

      {posted ? <p className="ok">{posted}</p> : null}

      {open ? (
        <>
          <div className="row">
            <div>
              <label htmlFor="ch-kind">Kind</label>
              <select
                id="ch-kind"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as Kind);
                  setAwayId("");
                }}
              >
                <option value="clan_vs_clan">Club vs club</option>
                <option value="town_vs_town">Town vs town</option>
              </select>
            </div>
            <div>
              <label htmlFor="ch-level">Level</label>
              <select
                id="ch-level"
                value={level}
                onChange={(e) => setLevel(e.target.value as "local" | "national")}
              >
                <option value="local">Local</option>
                <option value="national">National</option>
              </select>
            </div>
          </div>

          <label>Your side</label>
          <input readOnly value={home?.name ?? "—"} aria-label="Home side" />

          <label htmlFor="ch-away">Opponent</label>
          <select id="ch-away" value={awayId} onChange={(e) => setAwayId(e.target.value)}>
            <option value="">Pick who you are calling out…</option>
            {opponents.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          {opponents.length === 0 ? (
            <p className="muted">
              Nobody else to call out yet. Send your club code to a friend and they will
              show up here.
            </p>
          ) : null}

          <label htmlFor="ch-window">Window</label>
          <select
            id="ch-window"
            value={win}
            onChange={(e) => setWin(e.target.value as WindowChoice)}
          >
            {WINDOW_CHOICES.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>

          <label>Ballpark</label>
          <input readOnly value="Neutral Park — assigned by the league" aria-label="Ballpark" />
          <p className="muted">
            Sanctioned meets are always played on the neutral park, so nobody scores on a
            short porch at home. Rosters cap at 15 names a side; the card scores the top 9.
          </p>

          {err ? <p className="err">{err}</p> : null}

          <div className="actions">
            <button
              className="primary"
              disabled={busy || !named || !home || !awayId}
              onClick={post}
            >
              {busy ? "Posting…" : "Post the challenge"}
            </button>
            <button className="ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          {blocked ? <p className="muted">{blocked}</p> : null}
          <div className="actions">
            <button
              className="primary"
              type="button"
              onClick={() => {
                setOpen(true);
                setErr(null);
              }}
            >
              Create a challenge
            </button>
          </div>
        </>
      )}
    </section>
  );
}
