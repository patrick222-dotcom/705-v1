# Swap board — design, anonymity model, audit history

Multi-user, anonymous shift-swap boards for a nursing unit. Built 2026-07-24 (Phase 1: invite-code
groups, board, posting; Phase 2: matching engine, accept/reveal, swap plans). Schema applied to the
live Supabase project by the owner on 2026-07-30 from `supabase/migrations/001_swap_board.sql`:
6 tables, 15 RLS policies, 8 security-definer functions, 3 indexes. Moved out of `CLAUDE.md` on
2026-09-02; the invariants that matter to every session stay there.

## Design

- **Groups** are joined by a 6-character invite code (`join_swap_group(code)`); RLS hides
  `swap_groups` from non-members, so a board's name is unknowable before joining.
- **Posts** are anonymous. The `author` column is ungrantable (selecting it, or `*`, is 403 for
  everyone including the author). `swap_board(g)` returns each post with a pseudonymous
  `poster_key = substr(md5(author || group_id || 'scrubpay-swaps'), 1, 8)` — stable per author per
  group, distinct across authors — plus `is_mine`. The salt string is live in the deployed function.
- **Matching** is client-side: pickup / handoff / trade / 3-cycle suggestions computed from
  `poster_key` correlation (27-assertion unit suite `te_swap_p2_algo.js`, never committed).
- **Proposing** (`propose_swap(g, post_ids)`) creates the match + legs and **freezes** the posts
  (RLS status gate: reserved posts are uneditable by their author). Matches and legs are created
  *only* through this RPC — the raw insert grants were revoked (see audit log).
- **Reveal** (`reveal_match(m)`) re-validates every leg (`match_stale`) and returns display names
  only after **all** legs accept. `match_details(m)` is gated on `is_match_party`. Declining
  (`decline_swap_match`) releases the posts.
- **Invite links** (2026-08-22, #43): `https://badgebudget.com/?join=CODE` through the native share
  sheet (`navigator.share`, clipboard fallback; AbortError = "chose not to send"). Recipients always
  get a confirm screen — the code is what's confirmed, the board name lands in the success toast.
  `?join=` is consumed on mount (every other query param written back byte-identical so supabase-js's
  PKCE `?code=` is untouched) and stashed in localStorage (`scrubpay_pending_invite`, 1h TTL) so it
  survives the Google OAuth redirect and onboarding. A link carries only the invite code — the same
  secret as reading it aloud — so no RLS/anonymity surface changed. Members can re-show the code from
  the active board header (#40) and join a second board with a code (#28).
- **Consent disclosure** (2026-08-11, #27): after reveal, the match card says that colleagues on a
  confirmed swap can see each other's names and may recognize each other's future posts.
- **Known gap, by design:** `poster_key` is stable per group, so a colleague identified via one
  confirmed match can correlate that person's later posts. Per-cycle key rotation is parked in
  `BACKLOG.md` (touches the security-definer derivation; defer until real demand).
- **`tablesMissing` fallback:** the 🛠️ "not set up yet" screen from before the schema was applied
  is still in the code (one hook, six setters, a detector `isMissingSwapTable()`, six gated render
  branches). It is unreachable in normal operation and deliberately left in — removing it is not
  doc-sized work.

## Security advisor state

Supabase's linter reports 16 WARNs (lints 0028/0029) that the eight security-definer functions are
executable by `anon` and `authenticated`. That is the design: the RPCs are the anonymity boundary,
and each gates on membership or match-party checks internally. They are not findings to "fix" by
revoking EXECUTE.

## Audit log

**2026-07-30 — adversarial RLS/anonymity audit, 29/29.** Script `rls_audit.js` (session scratchpad,
never committed) minted throwaway confirmed users via the admin API and exercised the live DB with
real user JWTs. Verified: `author` ungrantable; `swap_board` leaks no author, correct `is_mine`,
stable and cross-author-distinct `poster_key`; cross-group isolation; no author spoofing on insert;
no cross-author update/delete; `propose_swap` freezes posts and blocks double-booking
(`post_unavailable`); reserved posts uneditable by their author; reveal gated until all legs accept;
non-parties blocked from `match_details`/`reveal_match`; can't accept another's leg; decline releases
posts.

**Bug found by the audit that the happy path had never exercised:** `reveal_match` raised Postgres
`42702` (`column reference "post_id" is ambiguous` — a bare `post_id` in the retire-posts subquery
collided with the function's `RETURNS TABLE (post_id …)` OUT param), which would have 400'd every
successful reveal. Fixed by aliasing the subquery (`select l.post_id from swap_match_legs l`),
patched live via the Management API and in the migration file.

**2026-07-30 — two more RLS fixes from the council run (live + migration):**
1. **Direct-INSERT hole.** `swap_matches`/`swap_match_legs` had raw `insert` grants, so a member could
   fabricate a match + self-named leg pointing at any `post_id` and read that post's hidden
   (non-open) content via `match_details()`, which was gated only on `is_match_party`. Both insert
   grants revoked; matches/legs are created only through `propose_swap()`.
2. **Status forge.** The "update own posts" WITH CHECK was tightened to `status in
   ('open','withdrawn')` so an author can't forge `proposed`/`matched` via a direct REST update
   (edit-while-open and the direct withdraw still work).
Re-verified: 29/29 + 5/5 new adversarial probes (both inserts denied, forge blocked, withdraw intact).

## Verification standard for swap-UI changes (`harness:needs-live-auth`)

The iPhone-13 sandbox cannot reach an authenticated board, so swap-UI changes ship by the standard
set in #27/#28/#43: bundle presence + reuse of already-vetted primitives + whole-file compile
(seeded boot renders, zero page errors), and where a flow needs a session, an in-page Supabase stub
(fake auth + `join_swap_group`) driven end-to-end. Never change RLS, the security-definer functions,
`poster_key` derivation or the reveal gate in a nightly build.

## Open design work

**Swap handoff redesign** — double-blind (peers never see each other; only the approver sees both
identities), a failure-weighted reliability signal, and a bounded negotiation "market" (giveaway vs
trade-only toggle, one atomic paired swap, availability windows; chains rejected unanimously).
Decided by a 5-persona council A/B on 2026-08-24; the verdict and must-haves are recorded with the
item in `BACKLOG.md` → Needs a dedicated session.

## Analytics

Swap events (coarse, no content): `swap_group_created`, `swap_group_joined`, `swap_invite_shared`,
`swap_invite_opened`, `swap_posted`, `swap_withdrawn`, `swap_match_proposed`, `swap_match_accepted`,
`swap_match_declined`, `swap_match_confirmed`, `swap_plan_applied`.
