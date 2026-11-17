# Build contract

Every agent working in this repo follows this file. Do not change it. If something here is wrong or missing, say so in your report instead of improvising across another owner's files.

Product: a public bracket tournament (first run: Charlotte pizza). People nominate places by Instagram handle and upvote them, the top N by upvotes are seeded, then head to head swipe voting runs round by round. After each vote, a card invites the voter to follow the brand Instagram (lib/config.ts `brand.igUrl`). Mobile first. Most visitors arrive inside Instagram's in-app browser.

Stack: Next.js 16 App Router, TypeScript, Tailwind, Postgres (Supabase in production via DATABASE_URL), `postgres` driver in production, PGlite in tests, zod for input validation, vitest.

## Ground rules

* The browser never talks to the database. All reads and writes go through route handlers that call `lib/services/*`.
* Route handlers are thin: parse with zod, call a service, return JSON. Logic lives in services so it can be tested with PGlite.
* All SQL uses `$1` style parameters through the `Db` interface. No string interpolation of user input.
* IG handles are normalized everywhere with `normalizeHandle` from `lib/handles.ts`: trim, strip leading `@`, strip a pasted instagram.com URL down to the handle, lowercase, must match `^[a-z0-9._]{1,30}$`.
* No restaurant logos or scraped images. Names and handles only.
* Do not add dependencies without need. Do not touch files you do not own.
* Before reporting done: `npm run typecheck`, `npm test`, and `npm run build` must pass.

## Database layer (owner: database task)

`lib/db/index.ts`

```ts
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}
export function getDb(): Db;            // production: postgres driver on DATABASE_URL (prepare: false, small pool)
export function setDbForTests(db: Db | null): void;
```

`tests/helpers/db.ts` exports `createTestDb(): Promise<Db>` that returns a fresh PGlite backed Db with all migrations applied, and calls `setDbForTests`.

Migrations are plain SQL files in `db/migrations/NNNN_name.sql`, applied in order. `scripts/migrate.ts` applies them to DATABASE_URL and records them in a `schema_migrations` table.

### Schema (snake_case columns, uuid primary keys with gen_random_uuid(), timestamptz)

* **tournaments**: id, slug (unique), name, category, status (`draft` | `nominations` | `bracket` | `complete`), field_size int default 64, round_days int default 3, nominations_open_at, nominations_close_at, created_at
* **entrants**: id, tournament_id, ig_handle, display_name, status (`pending` | `approved` | `rejected` | `withdrawn`), upvote_count int default 0, first_nominated_at, seed int null, region int null (1 to 4). Unique (tournament_id, ig_handle).
* **voters**: id, cookie_id (unique), fingerprint_hash null, ip_hash null, first_seen_at, flagged bool default false, email null
* **upvotes**: id, entrant_id, voter_id, ip_hash, created_at. Unique (entrant_id, voter_id).
* **rounds**: id, tournament_id, number int (1 = first round), name, opens_at, closes_at, status (`scheduled` | `open` | `closed`). Unique (tournament_id, number).
* **matchups**: id, round_id, slot int (0 based position in the round, top to bottom), region int null, entrant_a_id null, entrant_b_id null, votes_a int default 0, votes_b int default 0, winner_id null, decided_by null (`votes` | `seed_tiebreak` | `admin_override` | `withdrawal`). Unique (round_id, slot). The winner of slot s in round r goes to slot floor(s/2) in round r+1, as entrant a when s is even and entrant b when s is odd.
* **votes**: id, matchup_id, voter_id, choice (`a` | `b`), ip_hash, excluded bool default false, created_at. Unique (matchup_id, voter_id).
* **audit_log**: id, actor, action, details jsonb, created_at

Security: the migration enables row level security on every table with no policies, so the Supabase anon key can read and write nothing. The app connects with the database connection string, which bypasses it.

## Shared helpers

* `lib/handles.ts` (owner: database task): `normalizeHandle(input: string): string | null`
* `lib/voter.ts` (owner: voting task): `resolveVoter(req: Request): Promise<{ voterId: string; ipHash: string; setCookie?: string }>`. Cookie name `v`, value is `cookieId.signature` using HMAC SHA256 with COOKIE_SECRET, httpOnly, SameSite=Lax, Secure in production, 1 year. Optional request header `x-fp` carries a client computed fingerprint string; store its hash on the voter and, when a request has no valid cookie but its fingerprint hash matches exactly one existing voter seen in the last 30 days, reuse that voter. IP comes from the first entry of `x-forwarded-for`, stored only as HMAC SHA256 with IP_HASH_SALT. Also exports `jsonWithVoter(body, init, voter)` that attaches the Set-Cookie header.
* `lib/client/api.ts` (owner: public UI task): browser fetch wrapper that computes the fingerprint once (user agent, language, timezone, screen size, hashed) and sends `x-fp` on every call.

