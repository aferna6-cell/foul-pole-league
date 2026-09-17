"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getPlayerId } from "@/lib/player";
import { getSupabaseBrowser, supabaseConfigured } from "@/lib/supabase";
import { rpcMessage } from "@/lib/format";
import type { ScoreboardPayload } from "@/lib/types";

type SwingMsg = {
  source?: string;
  type?: string;
  feet?: number;
  is_homer?: boolean;
  foul?: boolean;
  park_seed?: string;
};

export default function PlayPage() {
  const configured = supabaseConfigured();
  const [ticker, setTicker] = useState("Take a swing — no login.");
  const [promptHomer, setPromptHomer] = useState(false);
  const [name, setName] = useState("");
  const [hasName, setHasName] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!configured) return;
    const supabase = getSupabaseBrowser();
    const { data, error } = await supabase.rpc("scoreboard_payload", {
      p_player_id: getPlayerId(),
      p_region_key: null,
    });
    if (error) {
      setErr(rpcMessage(error));
      return;
    }
    const payload = data as ScoreboardPayload;
    const live = payload.meets.find((m) => m.status === "live");
    if (live) setTicker(live.ticker);
    if (payload.player?.display_name) {
      setHasName(true);
      setName(payload.player.display_name);
    }
  }, [configured]);

  useEffect(() => {
    void load();
    if (!configured) return;
    const supabase = getSupabaseBrowser();
    const channel = supabase
      .channel("play-board")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "swings" }, () => {
        void load();
      })
      .subscribe();
    const poll = window.setInterval(() => void load(), 4000);
    return () => {
      void supabase.removeChannel(channel);
      window.clearInterval(poll);
    };
  }, [configured, load]);

  useEffect(() => {
    async function onMsg(ev: MessageEvent<SwingMsg>) {
      if (ev.origin !== window.location.origin) return;
      if (ev.data?.source !== "foul-pole-league" || ev.data.type !== "swing") return;
      if (!configured) return;
      const feet = Number(ev.data.feet || 0);
      if (!Number.isFinite(feet) || feet < 0) return;
      const supabase = getSupabaseBrowser();
      const { error } = await supabase.rpc("post_swing", {
        p_player_id: getPlayerId(),
        p_feet: Math.round(feet),
        p_is_homer: !!ev.data.is_homer,
        p_park_seed: ev.data.park_seed || "neutral-v1",
      });
      if (error) {
        setErr(rpcMessage(error));
        return;
      }
      if (ev.data.is_homer && !hasName) setPromptHomer(true);
      await load();
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [configured, hasName, load]);

  const iframeSrc = useMemo(() => "/foul-pole-league.html", []);

  return (
    <>
      <div className="play-top">
        <Link href="/" className="btn ghost" style={{ width: "auto", padding: "8px 10px" }}>
          Board
        </Link>
        <div className="ticker live">{ticker}</div>
      </div>
      <iframe className="play-frame" title="Foul Pole League" src={iframeSrc} allow="autoplay" />
      {promptHomer ? (
        <div className="modal-scrim">
          <div className="modal">
            <h2 className="scorefont" style={{ fontSize: 32, margin: "0 0 8px" }}>
              Gone.
            </h2>
            <p className="sub">Optional name for the live board. Skip it and stay anonymous.</p>
            <label htmlFor="homer-name">Display name</label>
            <input
              id="homer-name"
              maxLength={24}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Anything but a legal name"
            />
            {err ? <p className="err">{err}</p> : null}
            <div className="actions">
              <button
                className="primary"
                onClick={async () => {
                  const supabase = getSupabaseBrowser();
                  const { error } = await supabase.rpc("set_display_name", {
                    p_player_id: getPlayerId(),
                    p_name: name,
                  });
                  if (error) setErr(rpcMessage(error));
                  else {
                    setHasName(true);
                    setPromptHomer(false);
                  }
                }}
              >
                Put it on the board
              </button>
              <button className="ghost" onClick={() => setPromptHomer(false)}>
                Skip
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
