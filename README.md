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

- Live board: `/` — boards, live meets, **Start a club**, **Challenge someone**
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

## How do I make a team / challenge someone?

Both live on the board at `/`, under the live meets.

**Start a club.** Name yourself (the field is in the card — swinging still never
asks), pick a name and two colors, and hit *Create club*. Leave the invite code
blank and the league mints one; send that code to whoever you want on your side
and they paste it into *Got a club code?*. One club at a time. Your first join is
free; every switch after that starts a 48-hour cooldown, and you cannot dodge it
by creating a new club instead.

**Challenge someone.** Pick club-vs-club or town-vs-town, choose who you are
calling out, set `local` or `national`, and pick a window (3h / 6h / tonight /
24h). Your own side is fixed — you post on behalf of a side you are on. The
ballpark is not a choice: the league assigns `neutral-v1`.

The meet lands on every open board with nine empty slots a side. Anyone on either
side hits *Put me on the card*; rosters cap at 15 names and the card scores the
top 9, so the empty slots stay visible as the invite.

Colors are paint. Nothing in scoring reads them — they cannot move a fence, an
exit velo, or the pitch clock.

## Difficulty

Home-run rate at `neutral-v1`, measured by Monte Carlo over the real
`qualityFrom`/`flight`/`makePark` lifted out of the prototype. The tap is modelled
as a Gaussian aim at the gold centre of the 1.60s sweep.

| tap sigma | 35ms | 50ms | 70ms | 95ms |
|---|---|---|---|---|
| before (slice 2a) | 94% | 89% | 81% | 72% |
| now | 77% | 63% | 50% | 39% |

Gold is still a no-doubt homer (100%, ~422ft). The band just outside it used to
be a flat 92-100 mph plateau 256ms wide, which cleared this park on its own;
contact now tapers across it, so a squared-up ball is usually off the wall.
`k` is still `0.00116` and `flight()` is untouched — this is contact quality, not
a physics nerf.

```bash
npm run verify        # all three checks
npm run verify:hr-rate  # just the difficulty regression
```

## Locked rules (this PR)

- First swing: no login. Optional display name after the first homer.
- Max 1 town + 1 clan. Leaving or switching clans sets a **48h** cooldown.
- `meets.level` is `local | national`.
- Scoring: best 1 swing / player, top 9, empty slots visible. Non-empty roster ⇒ listed players only.
- Dual-count: one swing may credit a live clan meet **and** a live town-vs-town meet. Town credit only exists inside an active town-vs-town meet.
- Sanctioned meets use `park_seed = neutral-v1`, assigned by `create_meet`, never by the caller.
- A display name is required to create a club, a town, or a meet. It is never required to swing.
- Roster listing is decided by membership, not by who listed first (see migration 20260917200000).
- Physics in the HTML prototype is unchanged (`k = 0.00116`).
- **Neutral park is forced in the play iframe.** `create_meet` still writes `park_seed = neutral-v1`. `/play` reads the live meet from `scoreboard_payload` (same row as the ticker) and loads `/foul-pole-league.html?park_seed=…`, then `postMessage`s `set_park` so the game rebuilds that seed before a swing. Club zip parks cannot replace it while the meet is live. `post_swing` credits a meet only when the reported `p_park_seed` already matches `meet.park_seed` — it no longer relabels zip-porch feet after the fact.

## QA: meet park

1. Create (or use) a **live** meet. Confirm `meets.park_seed` is `neutral-v1`.
2. Open `/play`. The chrome pill should read `park neutral-v1`. The iframe `src` includes `?park_seed=neutral-v1`. In the game top bar, Ballpark is **Neutral Park** (not the zip field).
3. Swing. The posted row’s `park_seed` is `neutral-v1`, and fence/feet used that seed’s geometry (`makePark('neutral-v1')`), not the player zip.
4. In club setup, change zip during the live meet — park stays Neutral Park.
5. After the meet is `final`, `/play` drops the query param and zip parks work again.

Apply `supabase/migrations/20260917190000_meet_park_seed_guard.sql` so zip-park postMessages cannot count for the meet. The iframe force is the physics fix even before that SQL is applied.

```bash
node scripts/verify-meet-park.mjs
```

That checks `k` is still `0.00116`, `/play` passes `park_seed` into the iframe, and zip fence geometry differs from `neutral-v1`.