## Services

`lib/services/nominations.ts` (owner: voting task)
* `listEntrants(slug, voterId)` approved entrants sorted by upvote_count desc then first_nominated_at asc
* `nominate({ slug, handle, displayName, voterId, ipHash })`
* `upvote({ entrantId, voterId, ipHash })`

`lib/services/voting.ts` (owner: voting task)
* `nextMatchup(slug, voterId)`
* `castVote({ matchupId, choice, voterId, ipHash })`

`lib/services/bracket.ts` (owner: bracket task)
* `seedPositions(n)`: pure. Standard bracket order for n = 16, 32, 64, so seed 1 meets seed n, and seeds 1 to 4 fall in four different quarters.
* `lockSeedingAndStart(tournamentId, now)`: picks the field, assigns seed and region, creates all rounds and matchups, opens round 1, sets status `bracket`.
* `advanceDueRounds(now)`: closes every open round whose closes_at has passed, decides winners, fills the next round, opens it, or marks the tournament complete. Safe to call repeatedly and concurrently.
* `getTournamentState(slug)` and `getBracket(slug)`

`lib/services/admin.ts` (owner: admin task): approve, reject, withdraw, rename, merge entrants; create and edit tournaments; open nominations; trigger lockSeedingAndStart; reschedule a round; override a result; list and exclude flagged votes. Every action writes audit_log.

### Rules the services must enforce

Nominations
* Only while tournament status is `nominations` and now is before nominations_close_at (if set).
* New handle: create entrant with status `pending`, upvote_count 1, and record the nominator's upvote. Pending entrants are not public.
* Existing approved or pending handle: treat as an upvote. Rejected or withdrawn handle: return `rejected`, change nothing.
* One upvote per entrant per voter (database unique constraint is the source of truth). upvote_count is updated in the same transaction.
* Rate limits: at most 5 new nominations per voter per day, at most 40 upvotes per entrant per ip_hash per hour. Over the limit returns a `rate_limited` result, which the route maps to HTTP 429.

Voting
* Only on matchups in an `open` round whose closes_at is in the future, with both entrants present.
* One vote per matchup per voter, enforced by the unique constraint. A repeat returns `already: true` and changes nothing.
* votes_a or votes_b is incremented in the same transaction as the insert.
* Rate limit: at most 30 votes per matchup per ip_hash per hour. Over the limit returns `rate_limited`. Never hard block an IP otherwise.
* `nextMatchup` returns an open matchup the voter has not voted on, in random order, plus how many remain.

Seeding and advancement
* Field: approved entrants ordered by upvote_count desc, then first_nominated_at asc. Field size is the largest of 64, 32, 16 that is at most both tournament.field_size and the approved count. Fewer than 16 approved: throw a clear error. No byes.
* Regions: split the bracket into four equal quarters, region 1 to 4 top to bottom. Matchups carry a region until the semifinals, then null.
* Round names by matchups in the round: 32 "Round of 64", 16 "Round of 32", 8 "Sweet 16", 4 "Elite 8", 2 "Final Four", 1 "Championship".
* Round r opens when round r minus 1 closes and lasts tournament.round_days days.
* Deciding a matchup: count from the votes table where excluded is false (not the cached counters), then write the counters. More votes wins, `decided_by = votes`. Tie: the better (lower) seed wins, `seed_tiebreak`. If one entrant is withdrawn, the other wins, `withdrawal`. An existing `admin_override` winner is never changed.
* Closing uses a row lock or status compare and set so two concurrent calls cannot double advance.

## HTTP API (JSON)

Public routes. All of them call `resolveVoter` and return the cookie when new.

* `GET /api/t/[slug]` (owner: bracket task). Calls `advanceDueRounds(now)` first, so the site advances itself even when the scheduled job is late. Returns `{ tournament: { slug, name, category, status, fieldSize, nominationsCloseAt }, currentRound: { id, number, name, closesAt } | null, champion: Entrant | null }`
* `GET /api/t/[slug]/bracket` (owner: bracket task). Returns `{ rounds: [{ number, name, status, opensAt, closesAt, matchups: [{ id, slot, region, a: Entrant | null, b: Entrant | null, votesA, votesB, winnerId }] }] }`. votesA and votesB are null while the round is open.
* `GET /api/cron/advance` (owner: bracket task). Requires `Authorization: Bearer ${CRON_SECRET}`. Calls `advanceDueRounds`. Add `vercel.json` with a daily cron for it.
* `GET /api/t/[slug]/entrants` (owner: voting task). Returns `{ entrants: [{ id, igHandle, displayName, upvoteCount, upvotedByMe }] }`
* `POST /api/nominate` body `{ slug, handle, displayName? }` (owner: voting task). Returns `{ result: "created_pending" | "upvoted" | "already_upvoted" | "rejected" | "closed" | "invalid_handle", entrantId? }`
* `POST /api/upvote` body `{ entrantId }` (owner: voting task). Returns `{ ok: true, already: boolean, upvoteCount: number }`
* `GET /api/t/[slug]/next` (owner: voting task). Returns `{ matchup: { id, roundName, closesAt, a: Entrant, b: Entrant } | null, remaining: number }`
* `POST /api/vote` body `{ matchupId, choice: "a" | "b" }` (owner: voting task). Returns `{ ok: true, already: boolean, votesA: number, votesB: number }`

