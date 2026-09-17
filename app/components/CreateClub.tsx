"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rpcMessage } from "@/lib/format";
import type { ClanOption, PlayerPayload, TownOption } from "@/lib/types";

/** Cosmetic only. These never reach scoring — see the migration comment. */
const SWATCHES = [
  "#1E4FA8", "#B4261F", "#0E7A4A", "#E0A21A", "#5B2D8E",
  "#0B7B8C", "#D1531B", "#243B53", "#96144A", "#2F6B1E",
];

function Swatches({
  label,
  value,
  onPick,
}: {
  label: string;
  value: string;
  onPick: (hex: string) => void;
}) {
  return (
    <>
      <label>{label}</label>
      <div className="swatch-row">
        {SWATCHES.map((hex) => (
          <button
            key={hex}
            type="button"
            className="swatch"
            aria-label={`${label} ${hex}`}
            aria-pressed={value === hex}
            style={{ background: hex }}
            onClick={() => onPick(hex)}
          />
        ))}
      </div>
    </>
  );
}

export default function CreateClub({
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
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [scope, setScope] = useState<"local" | "national">("national");
  const [townId, setTownId] = useState("");
  const [newTown, setNewTown] = useState("");
  const [primary, setPrimary] = useState(SWATCHES[0]);
  const [secondary, setSecondary] = useState("#E0A21A");
  const [joinCode, setJoinCode] = useState("");
  const [gateName, setGateName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<{ name: string; code: string } | null>(null);

  const myClan = clans.find((c) => c.id === player?.clan_id) ?? null;
  const named = Boolean(player?.display_name);
  const cooldownUntil = player?.clan_cooldown_until
    ? new Date(player.clan_cooldown_until)
    : null;
  const onCooldown = Boolean(cooldownUntil && cooldownUntil > new Date());

  async function createClub() {
    setBusy(true);
    setErr(null);
    try {
      let useTownId: string | null = townId || null;

      // A local club needs a town. Let someone name a new one inline rather
      // than sending them off to find a town-creation screen first.
      if (scope === "local" && !useTownId) {
        const townName = newTown.trim();
        if (!townName) {
          setErr("Pick a town, or type a new town name.");
          return;
        }
        const { data, error } = await supabase.rpc("create_town", {
          p_player_id: playerId,
          p_name: townName,
          p_region_key: player?.region_key || "ct-newhaven",
        });
        if (error) {
          setErr(rpcMessage(error));
          return;
        }
        useTownId = (data as { id: string }).id;
      }

      const { data, error } = await supabase.rpc("create_clan", {
        p_player_id: playerId,
        p_name: name,
        p_code: code.trim() || null,
        p_scope: scope,
        p_town_id: scope === "local" ? useTownId : null,
        p_colors: { primary, secondary },
      });
      if (error) {
        setErr(rpcMessage(error));
        return;
      }
      const clan = data as { name: string; code: string };
      setMade({ name: clan.name, code: clan.code });
      setName("");
      setCode("");
      setNewTown("");
      await onDone();
    } finally {
      setBusy(false);
    }
  }

  async function saveName() {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("set_display_name", {
      p_player_id: playerId,
      p_name: gateName,
    });
    setBusy(false);
    if (error) {
      setErr(rpcMessage(error));
      return;
    }
    await onDone();
  }

  async function joinByCode() {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("join_clan_by_code", {
      p_player_id: playerId,
      p_code: joinCode,
    });
    setBusy(false);
    if (error) {
      setErr(rpcMessage(error));
      return;
    }
    setJoinCode("");
    await onDone();
  }

  return (
    <section className="card">
      <h2>Start a club</h2>
      <p className="sub">
        A club is who you swing for. You get a code — send it to anyone you want on your
        side. One club at a time; switching starts a 48-hour cooldown.
      </p>

      {myClan ? (
        <div className="your-club">
          <div className="k">Your club</div>
          <div className="your-club-row">
            <span
              className="club-chip"
              style={{
                background: myClan.colors?.primary || "var(--panel)",
                borderColor: myClan.colors?.secondary || "var(--line)",
              }}
            />
            <div>
              <div className="side-name">{myClan.name}</div>
              <div className="muted">
                {myClan.members} {myClan.members === 1 ? "player" : "players"} ·{" "}
                {myClan.scope}
                {myClan.captain_player_id === playerId ? " · you are captain" : ""}
              </div>
            </div>
            <div className="club-code" title="Invite code">
              {myClan.code}
            </div>
          </div>
        </div>
      ) : null}

      {made ? (
        <p className="ok">
          {made.name} is live. Invite code <strong>{made.code}</strong> — send that to
          whoever you want on the card.
        </p>
      ) : null}

      {!named ? (
        <div className="name-gate">
          <p className="muted">
            Swinging never needs a name. Putting a club on the board does — it goes on the
            card next to your feet.
          </p>
          <label htmlFor="gate-name">Display name</label>
          <div className="row">
            <input
              id="gate-name"
              maxLength={24}
              value={gateName}
              placeholder="Anything but a legal name"
              onChange={(e) => setGateName(e.target.value)}
            />
            <button
              className="primary"
              disabled={busy || !gateName.trim()}
              onClick={saveName}
            >
              Save name
            </button>
          </div>
        </div>
      ) : null}

      {onCooldown ? (
        <p className="muted">
          Club switch cooldown until {cooldownUntil?.toLocaleString()}. You can still swing.
        </p>
      ) : null}

      {open ? (
        <>
          <label htmlFor="club-name">Club name</label>
          <input
            id="club-name"
            maxLength={40}
            value={name}
            placeholder="Oxford Navy"
            onChange={(e) => setName(e.target.value)}
          />

          <Swatches label="Primary color" value={primary} onPick={setPrimary} />
          <Swatches label="Trim color" value={secondary} onPick={setSecondary} />
          <p className="muted">
            Colors are paint. They do not touch exit velo, the fences, or the pitch clock.
          </p>

          <div className="row">
            <div>
              <label htmlFor="club-scope">Reach</label>
              <select
                id="club-scope"
                value={scope}
                onChange={(e) => setScope(e.target.value as "local" | "national")}
              >
                <option value="national">National</option>
                <option value="local">Local (tied to a town)</option>
              </select>
            </div>
            <div>
              <label htmlFor="club-code">Invite code</label>
              <input
                id="club-code"
                maxLength={8}
                value={code}
                placeholder="Leave blank, we'll make one"
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            </div>
          </div>

          {scope === "local" ? (
            <div className="row">
              <div>
                <label htmlFor="club-town">Town</label>
                <select
                  id="club-town"
                  value={townId}
                  onChange={(e) => setTownId(e.target.value)}
                >
                  <option value="">New town…</option>
                  {towns.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              {!townId ? (
                <div>
                  <label htmlFor="club-newtown">New town name</label>
                  <input
                    id="club-newtown"
                    maxLength={40}
                    value={newTown}
                    placeholder="Oxford"
                    onChange={(e) => setNewTown(e.target.value)}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {err ? <p className="err">{err}</p> : null}

          <div className="actions">
            <button
              className="primary"
              disabled={busy || !named || !name.trim()}
              onClick={createClub}
            >
              {busy ? "Working…" : "Create club"}
            </button>
            <button className="ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="actions">
          <button className="primary" disabled={!named} onClick={() => setOpen(true)}>
            {myClan ? "Start a different club" : "Create a club"}
          </button>
        </div>
      )}

      <label htmlFor="join-code">Got a club code?</label>
      <div className="row">
        <input
          id="join-code"
          maxLength={8}
          value={joinCode}
          placeholder="ABC12"
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
        />
        <button disabled={busy || !joinCode.trim()} onClick={joinByCode}>
          Join club
        </button>
      </div>
    </section>
  );
}
