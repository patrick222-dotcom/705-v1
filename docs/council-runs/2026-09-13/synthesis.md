# Council 2026-09-13 — synthesis for the owner

**Verdict in four lines.** The wage math itself held: no confirmed finding shows `shiftGross`/`computeNet` producing a wrong number for any input the UI can create, and 5 of the 6 sync-race findings were refuted, so the data-sync design stands. What the council found is (a) five *surfaces* that disagree with `computeNet` or show a fake/averaged figure as certain, (b) the swap board's anonymity promise is false as deployed, and (c) a large, cheap a11y/mobile cleanup. One wage-core session, one swap-board/infra hardening session, and a run of nightly-safe fixes clear most of it.

**Read the lens scores with this caveat.** The scorers ran against `index.json` before verification finished and counted *unverified* findings as confirmed. Verified set (`confirmed.json`, 42 items) vs what the scorers said: mobile-ux **1** confirmed (scorer: 11), accessibility **10** (25), code-quality **4** (17), performance **0** (2), privacy-telemetry **1** (3), cross-surface **1** (3), product-design **6** (8). Security (9) and wage-math (6+3 low) match. So the mobile-ux 4/10, performance 5/10 and code-quality 3/10 have no verified basis yet; security 2/10 and accessibility 2/10 do.

No app code has shipped since the run (only council-doc commits), and I spot-checked every load-bearing claim below against the current `/home/user/705-v1/index.html` and `supabase/migrations/001_swap_board.sql`; all hold.

---

## Merged defects, ranked by what hurts a nurse relying on the number

Same defect seen through several lenses is one item; the sharpest statement is kept.

