"use client";

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rpcMessage } from "@/lib/format";
import type { ClanOption, PlayerPayload, TournamentPayload } from "@/lib/types";

const SLOTS = [0, 1, 2, 3, 4, 5, 6, 7];

export default function CreateTournament({
  supabase,
  playerId,
  player,
  clans,
  tournaments,
  onDone,
}: {
  supabase: SupabaseClient;
  playerId: string;
  player: PlayerPayload | null | undefined;
  clans: ClanOption[];
  tournaments: TournamentPayload[];
  onDone: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [level, setLevel] = useState<"local" | "national">("local");
  const [ids, setIds] = useState<string[]>(() => Array(8).fill(""));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [posted, setPosted] = useState<string | null>(null);

  const named = Boolean(player?.display_name);
  const myClan = clans.find((c) => c.id === player?.clan_id) ?? null;
  const isCaptain = Boolean(myClan && player && myClan.captain_player_id === player.id);

  const busyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of tournaments) {
      if (t.status !== "scheduled" && t.status !== "live") continue;
      for (const e of t.entries) ids.add(e.clan_id);
    }
    return ids;
  }, [tournaments]);

  const pool = useMemo(() => {
    return clans.filter((c) => {
      if (level === "local") {
        if (!myClan?.town_id) return false;
        return c.town_id === myClan.town_id;
      }
      return true;
    });
  }, [clans, level, myClan?.town_id]);

  useEffect(() => {
    if (!myClan) return;
    setIds((prev) => {
      if (prev.includes(myClan.id)) return prev;
      const next = [...prev];
      next[0] = myClan.id;
      return next;
    });
  }, [myClan]);

  function pick(index: number, value: string) {
    setIds((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  const distinct = new Set(ids.filter(Boolean));
  const ready =
    named &&
    isCaptain &&
    myClan &&
    ids.includes(myClan.id) &&
    distinct.size === 8 &&
    !ids.some((id) => id && busyIds.has(id));

  async function post() {
    if (!myClan) return;
    setBusy(true);
    setErr(null);
    try {
      const { error } = await supabase.rpc("create_tournament", {
        p_player_id: playerId,
        p_name: name.trim(),
        p_level: level,
        p_clan_ids: ids,
        p_window_start: new Date().toISOString(),
        p_round_hours: 24,
      });
      if (error) {
        setErr(rpcMessage(error));
        return;
      }
      setPosted(`${name.trim() || "Bracket"} is on the board. Quarterfinals are live.`);
      setName("");
      setOpen(false);
      await onDone();
    } finally {
      setBusy(false);
    }
  }

  const blocked = !named
    ? "Name yourself in Start a club first. Swinging never needs a name."
    : !myClan
      ? "Captain a club before you post a bracket."
      : !isCaptain
        ? "Only a captain can post a bracket, and your club has to be one of the eight."
        : busyIds.has(myClan.id)
          ? "Your club is already in a bracket. Finish that one first."
          : level === "local" && !myClan.town_id
            ? "A local bracket is eight clubs from one town. Yours has no town — post national, or pick a town club."
            : null;

  return (
    <section className="card" id="start-bracket">
      <h2>Start a bracket</h2>
      <p className="sub">
        Eight clubs, three rounds, 24 hours each. Seeds come off the clan board.
        Same nine-slot meets, neutral park. Free — no entry fee and nothing to buy.
      </p>
      {posted ? <p className="ok">{posted}</p> : null}
      {open ? (
        <>
          <label htmlFor="br-name">Name</label>
          <input
            id="br-name"
            maxLength={40}
            value={name}
            placeholder="Harbor Bracket"
            onChange={(e) => setName(e.target.value)}
          />
          <label htmlFor="br-level">Level</label>
          <select
            id="br-level"
            value={level}
            onChange={(e) => {
              const next = e.target.value as "local" | "national";
              setLevel(next);
              setIds((prev) =>
                prev.map((id, i) => {
                  if (i === 0 && myClan) return myClan.id;
                  const clan = clans.find((c) => c.id === id);
                  if (!clan) return "";
                  if (next === "local" && clan.town_id !== myClan?.town_id) return "";
                  return id;
                })
              );
            }}
          >
            <option value="local">Local — eight clubs, one town</option>
            <option value="national">National — any eight clubs</option>
          </select>
          <p className="muted">
            Order here is not the seed. The {level} clan board ranks them, oldest club breaks a tie.
          </p>
          <div className="clan-picks">
            {SLOTS.map((i) => (
              <div key={i}>
                <label htmlFor={`br-clan-${i}`}>Club {i + 1}</label>
                <select
                  id={`br-clan-${i}`}
                  value={ids[i] ?? ""}
                  onChange={(e) => pick(i, e.target.value)}
                >
                  <option value="">Pick a club…</option>
                  {pool.map((c) => (
                    <option
                      key={c.id}
                      value={c.id}
                      disabled={
                        (busyIds.has(c.id) && ids[i] !== c.id) ||
                        (ids.includes(c.id) && ids[i] !== c.id)
                      }
                    >
                      {c.name} ({c.code})
                      {busyIds.has(c.id) ? " — in a bracket" : ""}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {pool.length < 8 ? (
            <p className="muted">
              {pool.length} club{pool.length === 1 ? "" : "s"} available. A bracket needs eight.
            </p>
          ) : null}
          {err ? <p className="err">{err}</p> : null}
          <div className="actions">
            <button className="primary" type="button" disabled={busy || !ready || !name.trim()} onClick={() => void post()}>
              {busy ? "Posting…" : "Post the bracket"}
            </button>
            <button className="ghost" type="button" disabled={busy} onClick={() => setOpen(false)}>
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
              disabled={Boolean(blocked)}
              onClick={() => {
                setOpen(true);
                setErr(null);
              }}
            >
              Create a bracket
            </button>
          </div>
        </>
      )}
    </section>
  );
}
