# Foul Pole League

Browser home-run derby with a **shared live scoreboard**. Open a link, swing, watch the board update on every other client.

Cosmetics, ads, Elo, brackets, and Stripe are out of this slice.

## Play

```bash
cp .env.example .env.local
# set NEXT_PUBLIC_SUPABASE_ANON_KEY from the Supabase project (anon / publishable)
npm install
npm run dev
```

- Live board: `/`
- Play (no login): `/play`
- Prototype file (physics unchanged): [`public/foul-pole-league.html`](public/foul-pole-league.html)

## Env

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://cchcuhksccbeccendewt.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project **anon** or **publishable** key |

Never commit `.env.local`. Never put `service_role` in any `NEXT_PUBLIC_*` variable — that key bypasses RLS and would ship to the browser.

Project ref: `cchcuhksccbeccendewt`.

## Database

Apply the slice-1 migration (tables, RLS, scoring RPCs, seed meets):

```bash
# from the Supabase SQL editor, or:
supabase db push
# file: supabase/migrations/20260917183000_init_live_scoreboard.sql
```

Writes go through RPCs (`post_swing`, `join_clan`, `scoreboard_payload`, …). Direct table inserts from the anon key are denied by RLS. Realtime is enabled on `swings` so a posted ball lands on other open boards in a few seconds (4s poll as fallback).

Anon `SECURITY DEFINER` RPCs are intentional: first swing has no login, so the browser uses the publishable key only. Logic lives in `private.*`; table writes are not granted to `anon`.

This migration is already applied to project `cchcuhksccbeccendewt`. A fresh project can run the SQL file as-is.

## Locked rules (this PR)

- First swing: no login. Optional display name after the first homer.
- Max 1 town + 1 clan. Leaving or switching clans sets a **48h** cooldown.
- `meets.level` is `local | national`.
- Scoring: best 1 swing / player, top 9, empty slots visible. Non-empty roster ⇒ listed players only.
- Dual-count: one swing may credit a live clan meet **and** a live town-vs-town meet. Town credit only exists inside an active town-vs-town meet.
- Sanctioned meets use `park_seed = neutral-v1`.
- Physics in the HTML prototype is unchanged (`k = 0.00116`).