**Money surfaces (the app's premise)**

1. **Hero "Taxes & deductions" chip is uncapped** — `product-design-00` (high) = `wage-math-00` (medium, wageCore) = `cross-surface-03`. `index.html:3487` prints raw `calc.ded`; `computeNet` caps pre/post for the Breakdown. Any nurse with a pretax/posttax deduction (a paystub scan sets them) sees "Gross $0 · Taxes –$260 · $0" on every fresh pay period, and the Breakdown one tap away disagrees. Fix: chip = `round(gross) − round(net)` — which also closes `wage-math-02`'s $1 rounding drift for free. One line; `computeNet` untouched.
2. **Add-Shift defaults to `'night'` even when Night is switched off** — `wage-math-12` (medium) = `cross-surface-01`; siblings `wage-math-03/07`, `cross-surface-06` (lows). `useState('night')` at 4077 never reconciles with the active-filtered chips at 4099; every quick log is +$120 at $50 base on a differential she turned off, and the pattern lab prices the same setup at base. Fix: seed from the first active non-overtime key. *Separate product call underneath it:* does `active:false` mean "stop paying" (lab) or "hide from picker" (calendar)? Both surfaces currently pick a different answer.
3. **Pattern lab "Take-home per paycheck" is a cycle-average shown as certain** — `product-design-04` (high) = `wage-math-09` (medium) = `cross-surface-02`. For the shipped "4 on, 4 off nights" preset real checks alternate ≈$7,214 / $5,411 gross while the lab shows one flat ≈$6,313, with no qualifier (the yearly figure next to it *is* hedged with ≈). Label-only fix when `lcm(n,14) > 14` is safe; a min/max range touches `patternMetrics`.
4. **Blanked multiplier coerces to 0×** — `wage-math-01` (medium, wageCore). `sanitizeData:1046` maps non-finite to 0 for every type; NumInput commits `min` (0) on blur. Holiday becomes 0× from a select-all-then-tap-away, the Christmas shift shows ~$0, and nothing ever repairs it. Fix: multiplier type coerces ≤0/non-finite to 1; `min` 0.1 in Settings.
5. **"Clear the sample" leaves the placeholder $65.15 with no banner** — `product-design-06` (high). `clearSample` (2991) sets `estimateMode:''` unconditionally; every figure she logs afterwards is against a fake rate with the one warning mechanism already dismissed. Needs a design decision (track "rate explicitly set", or refuse to clear until a rate is entered).
6. **Welcome screen literal `$3,951` vs `sampleNet()` = $4,147** — `product-design-05` (high), plus unverified `code-quality-03` (sampleNet hand-rolls the tax formula instead of calling `computeNet`). Fix both at once: `sampleNet` → `computeNet`, welcome renders `sampleNet`.
7. **`ficaWithholdingType` passes `sanitizeData` unallowlisted → FICA silently 0** — `code-quality-01` (high, wageCore). Only a corrupt/hand-edited/imported blob reaches it, but the adjacent `estimateMode` was hardened for exactly this. One-line allowlist + probe.
8. **`$0` goal → "Infinity%" in the Add-Shift preview** — `product-design-07` (high) = `wage-math-14`/`code-quality-13`. Settings' reverse view (4748) guards `g.target>0`; the preview (4248) doesn't; `updGoalTarget` (4686) commits 0. Guard + clamp.
9. **`keepRatio` omits percent custom withholdings** — `cross-surface-00` (high) = `wage-math-04`/`product-design-01`. **Downgrade:** the dissent is factually right and I verified it — `setCW` is called only from load (2318) and reset (2338); there is no editor, so no nurse can create this state. Fold into `keepRatio` whenever the wage-core session is open; not a live defect.
10. **Paystub premium-only row → negative differential** — `wage-math-06` (medium; strong dissent: single-stub parser, one successful import in two months, visible in the review sheet). Floor at 0 and flag the row; low priority.
11. **Year view prints gross where month cells print take-home** — `wage-math-05` (low). Add " gross" to the row label.
12. **Grid hint promises weekend inference for template brushes** — `wage-math-10` (medium; strong dissent: it's the documented template contract). Copy fix only ("Generic Day/Night brushes pick up…"); do **not** apply fix (b).

**Data and credentials**

13. **Stalled sign-out leaks the previous account's iCal bearer URL into the next sign-in** — `code-quality-00` (high) = `security-09` (medium). `handleSignOut` (2533-2536) claims to mirror the SIGNED_OUT branch but omits the four iCal clears at 2417; the hydration effect's `catch(_){return}` keeps stale state too. Invariant 13 credential on a shared unit iPad. Mechanical fix; factor both blocks into one function so they can't drift again.
14. **pagehide flush drops a failed save with no backup** — `data-integrity-00` = `code-quality-18` (high). `flush` (2496) has the success path only; the debounced effect (2478) calls `writeBackup`. The dissent narrows the window to "edit in the last 500ms + write fails + tab discarded before resume" — narrow but real and the fix is the same line 2478 already has. The *optimistic* backup-before-save variant changes BACKUP_KEY's documented meaning on the hydrate path that once ate 47 days: that half is dedicated-session only.
15. **`obStep` not reset on sign-out** — `code-quality-11` (high, 1-of-3 dissent on reachability; reachable for anyone who signed up without anon use). `setObStep(0)` in `resetToDefaults`.

**Swap board (zero real groups today; de-emphasised by owner decision — but the docs call it audited)**

16. **`poster_key` is reversible** — `security-00` (critical). `authenticated` holds whole-table SELECT on `swap_members` (user_id) and `swap_groups` (created_by) (001:68-69); the salt is a public constant; md5 is a one-liner. The migration says "Not reversible", `docs/swap-board.md` says audited, in-app copy says anonymous — all three are false as deployed. Step 1 is grants only, no client change (the client never selects `swap_members`, reads only id/name/invite_code/created_at from `swap_groups`). Step 2 replaces the constant salt with a per-group secret — an Invariant 7 rewrite.
17. **`propose_swap` never checks the caller is a leg** — `security-01` (high). Verified: the `not_a_party` guard exists in decline/reveal (276, 312) but not in `propose_swap` (245-265). Any member can freeze every open post from the console. One `if not exists … raise`.
18. `security-02` (raw decline policy strands posts) and `security-03` (`doApplyPlan` writes unvalidated `shift_meta`) — both dissented down to hardening nits; fold into the same migration.

**Infra**

19. **No server-side size bound on `user_data.data`** — `security-05` (high). `MAX_BLOB_BYTES` is a JS comparison at one of three save sites; flush and retry bypass it; any Google account is now a valid `authenticated` caller. Migration `004`: `pg_column_size(data) <= 524288` + `jsonb_typeof = 'object'`, and move the check into `saveToSupabase`. (Unverified `code-quality-19`/`data-integrity-06` are the same family.)
20. **`ical-proxy` accepts the anon key** — `security-08` (medium). `verify_jwt` checks signature, not role; live probe with the page's anon key ran the handler; `www.google.com` is allowlisted with no path constraint. Role/sub check + `/calendar/ical/` prefix + redeploy + curl negative test. CLAUDE.md's "not an open proxy" claim is wrong.
21. **Google sign-in is the implicit flow, not PKCE** — `security-11` (medium). `createClient` at 614 passes no `auth` options; supabase-js 2.45.4 defaults to `implicit`, so tokens land in `#access_token=…` one Back-press away on a shared workstation. One line (`{auth:{flowType:'pkce'}}`) but needs a real Google sign-in on a phone to verify, and CLAUDE.md → Auth plus the comment at 1602 say PKCE today.
22. **`client_error` batch can exceed the live 2000-byte CHECK and is dropped after the ring buffer was cleared** — `security-12` (medium). 6+ max-length entries reject with 23514; loss is self-concealing. Budget the payload in `flushClientErrors`.

**Privacy / first screen / a11y**

23. **`privacy.html` says sign-in is Google-only and "stores no password"** — `privacy-telemetry-00` (high). Email/password is the first-shown option and was added three weeks *before* the notice was written. Copy fix; verify and fold in the two unverified siblings (`-01` anon_id sits in the same row as user_id, `-02` feedback always carries user_id) in the same edit.
24. **Hero footer links match the `.hero` card rule** — `mobile-ux-00` (high). `className="hero more linklike"` at 3491-3492; `.hero` (line 114) out-orders `.linklike` padding:0 (line 79), so each link is a 59px dark pill and the first screen is ~120px taller. Fix: drop the `hero` token — `.hero .more` still matches by descent.
25. **Dialog semantics missing on AddShift, PatternLab, Settings; close buttons unnamed on Breakdown/Settings** — `accessibility-10/-12/-21/-02` (high). Six sibling sheets do it right; these are attribute-only fixes.
26. **AA contrast failures on money-adjacent tags** — `accessibility-00` (OT tag `#11A86B` → `var(--money-ink)`), `-16` (`.tag.est #C2820A` → ~`#8A5A05`).
27. **Pay-period stepper animates under reduced-motion** — `accessibility-05`. No `matchMedia` anywhere in the file; one check in `animateScrollTop`.
28. **No focus trap / Escape on PatternLab and SwapsSheet; onboarding never moves focus or uses headings** — `accessibility-13/-25/-15`. Escape handlers are trivial; the focus-trap utility across all seven sheets is a policy change (see "found the backlog").

---

## Bucket 1 — safe to auto-apply now (nightly-eligible, `harness:drivable`, no displayed-dollar change)

In suggested order; each needs one negative-tested assertion.
1. #24 hero link class (assert `querySelectorAll('.hero').length === 1`).
2. #13 sign-out clears (seed A's `icalUrl`, simulate rejected `signOut` + rejected `loadIcalSub` for B, assert the input is empty).
3. #23 `privacy.html` copy (in the publish set; no app code).
4. #25 + #26 + #27 + #8 as one a11y/UI pass (assert `role="dialog"` on each opened sheet, computed color of the OT tag, `Infinity` absent from the preview).
5. #22 `client_error` budget (seed 8×300-char entries, assert body < 1,700 chars).
6. #14 minimal: `writeBackup` in the flush's falsy branch, byte-for-byte what 2478 does.
7. #15 `setObStep(0)` in `resetToDefaults`.
8. #3 label-only caption when `lcm(n,14) > 14`; #12 hint copy; #11 " gross" label.
9. Escape-to-close on AddShift/PatternLab/SwapsSheet (the Escape half of #28).

## Bucket 2 — needs a dedicated session

- **Swap-board + infra hardening (one session, prod project):** port `rls_audit.js` into `tests/` *first* so the probes exist, then migration `004`: #16 step 1 (revoke/narrow grants), #17, #18, #19 (size CHECK). Then #20 (`ical-proxy` role check + redeploy + curl test). Then #16 step 2 (per-group secret; rewrite Invariant 7, `docs/swap-board.md`, the migration comment and the in-app "anonymously" copy to match). Do this **before** the swap board is promoted again, not tonight.
- **#21 PKCE:** one line, but verify with a never-signed-in Google account on a real phone; update CLAUDE.md → Auth and the 1602 comment.
- **#14 optimistic backup** variant (changes BACKUP_KEY semantics on the hydrate path).
- **Product calls:** #5 (fake rate after clearing the sample), the `active:false` semantics under #2, and `product-design-08` (pay estimate on swap cards — new displayed dollar, and it cuts against the de-emphasis decision; only if the board is re-emphasised).
- **Focus-trap policy** (#28) — see below.

## Bucket 3 — wage-core: never auto-applies

One session under the `wage-core` skill: baseline probes, one new assertion per fix, and the hero/breakdown equality assertion against the deployed build naming each intended difference. Cheapest first: #1 hero chip (one line, closes `wage-math-02` too), #7 `ficaWithholdingType` allowlist, #2 Add-Shift seed, #4 multiplier coercion, #6 `sampleNet` → `computeNet` + welcome figure, then optionally #3's min/max range (touches `patternMetrics`), #9 fold percent withholdings into `keepRatio` while there, #10 paystub floor. Every one of these changes a displayed dollar figure or an Invariant-3 coercion; none is nightly work no matter how small the diff.

## Found the backlog / documented tradeoffs

- The focus-trap findings (`accessibility-13/-25`, and `-15`'s focus movement) restate CLAUDE.md's stated tradeoff ("no sheet traps focus"). The council's position is that the tradeoff no longer holds at seven modal sheets; that is an owner call, not a defect list.
- Among the *unverified* set: `performance-01/-04` (memoization), `code-quality-20` (jsonb key-order canonicalization), `code-quality-23` (allowlist lacks NurseGrid), `security-14` (mutable action tags), `security-04` (anon EXECUTE on the RPCs — the advisor note already explains it) all restate KNOWN items.
- Nothing in the 42 confirmed findings restates a KNOWN item; `security-00` is *not* the known stable-`poster_key` item (that one is recognisability, this one is reversibility).

## Docs the council proved wrong (fix alongside the code)

CLAUDE.md says PKCE (it's implicit), says `ical-proxy` is not an open proxy (anon key runs it), and says the swap board's anonymity is enforced in Postgres and audited (grants leak the inputs). `docs/swap-board.md` and the migration comments repeat the last one.

## Which lenses are below 8 and what clears them

- **Security 2/10 — genuinely below 8 on verified findings.** Clears with the hardening session (#16–#22); the RLS audit in `tests/` is what keeps it there.
- **Accessibility 2/10 — genuinely below 8.** Bucket-1 items #25–#27 plus Escape handlers clear the confirmed set; the 15 unverified name/live-region items and the focus-trap policy decide whether it reaches 8 or stalls at 6–7.
- **Wage-math 4, product-design 3, cross-surface 3 — one root cause.** All three converge on #1–#7. The wage-core session clears all three; `cross-surface` also wants its unexamined slices (onboarding, swap board, settings) checked before its score means much.
- **Privacy-telemetry 4/10** — one `privacy.html` edit (#23 + the two siblings) clears it.
- **Mobile-ux 4/10, performance 5/10, code-quality 3/10 — scores rest on unverified findings.** Verified: mobile-ux has one defect (#24), performance zero, code-quality four (#7, #13, #14, #15). Either verify the tap-target cluster (`mobile-ux-01/03/05/06/08/10/11`) with a harness hit-area assertion and `performance-00/-03` (render-blocking `<head>` scripts — same class as Invariant 1 — and a Supabase write on scroll) or don't carry these scores forward.
- **Data-integrity 5/10** — one narrow confirmed item (#14); five rejected races say the design is sound. The minimal fix clears it.

## Backlog candidates (not action items)

53 unverified + 34 low findings in `status.md`/`dedups.json`. The clusters worth a groom: the mobile tap-target set above; a11y accessible names and `aria-live` (`accessibility-03/-04/-06/-08/-09/-11/-14/-17/-18/-19/-22/-23/-24/-26`); `performance-00` (blocking CDN scripts gate even the watchdog); `performance-03` (scroll past a period boundary fires a real upsert); `product-design-02` (templates drop the OT flag) and `-03` (preview updates on blur, not keystroke); `code-quality-02/-04/-22/-26` (duplicated rollup/day-key/error-swallowing families). Lows were never agent-verified by design.
