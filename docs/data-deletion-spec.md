# In-app account-and-data deletion — spec and probe

**Status:** spec only. Nothing here is built. Written 2026-11-08 by the nightly loop for the Risk &
Compliance seat (`docs/cos/seats/risk.md` item 2, thread T2 `legitimacy`), under D4 (approved by Pat
2026-11-01: the nightly drafts the terms page and this spec whenever `## Queue` has nothing
unblocked).

Companion to `privacy.html` (the promise) and `docs/ops-console-scope.md` (the pattern this uses:
a security-definer function is the only read or write path that can act across RLS boundaries).

---

## 1. The finding that makes this urgent

**`privacy.html` makes a promise the database currently refuses.** Lines 166–167 of the live
notice say:

> Clearing your data does not automatically remove past analytics events, submitted feedback, or
> the sign-in account itself. Email the address below and those will be deleted too.

The first two halves are doable by hand today. **The third is not.** `events.user_id` and
`feedback.user_id` are foreign keys to `auth.users` with **`ON DELETE NO ACTION`**, so deleting the
account raises `23503 foreign_key_violation` while any such row survives — and every account has
such rows:

| | rows carrying a `user_id` | distinct accounts |
|---|---|---|
| `events` | **455** | **4 of 4** |
| `feedback` | **17** | **3 of 4** |

`auth.users` holds **4** rows. So **account deletion fails for every account that exists**, by any
route: the Supabase dashboard's *Delete user* button, `auth.admin.deleteUser()`, and a hand-written
`delete from auth.users`. The promise is unkeepable as written, and nobody has tried it because
nobody has asked.

**How this was established, and how to falsify it.** Read from the production catalog on
2026-11-08 — `public` carries **19** foreign keys; `pg_constraint.confdeltype` is `'n'` (NO ACTION)
on exactly **three** of them and `'c'` (CASCADE) on the other sixteen. Two of the three are these
(`events.user_id`, `feedback.user_id`); the third is `ops_inbox.token_id → siri_tokens`, which is a
second ordering hazard and is noted in §4. The row counts are `count(*) … where user_id is not null`. It was **not
executed**: the MCP connection is `--read-only` and this is the only project, holding real pay
history. The one command that settles it belongs in a dedicated session with Management API
access, inside a transaction that is rolled back:

```sql
begin;
  delete from auth.users where id = '<any existing uid>';   -- expect: 23503
rollback;
```

If that returns success, this section is wrong and the rest of the spec is merely tidy.

---

## 2. What actually holds her data

Every table in `public`, read from the catalog 2026-11-08. "Client can delete" means an
`authenticated` user acting as herself, under the policies that exist today.

| Table | Her key | Client can delete? | FK to `auth.users` | Reached by *Clear all data* |
|---|---|---|---|---|
| `user_data` | `user_id` | **yes** — `Users can delete own data` | CASCADE | **yes** |
| `ical_subscriptions` | `user_id` | **yes** — `ical_sub_delete` | CASCADE | **yes** (2026-11-02, §56) |
| `swap_members` | `user_id` | **yes** — `leave self` | CASCADE | no |
| `swap_profiles` | `user_id` | **yes** — `own profile all` (ALL) | CASCADE | no |
| `ops_inbox` | `user_id` | **yes** — `ops_inbox_delete` | CASCADE | no |
| `siri_tokens` | `user_id` | **no** — select/insert/update only | CASCADE | no |
| `swap_posts` | `author` | **no** — withdraw (update), never delete | CASCADE | no |
| `swap_groups` | `created_by` | **no** | CASCADE | no |
| `swap_matches` | `proposed_by` | **no** | CASCADE | no |
| `swap_match_legs` | `leg_user` | **no** | CASCADE | no |
| `events` | `user_id`, `anon_id` | **no** — INSERT only | **NO ACTION** ← blocker | no |
| `feedback` | `user_id`, `anon_id` | **no** — INSERT only | **NO ACTION** ← blocker | no |
| `ops_admins` | `uid` | no (RLS, zero policies by design) | CASCADE | n/a |
| `app_config` | — | no (SELECT only) | — | n/a |

