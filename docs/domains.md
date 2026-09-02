# Domains, DNS and registrar

Operating facts for badgebudget.com. Moved out of `CLAUDE.md` on 2026-09-02; the decision record
(why ScrubPay was dropped, how BadgeBudget was chosen) is `session-2026-09-02-domain-and-naming.md`.

## Registrations (Porkbun, account `pathwk`)

All four registered 2026-09-02, expire 2027-09-01. WHOIS privacy on (verified: no registrant PII
in the public RDAP record). Transfer lock on (`clientTransferProhibited` + `clientDeleteProhibited`).

| Domain | Role | Renewal |
|---|---|---|
| **badgebudget.com** | **primary — the live app** | $11.08/yr |
| badgebudget.app | redirect → badgebudget.com | $14.93/yr |
| shiftstogo.com | redirect → badgebudget.com | $11.08/yr |
| shiftstogo.app | redirect → badgebudget.com | $14.93/yr |

## DNS on badgebudget.com (Porkbun nameservers)

- Four A records to GitHub Pages: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`,
  `185.199.111.153`.
- Four AAAA records: `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`,
  `2606:50c0:8003::153`.
- `www` CNAME → `patrick222-dotcom.github.io`.
- The MX/SPF records for Porkbun email forwarding and the two `_acme-challenge` TXT records are
  **deliberately kept** — they don't touch web traffic. Only the parking `ALIAS` and the wildcard
  `CNAME` (both → `uixie.porkbun.com`) were removed. The wildcard was the subtle one: an explicit
  `www` beats a wildcard, but every *other* subdomain would have kept resolving to parking.
- **URL Forwarding must stay OFF.** Porkbun's bundled "Link-in-Bio" turns it on at registration
  (it pointed at `badgebudget-com.l.ink`) and it overrides the A records entirely — correct DNS with
  forwarding on still serves the parking page.

## GitHub Pages side

- `CNAME` in the repo root holds `badgebudget.com`; `deploy.yml` copies it into the published
  artifact. Pages reads the custom domain from the artifact, so a deploy without it clears the
  custom-domain setting and reverts the site to github.io (which then 301s to a domain that no longer
  answers — a live outage, not a cosmetic one).
- The github.io URL 301-redirects to badgebudget.com, so old bookmarks and invite links keep working.
- Enforce HTTPS: reported by the owner as defaulted on. Not verifiable from the dev sandbox (its
  outbound TLS is intercepted by a proxy); the owner's device is the authority.
- Cutover order that worked: **DNS first, then the repo, then merge.** Pushing a `CNAME` before DNS
  resolves points the github.io redirect at a domain that doesn't answer.

## What the app needed for the move

Nothing. `index.html` has no hardcoded github.io URLs; the Google OAuth redirect builds from
`window.location.origin + window.location.pathname`; invite links build from the live page URL.
Supabase Auth was updated via the Management API (`PATCH /v1/projects/<ref>/config/auth`):
`site_url` = `https://badgebudget.com/`, `uri_allow_list` =
`https://badgebudget.com/**,https://www.badgebudget.com/**,https://patrick222-dotcom.github.io/705-v1/**`
(the github.io entry is kept so in-flight links and cached sessions still resolve).

**Known consequence, still open:** anonymous users' data is per-origin localStorage, so anyone who
used the app without an account on github.io sees an empty planner on badgebudget.com. Signed-in
users are unaffected (their data is in Supabase). No migration notice was built.

## Naming context

The app is still *branded* ScrubPay in `index.html`; only the domain moved. "ScrubPay" is crowded:
a healthcare payroll/ATS company launched on `scrubpay.app` + `scrubpay.org` in 2026-08, a 2014
Atlanta medical-bill app used the name, and SCRUBJAY is a registered USPTO mark in healthcare
staffing. `scrubpay.com` is investor-held on Atom.com. `BadgePay` was rejected: taken, and "badge
pay" already names employee-badge cafeteria/vending payment systems.

## Google OAuth consent screen

It still shows `mnnlgcxnvodjwlhhiphq.supabase.co`. That string is the host of the OAuth callback,
which lives on Supabase, so it is not changeable from the app or from Google Cloud Console. The only
fix is a Supabase Custom Domain: Pro plan (from $25/mo) plus the custom-domain add-on ($10/mo) —
not worth it at current scale. The free improvement is setting the app name + logo on the GCP OAuth
consent screen (the more prominent branding anyway); not yet done. PR #46 is an in-app copy
workaround ("Google will ask you to continue to supabase.co…"), open and undecided.
