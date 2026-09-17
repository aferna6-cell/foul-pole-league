"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getPlayerId } from "@/lib/player";
import { getSupabaseBrowser, supabaseConfigured } from "@/lib/supabase";
import { deadlineCopy, formatFeet, needMoreCopy, rpcMessage } from "@/lib/format";
import type {
  BoardRow,
  ClanOption,
  MeetPayload,
  ScoreboardPayload,
  TownOption,
} from "@/lib/types";

function NineSlots({ rows }: { rows: MeetPayload["home"]["slot_rows"] }) {
  const slots = Array.from({ length: 9 }, (_, i) => rows[i] ?? null);
  return (
    <div className="slots" aria-label="Scoring slots">
      {slots.map((s, i) => (
        <div key={i} className={`slot ${s ? "filled" : ""}`} title={s?.display_name || "Empty slot"}>
          {s ? `${s.feet}` : "—"}
        </div>
      ))}
    </div>
  );
}

function Board({
  title,
  sub,
  rows,
  me,
}: {
  title: string;
  sub: string;
  rows: BoardRow[];
  me?: string | null;
}) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <p className="sub">{sub}</p>
      {rows.length === 0 ? (
        <p className="empty-note">Empty slots. First swing of the night goes here.</p>
      ) : (
        <table className="board-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th style={{ textAlign: "right" }}>Feet</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 12).map((r, i) => (
              <tr key={r.id} className={me && r.id === me ? "me" : undefined}>
                <td>{i + 1}</td>
                <td>{r.name}</td>
                <td className="n">{formatFeet(r.feet)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function MeetCard({ meet }: { meet: MeetPayload }) {
  return (
    <article className="card">
      <span className={`pill ${meet.status === "live" ? "gold" : ""}`}>{meet.status}</span>
      <span className="pill">{meet.level}</span>
      <span className="pill">{meet.kind === "clan_vs_clan" ? "clan meet" : "town vs town"}</span>
      <span className="pill">park {meet.park_seed}</span>
      <div className="ticker live" style={{ marginTop: 8 }}>
        {meet.ticker}
      </div>
      <div className="sides">
        <div>
          <div className="side-name">{meet.home.name}</div>
          <div className="side-ft">{formatFeet(meet.home.total_feet)} ft</div>
          <p className="muted">{meet.home.slots}/9 · {needMoreCopy(meet.home.slots, meet.window_end)}</p>
          <NineSlots rows={meet.home.slot_rows} />
        </div>
        <div>
          <div className="side-name">{meet.away.name}</div>
          <div className="side-ft">{formatFeet(meet.away.total_feet)} ft</div>
          <p className="muted">{meet.away.slots}/9 · {needMoreCopy(meet.away.slots, meet.window_end)}</p>
          <NineSlots rows={meet.away.slot_rows} />
        </div>
      </div>
      <p className="muted" style={{ marginTop: 12 }}>
        Window ends {deadlineCopy(meet.window_end)}. Series {meet.home_wins}–{meet.away_wins}.
      </p>
    </article>
  );
}

export default function HomePage() {
  const [data, setData] = useState<ScoreboardPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [townId, setTownId] = useState("");
  const [clanId, setClanId] = useState("");
  const [busy, setBusy] = useState(false);
  const configured = supabaseConfigured();

  const load = useCallback(async () => {
    if (!configured) return;
    const supabase = getSupabaseBrowser();
    const playerId = getPlayerId();
    const { data: payload, error } = await supabase.rpc("scoreboard_payload", {
      p_player_id: playerId,
      p_region_key: null,
    });
    if (error) {
      setErr(rpcMessage(error));
      return;
    }
    const next = payload as ScoreboardPayload;
    setData(next);
    setErr(null);
    if (next.player?.display_name) setName(next.player.display_name);
    if (next.player?.town_id) setTownId(next.player.town_id);
    if (next.player?.clan_id) setClanId(next.player.clan_id);
  }, [configured]);

  useEffect(() => {
    void load();
    if (!configured) return;
    const supabase = getSupabaseBrowser();
    const channel = supabase
      .channel("live-board")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "swings" }, () => {
        void load();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "meets" }, () => {
        void load();
      })
      .subscribe();
    const poll = window.setInterval(() => void load(), 4000);
    return () => {
      void supabase.removeChannel(channel);
      window.clearInterval(poll);
    };
  }, [configured, load]);

  const liveTicker = useMemo(() => {
    const live = data?.meets.find((m) => m.status === "live");
    return live?.ticker ?? "No live meet yet — take a swing.";
  }, [data]);

  async function run(
    label: string,
    fn: () => PromiseLike<{ error: { message?: string } | null }>
  ) {
    setBusy(true);
    setMsg(null);
    setErr(null);
    const { error } = await fn();
    setBusy(false);
    if (error) setErr(rpcMessage(error));
    else {
      setMsg(label);
      await load();
    }
  }

  if (!configured) {
    return (
      <main className="shell">
        <h1 className="title">Foul Pole<em>League</em></h1>
        <p className="tagline">
          Copy <code>.env.example</code> to <code>.env.local</code> and set{" "}
          <code>NEXT_PUBLIC_SUPABASE_URL</code> plus <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
          Never commit secrets or a service_role key.
        </p>
      </main>
    );
  }

  const player = data?.player;
  const towns: TownOption[] = data?.towns ?? [];
  const clans: ClanOption[] = data?.clans ?? [];
  const supabase = configured ? getSupabaseBrowser() : null;
  const playerId = typeof window !== "undefined" ? getPlayerId() : "";

  return (
    <>
      <header className="toprail">
        <div className="cell">
          <div className="k">Foul Pole League</div>
          <div className="v">Live board</div>
        </div>
        <div className="cell">
          <div className="k">Ticker</div>
          <div className="v sm">{liveTicker}</div>
        </div>
        <div className="cell toprail-swing">
          <Link className="btn primary" href="/play">
            Take a swing
          </Link>
        </div>
      </header>
      <main className="shell">
        <h1 className="title">
          Shared<em>scoreboard</em>
        </h1>
        <p className="tagline">
          First swing is free — no login. Empty slots are the invite. Posted balls show up on
          every open board in a few seconds.
        </p>

        <div className="grid meet-grid">
          {(data?.meets ?? []).map((m) => (
            <MeetCard key={m.id} meet={m} />
          ))}
        </div>

        <div className="boards">
          <Board
            title="Tonight"
            sub="Best meet-eligible ball since midnight Eastern."
            rows={data?.boards.tonight ?? []}
            me={player?.id}
          />
          <Board
            title="Local towns"
            sub={`Town-vs-town totals in ${data?.region_key ?? "this region"}.`}
            rows={data?.boards.local_towns ?? []}
            me={player?.town_id}
          />
          <Board
            title="Local clans"
            sub="Clan meets in this region. National membership is not a filter."
            rows={data?.boards.local_clans ?? []}
            me={player?.clan_id}
          />
          <Board
            title="National towns"
            sub="Every town, ranked."
            rows={data?.boards.national_towns ?? []}
            me={player?.town_id}
          />
          <Board
            title="National clans"
            sub="Every clan, ranked nationally."
            rows={data?.boards.national_clans ?? []}
            me={player?.clan_id}
          />
          <Board
            title="Personal best"
            sub={
              data?.personal_best_feet
                ? `Your best is ${formatFeet(data.personal_best_feet)} ft.`
                : "Secondary board — longest single swing."
            }
            rows={data?.boards.personal_best ?? []}
            me={player?.id}
          />
        </div>

        <section className="card clubhouse">
          <h2>Clubhouse</h2>
          <p className="sub">
            Optional. Display name after a homer is enough. One town and one clan. Switching clans
            starts a 48-hour cooldown.
          </p>
          <label htmlFor="nm">Display name</label>
          <input
            id="nm"
            maxLength={24}
            value={name}
            placeholder="Skip this until you go yard"
            onChange={(e) => setName(e.target.value)}
          />
          <div className="row">
            <div>
              <label htmlFor="town">Town</label>
              <select id="town" value={townId} onChange={(e) => setTownId(e.target.value)}>
                <option value="">Free agent town</option>
                {towns.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="clan">Clan</label>
              <select id="clan" value={clanId} onChange={(e) => setClanId(e.target.value)}>
                <option value="">No clan</option>
                {clans.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
            </div>
          </div>
          {player?.clan_cooldown_until && new Date(player.clan_cooldown_until) > new Date() ? (
            <p className="muted">Clan switch cooldown until {player.clan_cooldown_until}.</p>
          ) : null}
          <div className="actions">
            <button
              className="primary"
              disabled={busy || !supabase}
              onClick={() =>
                supabase &&
                run("Name saved.", () =>
                  supabase.rpc("set_display_name", { p_player_id: playerId, p_name: name })
                )
              }
            >
              Save name
            </button>
            <button
              disabled={busy || !supabase}
              onClick={() =>
                supabase &&
                run("Town set.", () =>
                  supabase.rpc("set_town", {
                    p_player_id: playerId,
                    p_town_id: townId || null,
                  })
                )
              }
            >
              Save town
            </button>
            <button
              disabled={busy || !supabase || !clanId}
              onClick={() =>
                supabase &&
                run("Clan joined.", () =>
                  supabase.rpc("join_clan", { p_player_id: playerId, p_clan_id: clanId })
                )
              }
            >
              Join clan
            </button>
            <button
              className="ghost"
              disabled={busy || !supabase}
              onClick={() =>
                supabase && run("Left clan.", () => supabase.rpc("leave_clan", { p_player_id: playerId }))
              }
            >
              Leave clan
            </button>
          </div>
          {err ? <p className="err">{err}</p> : null}
          {msg ? <p className="ok">{msg}</p> : null}
        </section>
      </main>
      <div className="swing-dock">
        <Link className="btn primary" href="/play">
          Take a swing
        </Link>
        <span className="hint">Tap when the bar hits gold. First swing is free — no login.</span>
      </div>
    </>
  );
}