Three readings worth keeping:

1. **`Clear all data` reaches two of twelve.** That is not a defect — it is what the button says it
   does ("erases everything *here* and your cloud copy"), and `privacy.html` discloses the rest.
   But *account deletion* is a different operation and needs a different mechanism, which is this
   spec.
2. **Three per-user tables are in production and not in `supabase/migrations/`.** `siri_tokens`,
   `ops_inbox` and `app_config` exist only in `docs/siri-shortcut.md` and
   `docs/agent-gateway-scope.md` prose. CLAUDE.md says "000→004 in order stands up a fresh
   project"; it would stand up a project missing these three. Filed separately in `BACKLOG.md` —
   it is a migration-capture job, not part of this spec, but a deletion path written off the
   migrations folder rather than off the catalog would silently miss two tables holding `user_id`.
3. **No deletion function exists.** All fourteen `public` functions were listed; none deletes
   anything on a user's behalf. `decline_swap_match` is the only security-definer write, and it
   updates.

---

## 3. What "delete my account" has to mean

Two operations, deliberately separate, because they have different reversibility and different
blast radius.

### (a) Delete my data, keep my account
Everything keyed to her `user_id`, plus the analytics rows keyed to her device. She stays signed
in; she can start over. This is *Clear all data* widened from two tables to twelve.

### (b) Delete my account
(a), then the `auth.users` row, then sign out. Irreversible. This is the one `privacy.html`
promises by email.

**Analytics is the one real decision, and it is Pat's.** `events` is insert-only and is the only
history of how the app is used. Three options, with the recommendation first:

- **Recommended — anonymise, don't delete.** Set `user_id = null` and `anon_id = null` on her rows.
  The FK blocker disappears (a null satisfies NO ACTION), the row survives as an unattributed count,
  and with the two keys gone the row carries nothing that points at her: `name` is a coarse
  `snake_case` verb, `page`/`user_agent` are not identifying on their own, and `props` is
  enumerated-or-redacted by rule — the `ob_*` funnel goes through the core's `obEventProps`
  whitelist and `client_error` is money- and URL-path-redacted (`redactMoney`, `redactUrlPaths`).
  **That rule is a convention, not a mechanism**, for every event name outside those two families
  ("coarse `snake_case` names only — never wage or goal figures", CLAUDE.md → Analytics), so a
  deletion that relies on it should **spot-check `props` across every distinct `name` before it
  ships**, not assume it. **This is what to build** — it keeps the only usage history the project
  has while removing the link to her.
- Delete the rows. Honest and simple, and it silently rewrites every funnel figure ever computed.
- Leave them and narrow the notice. Cheapest, and it makes the privacy notice worse rather than the
  product better — the shape the 11-02 `ical_subscriptions` fix explicitly rejected.

`feedback` is different and should be **deleted, not anonymised**: `message` and `contact` are
free text she typed, so there is no key to strip. Deleting it loses the support thread, which is
the correct trade when she has asked to be gone.

---

## 4. The mechanism

**One security-definer Postgres function, not client-side deletes.** The reasons are the ops
console's (`docs/ops-console-scope.md`), one layer harder here:

- **Seven of the twelve** tables have no client DELETE policy at all (`siri_tokens`, `swap_posts`,
  `swap_groups`, `swap_matches`, `swap_match_legs`, `events`, `feedback`), and four of the seven
  deliberately do not — the swap write path withdraws a post (an UPDATE to `withdrawn`), never
  deletes it, so the other legs of a match keep their history. Granting DELETE to `authenticated` on them
  to serve this feature would loosen access on the swap board, which is the wrong direction while
  `security-00` is open.
- `events` and `feedback` are insert-only **on purpose**, and must stay so: a client that can
  update `events` can rewrite its own analytics.
- A twelve-statement sequence issued from the browser is twelve chances to half-finish. The 11-02
  finding was exactly this shape one table wide — a delete issued after `signOutClient()` is
  refused *silently* by owner-only RLS.

