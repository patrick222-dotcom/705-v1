# Session log — 2026-09-02: domain purchase, naming decision, custom-domain cutover

Written at the end of the session, as a handoff to a fresh review session. This is the
**decision record** — the reasoning that produced the commits, which the commits themselves
do not carry. For the surveyed state of the repo, see the companion brief.

---

## 1. What was asked, and what happened

The session started as "look up domains close to ScrubPay and tell me how much and where to
buy." It became a naming decision, four domain registrations, and a live custom-domain
cutover. Nothing here was planned in advance; each step followed from what the previous one
turned up.

**Shipped:**

| | |
|---|---|
| Domains registered | `badgebudget.com`, `badgebudget.app`, `shiftstogo.com`, `shiftstogo.app` |
| Live at | **https://badgebudget.com** |
| PRs merged | #58 (CNAME + publish step + savings-goals backlog item) |
| PRs open | #60 (CLAUDE.md corrections + dev-database backlog item) — **docs-only, draft** |

---

## 2. Why the name changed

### ScrubPay was more crowded than it looked

Three separate entities have used the name:

- **ScrubPay (2026)** — a healthcare payroll/ATS company, live on `scrubpay.app` and
  `scrubpay.org`, both registered **2026-08-21**, ~11 days before this session. Squarespace
  DNS. Site title: *"ScrubPay | Healthcare Payroll & ATS Software."* Adjacent market.
- **ScrubPay (2014)** — an Atlanta medical-bill payment app.
- **SCRUBJAY** — a **registered USPTO mark** since 2019, healthcare staffing.

`scrubpay.com` itself is investor-held (registered 2021, Spaceship, parked on Atom.com
nameservers) and listed for sale. Asking price not obtainable — the Atom listing page is
behind Cloudflare bot protection.

### The deeper problem was the category, not the collision

"ScrubPay" claims to be a payments or payroll product. The app is neither — nobody pays
anyone through it. It forecasts what a shift is worth *before* it's worked. That mismatch is
why the name kept landing next to payroll companies: it named itself into their category,
which is also the most trademark-litigious neighbourhood available.

**Dropping "Pay" mattered more than dropping "Scrub."**

### How BadgeBudget was arrived at

Explored in order: nurse-explicit (`NurseLedger`, `RNTally`), bedside (`BedsideTally`,
`BedsideBudget`), prediction words (`ShiftForecast`, `ShiftPrognosis`), then **badge**.

"Badge" won on a specific property: **every person in a hospital has one**, regardless of
credential — RN, MD, RT, phlebotomy, unit secretary. It excludes nobody, where "nurse"
excludes techs and "bedside" excludes lab, pharmacy and imaging. The owner then extended it
further — police, firefighters, EMS, corrections all wear badges and all work
differential-and-overtime schedules. Firefighters in particular are covered by the FLSA
§7(k) exemption, where overtime is computed over a 7–28 day work period rather than at 40
hours; almost none of them can compute their own paycheck. Same product, different math.

**"Budget" was initially argued against and that objection was withdrawn.** The argument was
that budgeting connotes restriction while the app delivers good news. Courtney's feature idea
(§4) reframed it as *goals* rather than restriction, which makes "Budget" accurate rather
than underselling.

`BadgePay` was killed: taken, **and** "badge pay" is already a generic term for
employee-badge cafeteria/vending payment systems — an existing product category doing roughly
the opposite thing.

### Not done: the app is still branded ScrubPay

Only the domain moved. `index.html` still says `ScrubPay — Nursing Wage Planner` in its
`<title>` and throughout the UI. **The rename is unscoped and unstarted.**

> **Landmine for whoever does it:** the localStorage keys (`scrubpay_anon_id`,
> `scrubpay_feedback_pending`, `scrubpay_pending_invite`) and `nursingWagePlannerData` are
> **storage keys, not branding**. Renaming them orphans existing users' data. Any rename must
> treat visible strings and storage keys as separate problems.

---

## 3. The cutover, and what is load-bearing

Sequence used, and it mattered: **DNS first, then repo, then merge.** Pushing a `CNAME` before
DNS resolves sets the custom domain and redirects the github.io URL to a domain that does not
answer — which takes the live app down for current users.

### Load-bearing facts

- **`CNAME` must stay in `deploy.yml`'s publish set.** Pages reads the custom domain from the
  *deployed artifact*. An Actions deploy whose artifact lacks `CNAME` can clear the custom
  domain setting and knock the site off `badgebudget.com`. The nightly loop deploys
  unattended, so this is a live risk, not a theoretical one.
- **URL Forwarding must stay OFF on `badgebudget.com`.** Porkbun's bundled "Link-in-Bio"
  enables it at registration (it pointed at `badgebudget-com.l.ink`) and it *overrides the A
  records entirely* — correct DNS with forwarding on still serves the parking page.
