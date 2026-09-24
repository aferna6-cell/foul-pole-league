"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ShareMeet from "@/app/components/ShareMeet";
import { getPlayerId } from "@/lib/player";
import { getSupabaseBrowser, supabaseConfigured } from "@/lib/supabase";
import { rpcMessage } from "@/lib/format";
import { gameIframeSrc } from "@/lib/meetPark";
import type { MeetPayload, ScoreboardPayload } from "@/lib/types";

type SwingMsg = {
  source?: string;
  type?: string;
  feet?: number;
  is_homer?: boolean;
  foul?: boolean;
  park_seed?: string;
};

function pickMeet(meets: MeetPayload[], meetId: string | null): MeetPayload | undefined {
  if (meetId) {
    const hit = meets.find((m) => m.id === meetId);
    if (hit) return hit;
  }
  return meets.find((m) => m.status === "live");
}

function PlayPage() {
  const configured = supabaseConfigured();
  const searchParams = useSearchParams();
  const deepMeetId = searchParams.get("meet");
  const [ticker, setTicker] = useState("Take a swing — no login.");
  const [activeMeet, setActiveMeet] = useState<MeetPayload | null>(null);
  const [meetParkSeed, setMeetParkSeed] = useState<string | null>(null);
  const [boardReady, setBoardReady] = useState(!configured);
  const [promptHomer, setPromptHomer] = useState(false);
  const [name, setName] = useState("");
  const [hasName, setHasName] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const load = useCallback(async () => {
    if (!configured) return;
    const supabase = getSupabaseBrowser();
    const { data, error } = await supabase.rpc("scoreboard_payload", {
      p_player_id: getPlayerId(),
      p_region_key: null,
    });
    if (error) {
      setErr(rpcMessage(error));
      setBoardReady(true);
      return;
    }
    const payload = data as ScoreboardPayload;
    const meet = pickMeet(payload.meets, deepMeetId);
    if (meet) {
      setTicker(meet.ticker);
      setActiveMeet(meet);
      // Only force neutral park while the selected meet is live.
      setMeetParkSeed(meet.status === "live" ? meet.park_seed?.trim() || null : null);
    } else {
      setTicker("Take a swing — no login.");
      setActiveMeet(null);
      setMeetParkSeed(null);
    }
    setBoardReady(true);
    if (payload.player?.display_name) {
      setHasName(true);
      setName(payload.player.display_name);
    }
  }, [configured, deepMeetId]);

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

  const iframeSrc = useMemo(() => gameIframeSrc(meetParkSeed), [meetParkSeed]);

  const pushParkToFrame = useCallback(() => {
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      meetParkSeed
        ? { source: "foul-pole-league-host", type: "set_park", park_seed: meetParkSeed }
        : { source: "foul-pole-league-host", type: "clear_park" },
      window.location.origin
    );
  }, [meetParkSeed]);

  useEffect(() => {
    if (!boardReady) return;
    pushParkToFrame();
  }, [boardReady, meetParkSeed, pushParkToFrame]);

  return (
    <>
      <div className="play-top">
        <Link href="/" className="btn ghost" style={{ width: "auto", padding: "8px 10px" }}>
          Board
        </Link>
        <div className="ticker live">{ticker}</div>
        {activeMeet && activeMeet.status === "live" ? (
          <ShareMeet meet={activeMeet} compact />
        ) : null}
        {boardReady && meetParkSeed ? (
          <span className="pill gold" title="Live meet forces this park for scoring swings">
            park {meetParkSeed}
          </span>
        ) : boardReady ? (
          <span className="pill">zip park</span>
        ) : null}
      </div>
      {boardReady ? (
        <iframe
          ref={frameRef}
          className="play-frame"
          title="Foul Pole League"
          src={iframeSrc}
          allow="autoplay"
          onLoad={pushParkToFrame}
        />
      ) : (
        <div className="play-frame" aria-hidden="true" />
      )}
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


export default function PlayPageGate() {
  return (
    <Suspense fallback={<div className="play-top"><div className="ticker">Loading…</div></div>}>
      <PlayPage />
    </Suspense>
  );
}