```
-- the next free migration number; 006 and 007 are taken, and `security-00`'s swap-board
-- hardening has ALSO been penned in as 008 (risk.md item 3) — neither exists, so whichever
-- lands first takes 008 and the other takes 009. Do not assume this one got it.
delete_my_data()      security definer, authenticated only, acts on auth.uid()
delete_my_account()   security definer, authenticated only; calls delete_my_data() then
                      deletes the auth.users row
```

Four properties are load-bearing:

1. **`auth.uid()` is the only subject.** The function takes **no uid argument** — not even a
   checked one. An argument is a parameter an attacker can set, and `is_ops_admin()`'s own lesson
   (`scripts/ops_gate_probe.sql`) is that the obvious probes lie. A caller with no session deletes
   nothing.
2. **The order is fixed and the FK dictates it:** anonymise `events` → delete `feedback` → the ten
   CASCADE-safe tables → `auth.users` last. Reverse it and the account delete raises 23503, the
   transaction aborts, and she is told her data is gone when nothing moved.
3. **One transaction.** A function body is one, so this is free — and it is the difference between
   "deleted" and "partly deleted".
   **And one more FK is waiting inside it.** `ops_inbox.token_id → siri_tokens` is the third
   NO ACTION foreign key in the schema, and both of those tables cascade from `auth.users`
   independently — so a cascade that reaches `siri_tokens` before `ops_inbox` raises 23503 from
   *inside* the account delete. Both tables are **empty today** (0 rows each), which is why it has
   never fired and why it will not be found by trying it. Delete `ops_inbox` explicitly, before
   `siri_tokens`, rather than relying on cascade order. **Unverified**: whether Postgres' cascade
   order actually hits it is not established here, and the explicit delete makes the question moot
   rather than answering it.
4. **`revoke execute … from anon`.** Same rule as the `ops_*` functions: they must never appear in
   the advisor's `anon`-executable list.

### The migration also fixes the FK, and that part is Pat's
`events.user_id` and `feedback.user_id` should be `ON DELETE SET NULL` rather than NO ACTION, so
that an account deleted by any route — dashboard button included — cannot leave the FK blocking it.
That is an `alter table … drop constraint … add constraint` on an existing table, so by
`docs/leadership.md` → *Approval tiers* it is **Pat's tier** (it rewrites policies/constraints on
existing data), and migrations here run against production. It is also the half that makes the
*email* route in `privacy.html` work without any app change, so it is worth taking first and alone.

---

## 5. The UI

In Settings, below *Clear all data*, as a second danger link — **not** a second button beside it.
*Clear all data* is the common action and must stay the easy one; this is the rare, irreversible
one.

- Label: **Delete my account** (not "Delete everything" — it must say what is lost).
- Confirm sheet, typed confirmation, not a single tap. The existing `confirmAsync` is a one-tap
  danger dialog; this needs the word. A mis-tap here is unrecoverable, and unlike the import
  stepper there is no "Not now" that costs nothing.
- It enumerates what goes, in her words: *"Your pay history, your shifts, your calendar link, your
  feedback, and your sign-in. Your past usage counts stay, with nothing linking them to you."* That
  last clause is the anonymise decision made legible; if Pat picks delete-the-rows instead, the
  clause goes. **The swap board is named in this list only when she has a row on it** — the board
  is deliberately quiet (CLAUDE.md → Positioning) and a deletion sheet that advertises it to
  someone who has never opened it is a CTA wearing a warning label. Gate the clause on
  `swap_members`, the same way the iCal walkthrough card is gated on having no subscription.
- Offered **only when signed in**. An anonymous user's data is `localStorage` only, and *Clear all
  data* already is her deletion path — see §6.
- One event: `acct_delete {step}` — `'open'`, `'confirm'`, `'done'`, `'failed'`. No figures.
  Insert it **before** the delete, because after it there is no session to insert with, which is
  the 11-02 ordering lesson again.

### Then `privacy.html` changes, and that is Pat's
The notice's "Email the address below and those will be deleted too" becomes a described in-app
route. Legal text always goes to Pat (`docs/leadership.md`), so the code and the text are two
merges, and **the text must not change first** — a notice describing a button that does not exist
is worse than one describing an email that works.

---