- **The MX/SPF and two `_acme-challenge` TXT records were deliberately kept.** They are email
  forwarding and Let's Encrypt validation; they do not touch web traffic. An earlier
  instruction in this session to "delete all 7 records" was **wrong and was corrected** —
  only the `ALIAS` and the wildcard `CNAME` (both → `uixie.porkbun.com`) were parking.
- **The wildcard `CNAME` (`*.badgebudget.com`) was the subtle one.** An explicit `www` record
  beats a wildcard in DNS, so `www` would have worked either way — but every *other* subdomain
  would have kept resolving to Porkbun parking.

### The app needed zero code changes

Verified in `index.html`: no hardcoded `github.io` URLs; the Google OAuth redirect builds from
`window.location.origin + window.location.pathname`; invite links build from the live page
URL. All three follow the origin automatically.

### Known consequence, not yet handled

**Anonymous users lose their saved shifts.** `localStorage` is per-origin, so anyone who used
the app without an account on `patrick222-dotcom.github.io` sees an empty planner on
`badgebudget.com`. Signed-in users are unaffected (their data is in Supabase `user_data`).
This was raised twice and never resolved — no migration notice was built and no confirmation
was given that the affected users have accounts. **Still open.**

---

## 4. Courtney's feature idea (now `P1` in BACKLOG.md)

Express a shift's value as **progress toward a concrete savings goal** — "pick up a 12-hour
night and that's 1/12th of a down payment" — rather than only in dollars.

Why it was rated P1: a take-home calculator is structurally a **one-time** product. You
confirm your rate at onboarding and rarely reopen it, because your rate doesn't change. A goal
tracker is an **every-shift** product. Same math already computed, materially different
retention curve.

The highest-value placement is **pre-commitment**, in the Add-Shift flow: *"picking this up
moves your goal 9 days closer."* That puts the answer at the moment of the decision, which is
the app's whole thesis.

> **Design constraint recorded with the item, and it should not be dropped:** this points a
> motivational loop at a profession with a serious burnout problem. "Just one more shift" is a
> harmful thing to automate. Scope it to informing a choice the user is *already* considering —
> no streaks, no push notifications, no "you're behind on your goal."

---

## 5. Open questions and decisions deliberately deferred

**Environments (dev/test/stage/prod).** Asked, and the answer was *not four tiers*. Dev and
test already exist in the form that matters (the iPhone-13 Playwright harness plus the safety
gate). A staging *site* would need a second repo — Pages serves one site per repo — and earns
its keep only when someone would catch a bad deploy before users do; nobody is watching at 3am.
**But one real gap was identified and backlogged:** there is a single Supabase project holding
real users' pay history, and RLS audits mint throwaway users against it while migrations are
applied to it directly. A second free-tier project (the free plan allows 2 active) fixes that.
Filed under *Needs a dedicated session*.

**Google OAuth consent screen** still shows `mnnlgcxnvodjwlhhiphq.supabase.co`. That string is
the host of the OAuth callback, which genuinely lives on Supabase — **not changeable** from the
app or from Google Cloud Console. The only fix is a Supabase Custom Domain: Pro (from $25/mo)
plus the custom-domain add-on ($10/mo) ≈ **$35/mo**. Judged not worth it at current scale. The
free improvement — set the app name and logo on the GCP OAuth consent screen — was offered and
**not yet done**.

**Enforce HTTPS** was reported by the owner as having defaulted on. Not independently
verifiable from the dev sandbox: outbound requests pass through a TLS-intercepting proxy, so
the certificate and any HTTP→HTTPS redirect cannot be read from here. The owner's device is the
authority.

---

## 6. Environment note

`SUPABASE_ACCESS_TOKEN` is now **uppercase** (it was lowercase, which is why CLAUDE.md said the
typed Supabase MCP tools couldn't find it). The Management API works via
`-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"`. Supabase auth config was updated this
session through `PATCH /v1/projects/<ref>/config/auth`:

- `site_url` → `https://badgebudget.com/`
- `uri_allow_list` → `https://badgebudget.com/**,https://www.badgebudget.com/**,https://patrick222-dotcom.github.io/705-v1/**`

The github.io entry is kept deliberately so in-flight invite links and cached sessions still
resolve.

---

## 7. What a cleanup session should pick up

1. **Merge PR #60** — CLAUDE.md still points the nightly loop at the old URL for verification
   until it lands. Docs-only.
2. **Anonymous-user data loss** (§3) — decide: migration notice, or confirm it doesn't matter.
3. **Scope the ScrubPay → BadgeBudget rename** (§2) — respecting the storage-key landmine.
4. **GCP OAuth consent screen** branding — free, ~10 minutes.
5. **Dev Supabase project** (§5) — already in BACKLOG under *Needs a dedicated session*.
