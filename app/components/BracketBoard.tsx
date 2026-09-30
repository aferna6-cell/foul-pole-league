"use client";

import { useState } from "react";
import ShareMeet from "./ShareMeet";
import type { MeetPayload, TournamentPayload } from "@/lib/types";

const ROUNDS: { round: number; label: string; title: string }[] = [
  { round: 1, label: "QF", title: "Quarterfinal" },
  { round: 2, label: "SF", title: "Semifinal" },
  { round: 3, label: "F", title: "Final" },
];

function seedOf(tournament: TournamentPayload, clanId: string): number | null {
  return tournament.entries.find((e) => e.clan_id === clanId)?.seed ?? null;
}

function TournamentCard({ tournament }: { tournament: TournamentPayload }) {
  return (
    <article className="bracket-card" data-tournament-id={tournament.id}>
      <div className="bracket-head">
        <h3>{tournament.name}</h3>
        <span className={`pill ${tournament.status === "live" ? "gold" : ""}`}>
          {tournament.status}
        </span>
        <span className="pill">{tournament.level}</span>
        <span className="pill">{tournament.round_hours}h rounds</span>
        {tournament.champion_name ? (
          <span className="pill gold">Champion {tournament.champion_name}</span>
        ) : null}
      </div>
      <div className="bracket-grid">
        {ROUNDS.map((col) => {
          const meets = tournament.meets
            .filter((m) => m.round === col.round)
            .slice()
            .sort((a, b) => (a.bracket_slot ?? 0) - (b.bracket_slot ?? 0));
          return (
            <div key={col.round} className="bracket-round">
              <div className="k">
                {col.label} · {col.title}
              </div>
              {meets.length === 0 ? (
                <p className="empty-note">Waiting on the previous round.</p>
              ) : (
                meets.map((meet) => <BracketMeet key={meet.id} tournament={tournament} meet={meet} />)
              )}
            </div>
          );
        })}
      </div>
    </article>
  );
}

function BracketMeet({
  tournament,
  meet,
}: {
  tournament: TournamentPayload;
  meet: MeetPayload;
}) {
  const homeSeed = seedOf(tournament, meet.home.id);
  const awaySeed = seedOf(tournament, meet.away.id);
  const canShare = meet.status === "live" || meet.status === "scheduled";
  return (
    <div className="bracket-meet" data-round={meet.round_label ?? ""} data-meet-id={meet.id}>
      <div className="ticker">{meet.ticker}</div>
      {homeSeed && awaySeed ? (
        <p className="muted">
          seeds {homeSeed} vs {awaySeed}
          {meet.park_seed ? ` · park ${meet.park_seed}` : ""}
        </p>
      ) : null}
      {canShare ? (
        <div className="actions">
          <ShareMeet meet={meet} />
          <a className="btn ghost" href={`#meet-${meet.id}`}>
            Card
          </a>
        </div>
      ) : (
        <p className="muted">{meet.status === "final" ? "Final" : meet.status}</p>
      )}
    </div>
  );
}

export default function BracketBoard({
  tournaments,
}: {
  tournaments: TournamentPayload[];
}) {
  const [tab, setTab] = useState<"local" | "national">("local");
  const rows = tournaments.filter((t) => t.level === tab);

  return (
    <section className="card" id="bracket">
      <h2>Brackets</h2>
      <p className="sub">
        Eight clubs, three rounds. Each round is a normal meet — top 9, neutral park.
        Local is one town. National is any eight. Free. No entry fee.
      </p>
      <div className="bracket-tabs" role="tablist" aria-label="Bracket level">
        {(["local", "national"] as const).map((level) => (
          <button
            key={level}
            type="button"
            role="tab"
            aria-selected={tab === level}
            aria-pressed={tab === level}
            onClick={() => setTab(level)}
          >
            {level === "local" ? "Local" : "National"}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="empty-note">
          No {tab} bracket yet. A captain posts eight clubs and the board seeds them.
        </p>
      ) : (
        rows.map((t) => <TournamentCard key={t.id} tournament={t} />)
      )}
    </section>
  );
}