## 6. The anonymous case, which has no server-side answer
`events` and `feedback` rows from an anonymous visitor are keyed only by `anon_id`
(`scrubpay_anon_id` in her `localStorage`, Invariant 5). Nothing on the server links that id to a
person, which is the point of it — and the consequence is that **an anonymous deletion request
cannot be served by a logged-in function**, because there is no session to authorise it. Two
honest positions:

- *Clear all data* already deletes everything of hers that exists — `privacy.html`:80–81 is exact
  about why ("saved in your browser's local storage on that device only … there is no copy anywhere
  else"), and what survives is analytics rows carrying a device id and nothing else. The notice does
  **not** currently say that last part in those words; it says analytics are not removed, which is
  true but leaves the reader to work out that they are unattributed.
- If she wants those rows gone too, she has to hand over the `anon_id`, and the ops console can key
  on it (`ops_device(p_anon_id)` already reads by exactly that key). That is a manual path and
  should be described as one, not automated.

**Do not build an unauthenticated delete-by-`anon_id`** endpoint: `anon_id`s appear in no public
surface but are guessable in bulk only by someone who already has them, and an endpoint that
deletes analytics rows on presentation of a device id is a vandalism tool with no owner.

---

## 7. The probe

New file `scripts/deletion_gate_probe.sql`, in the shape of `scripts/ops_gate_probe.sql` — and for
its stated reason: **the SQL editor's default session is a superuser, so both obvious probes lie.**
Record the pass count in the Done log. Where to run it is in the note under the table — not
production, and that is not a detail.

Eight probes, each with the result it must produce:

| # | As | Probe | Must |
|---|---|---|---|
| 1 | `anon` | `select delete_my_data()` | **denied** (no execute grant) |
| 2 | `anon` | `select delete_my_account()` | **denied** |
| 3 | `authenticated`, user A | `select delete_my_data()` | succeeds; A's rows gone/anonymised |
| 4 | `authenticated`, user A | after (3), count B's rows in all twelve tables | **unchanged** |
| 5 | `authenticated`, user A | `select * from events where user_id = A` | **0** |
| 6 | `authenticated`, user A | total `events` count | **unchanged** from before (3) — proves anonymise, not delete |
| 7 | `authenticated`, user A | `select delete_my_account()`, then `auth.users` where id = A | **0 rows, no 23503** |
| 8 | positive control | as `anon`, a call that must work (`select 1`) | **succeeds** — proves 1 and 2 were denied by the grant, not by a broken connection |

Probe 8 is there because `ops_gate_probe.sql`'s whole lesson is that a denial proves nothing if
the session was never going to work: without a positive control, a typo'd connection string passes
probes 1 and 2 and the probe set reads green on a wide-open function.

Probes 4 and 6 are the two that cannot be skipped. 4 is the cross-tenant question — a
security-definer function bypasses RLS by construction, so "deletes her rows" and "deletes
everyone's rows" look identical from inside her own session. 6 is the only probe that distinguishes
the recommended design from the one that quietly destroys the project's usage history.

**Run it on a rehearsal project, not production**, which `docs/agent-gateway-scope.md` already
requires from its first write: probes 3 and 7 are destructive and there are four real accounts,
one of them Courtney's.

---

## 8. Build order

1. **The FK half of the migration, alone** — `events.user_id` and `feedback.user_id` to `ON DELETE SET
   NULL`. Pat's tier. It makes the *existing* emailed promise in `privacy.html` keepable, with no
   app change and no new surface, and it is the only item here that fixes a live false statement.
2. **The two functions + the probe**, on a rehearsal project. Pat's tier (new functions are
   additive, but they delete data on an existing table, so the probe is the evidence).
3. **The Settings UI + §-numbered harness assertions**, driven against a stubbed client the way
   §56 drives *Clear all data*: assert the RPC was called, assert the op order, and negative-test
   by removing the call. Nightly-safe once 1 and 2 exist.
4. **`privacy.html`** last, describing what then exists. Pat's tier, always.

Steps 1 and 2 are one dedicated session. Nothing above is nightly work until they land, which is
why this file is a spec and not a branch.