`Entrant` in responses is `{ id, igHandle, displayName, seed }`.

Errors: `{ error: string }` with 400 (bad input), 404, 409 (closed), 429 (rate limited).

Admin routes live under `/api/admin/*` (owner: admin task). `POST /api/admin/login` body `{ password }` compares against ADMIN_PASSWORD in constant time and sets a signed httpOnly cookie `adm` (HMAC with COOKIE_SECRET, 12 hours). `lib/admin-auth.ts` exports `requireAdmin(req)`. Every other admin route and the `/admin` pages require it.

## File ownership

* Database task: `db/migrations/*`, `lib/db/*`, `lib/handles.ts`, `scripts/migrate.ts`, `scripts/seed-demo.ts`, `tests/helpers/*`, `tests/db.test.ts`
* Voting task: `lib/voter.ts`, `lib/services/nominations.ts`, `lib/services/voting.ts`, `lib/ratelimit.ts`, `app/api/nominate`, `app/api/upvote`, `app/api/vote`, `app/api/t/[slug]/entrants`, `app/api/t/[slug]/next`, `tests/voting*.test.ts`, `tests/nominations*.test.ts`
* Bracket task: `lib/services/bracket.ts`, `app/api/t/[slug]/route.ts`, `app/api/t/[slug]/bracket`, `app/api/cron`, `vercel.json`, `tests/bracket*.test.ts`
* Public UI task: `app/page.tsx`, `app/layout.tsx`, `app/globals.css`, `app/t/**`, `components/**` except `components/admin/**`, `lib/client/**`
* Admin task: `lib/admin-auth.ts`, `lib/services/admin.ts`, `app/api/admin/**`, `app/admin/**`, `components/admin/**`, `tests/admin*.test.ts`

## Public pages (owner: public UI task)

* `/` redirects to the newest tournament that is not a draft, at `/t/[slug]`.
* `/t/[slug]` shows the right thing for the phase: nominations call to action, vote call to action with time left in the round, or the champion.
* `/t/[slug]/nominate` search the list, upvote, add a handle.
* `/t/[slug]/vote` the swipe screen.
* `/t/[slug]/bracket` the bracket.
* Footer on every page: "{brand.name}, presented by {brand.presentedBy}" and a link to the brand Instagram.

---

# Addendum A: staggered schedule (supersedes anything above that conflicts)

Matchups no longer open and close with their whole round. Like the NCAA tournament, games are spread across days. Each matchup has its own window. Rounds remain as a grouping for names and bracket columns.

## Schema (new migration `0002_staggered.sql`)

* `matchups`: add `opens_at timestamptz`, `closes_at timestamptz`, `status text not null default 'scheduled'` checked in (`scheduled`, `open`, `closed`). Index on (status, closes_at) and (status, opens_at).
* `tournaments`: add `bracket_starts_at timestamptz null`.
* `rounds.status`, `rounds.opens_at`, `rounds.closes_at` are kept but derived: opens_at = earliest matchup opens_at, closes_at = latest matchup closes_at, status = `closed` when every matchup is closed, `open` when at least one matchup is open or closed but not all are closed, else `scheduled`. Update them whenever matchups change state.

## Schedule template

`lib/services/schedule.ts` (owner: backend task), pure and unit tested:

`buildSchedule(fieldSize, startAt): Array<{ roundNumber, slot, opensAt, closesAt }>`

Day offsets are whole days from `startAt`. A normal window is 24 hours.

Field of 64
* Round of 64: region 1 on day 0, region 2 on day 1, region 3 on day 2, region 4 on day 3
* Round of 32: regions 1 and 2 on day 4, regions 3 and 4 on day 5
* Sweet 16: regions 1 and 2 on day 6, regions 3 and 4 on day 7
* Elite 8: all four on day 8
* Final Four: both open day 9, 48 hour window (closes day 11)
* Championship: opens day 12, 48 hour window (closes day 14)

Field of 32: same shape starting from the Round of 32 at day 0 (Round of 32 days 0 and 1, Sweet 16 days 2 and 3, Elite 8 day 4, Final Four opens day 5 for 48 hours, Championship opens day 8 for 48 hours).
Field of 16: Sweet 16 days 0 and 1, Elite 8 day 2, Final Four opens day 3 for 48 hours, Championship opens day 6 for 48 hours.

A matchup's region for scheduling is the quarter of the bracket its slot falls in, even in rounds where `region` is stored.

## Service changes

`lib/services/bracket.ts`
* `lockSeedingAndStart(tournamentId, now, startAt?: Date)`. `startAt` defaults to the next 12:00 America/New_York at or after `now` (export `nextNoonEastern(now)`; handle daylight saving correctly using Intl, no new dependency). Creates all rounds and matchups with their windows, status `scheduled`, sets `bracket_starts_at`, status `bracket`. Then runs the advance step once so anything due opens immediately.
* `advanceDueRounds(now)` keeps its name and return type but now works per matchup, in this order, repeating until nothing changes (bounded loop):
  1. Close every `open` matchup with closes_at <= now: claim it with `UPDATE ... WHERE status = 'open' AND closes_at <= $now RETURNING`, decide the winner by the existing rules, set status `closed`, and place the winner in the next round's matchup (slot floor(s/2), side a if s is even, b if odd).
  2. Open every `scheduled` matchup with opens_at <= now that has both entrants.
  3. Refresh derived round fields. When the championship is closed, set the tournament `complete`.
  A scheduled matchup whose time has come but which is missing an entrant simply waits for its feeders.
* `getTournamentState(slug)` returns, in addition to the existing fields:
  * `live: MatchupCard[]` open matchups, ordered by slot
  * `upNext: MatchupCard[]` the scheduled matchups sharing the earliest future opens_at (entrants may be null when feeders are undecided)
  * `latestResults: MatchupCard[]` the matchups sharing the most recent closes_at among closed ones
  * `nextOpensAt: string | null`
  * `currentRound` stays (the lowest numbered round that is not closed)
  * `MatchupCard = { id, roundName, region, slot, status, opensAt, closesAt, a: Entrant | null, b: Entrant | null, votesA: number | null, votesB: number | null, winnerId: string | null }` with votes null only when status is `scheduled`.
* `getBracket(slug)`: each matchup also carries `status`, `opensAt`, `closesAt`. votesA and votesB are null only for `scheduled` matchups.

`lib/services/voting.ts`
* A vote is accepted only when the matchup status is `open` and its own closes_at is in the future. `nextMatchup` returns open matchups only, `closesAt` is the matchup's, and the response gains `nextOpensAt: string | null` (earliest future opens_at among scheduled matchups) so the screen can say when the next games start.

`lib/services/admin.ts` and admin pages
* Rounds page becomes a schedule page: matchups grouped by game day (same opens_at), each group with its window and status. Actions: move a whole group's opens_at and closes_at (only while every matchup in it is `scheduled`), change closes_at for a group that is `open`, override a winner (existing rules; applies to `closed` matchups, and to `open` ones by closing them immediately).
* Starting the bracket takes an optional start date and time (America/New_York) and shows the resulting schedule before confirming is not required; a simple datetime input defaulting to the next noon Eastern is enough.
* Flagged activity now looks at `open` matchups by matchup status.

## Ownership for this addendum

* Backend task: `db/migrations/0002_staggered.sql`, `lib/services/schedule.ts`, `lib/services/bracket.ts`, `lib/services/voting.ts`, `lib/services/admin.ts`, `app/api/**`, `app/admin/**`, `components/admin/**`, `scripts/seed-demo.ts`, all of `tests/**`.
* Public UI task: `app/t/**`, `components/**` except `components/admin/**`, `lib/client/**`, `app/globals.css`.

## Public UI changes

* Tournament home in the bracket phase shows three sections from the state API: "Live now" (scores, countdown to close, a Vote button), "Up next" (who plays and when it opens, formatted in the visitor's local time like "Thu, noon"; show "Winner of A vs B" style placeholders as "TBD" when entrants are null), and "Latest results" (winner emphasized, final score).
* Bracket: every matchup that is `scheduled` shows when it opens ("Opens Thu 12 PM"); `open` ones show a LIVE tag and live scores; `closed` ones show final scores. The round tabs stay.
* Vote screen: countdown uses the matchup's own closesAt. When nothing is left to vote on, show "You're all caught up", when the next games open (from `nextOpensAt`), the follow card, and a link to the bracket.
* Under the vote cards, one quiet line (not a popup, not dismissible, small): "Results post on @{brand.igHandle}" linking to brand.igUrl.
* Hide the Nominate tab once the tournament is in the bracket or complete phase.
