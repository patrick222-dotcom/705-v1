# The Siri Shortcuts — build guide, wire contract, drift-proofing

Companion to `agent-gateway-scope.md` → Path B. That section says *why* an inbox; this file is what the
owner holds while building the Shortcuts on a phone, plus the contract the `siri-ingest` function
honours so the Shortcuts never have to change. Written 2026-09-05 after Session A shipped (#70);
the v1.1 / v2 items below are **Session B scope** and are marked as such.

## The one rule

**Everything that can change lives on the server. The Shortcut is a shell.** An iCloud share link is a
snapshot, an installed copy is the recipient's own frozen object, and Shortcuts has no update channel.
So the shell collects inputs, makes one or two POSTs, and shows what the server says. Menus, wording,
validation, versions and the install link all come from the server. If the shell itself ever has to
change, every user deletes and re-adds — treat the shell like a migration: test once, then leave it.

## Privacy boundary (the Siri code)

A Siri code is **write-only for data and read-only for template names.** With a code, the function will
enqueue proposed ops and will return the nurse's shift-template names and hours (so menus can be
hers). It will **never** return pay figures, differentials, logged shifts or dates she is working —
a leaked code must not tell anyone when a nurse is away from home. Anything the "Plan shifts" flow
knows about her calendar comes from **her own iPhone calendar, on-device**; only bare dates ever
leave the phone, never event titles, and the server does not store them. This is Invariant 14's
scope; widen it only by a deliberate owner decision.

## Server contract (Session B — `siri-ingest` v4)

Everything below is additive to the v3 function shipped in #70.

**Client envelope.** The Shortcut always sends `"client":"shortcut"` and `"v":<shell version>`.
When `client` is `shortcut`, the function answers **HTTP 200 for every expected outcome** and puts
the outcome in `status` — because Shortcuts' *Get Contents of URL* treats any 4xx/5xx as a failure
and **halts the whole Shortcut with its own error alert**, so a 401 can never reach the branch that
deletes a stale code file. Non-Shortcut callers (curl, tests) keep the v3 status codes.

```
{ "status": "queued" | "error" | "update",
  "message": "plain English, one line — this is what the Shortcut shows/speaks",
  "summary": "Fri Sep 12 · Night · 12h",          (queued)
  "queued": 1,                                     (queued)
  "error": "invalid_code" | "rate_limited" | …,    (error)
  "update_url": "https://www.icloud.com/shortcuts/…",  (update, or alongside queued when behind)
  "latest_v": 2 }
```
`status` is a **string**, compared as text in the Shortcut's If — JSON booleans round-trip through
Shortcuts as Yes/No and are unreliable in comparisons.

**Modes.**
- `mode:"meta"` — `{code, client, v}` → `{status:"ok", templates:[{label:"ICU night 12h", key:"…"}],
  update_url?, latest_v}`. Labels are display strings for *Choose from List*; keys are opaque.
  Template names and hours only.
- `mode:"form"` — as v3; also accepts `template: <key>` in place of `shiftType`/`hours`.
- `mode:"plan"` — `{code, client, v, from:"YYYY-MM-DD", to:"YYYY-MM-DD", busy:["YYYY-MM-DD",…]}` →
  `{status:"ok", days:["2026-09-12|Fri Sep 12 · ⚠︎ busy", "2026-09-13|Sat Sep 13 · weekend", …],
  templates:[…]}`. Pure date arithmetic plus the caller-supplied busy dates: weekend flag, pay-period
  boundary, "busy" marker. **No read of the nurse's shifts** (see Privacy boundary). `busy` is used
  for the response and discarded. Each label carries its ISO date before the `|` so the Shortcut can
  hand the picked labels straight back.
- `mode:"form_multi"` — `{code, client, v, dates:[<picked labels or ISO dates>], template:<key> |
  shiftType+hours}` → one `ops_inbox` row per date, `{status:"queued", queued:n, summary:"3 shifts:
  Fri Sep 12, Sat Sep 13, Tue Sep 16 · ICU night 12h"}`. Capped at 14 dates per call.
- `mode:"dictation"` — the transcript parse (the original Session B item); returns the same envelope.

**Version handshake.** `app_config` (migration 005: `key text pk, value text`, `anon` SELECT only on
this table, no other grants) holds `siri_shortcut_url`, `siri_shortcut_v`, `siri_plan_url`,
`siri_plan_v`. The function reads them per request; the Settings card reads them for its "Get the
Shortcut" links — **one row edit changes the link everywhere, no deploy**, and `SIRI_SHORTCUT_URL`
in `index.html` goes away. When a request's `v` is below the current one, every response carries
`update_url` + `latest_v`; the Shortcut shows the server's `message` and opens the link.

**Shell versions.** `v` is bumped only when the *shell* changes (a new action, a renamed key). Server
changes never bump it. The `message` for an update says "…install it, then delete the old one" —
iOS adds a re-added Shortcut as a new item rather than replacing it.

## Shortcut 1 — "Log a shift" (shell v1.1)

Prompts for a day, checks **her own calendar** for that day, offers **her** templates, queues one op.
Build after Session B ships, so the one Courtney installs is the one that never has to change.

| # | Action | Configuration |
|---|---|---|
| 1 | Get File | Shortcuts (iCloud) · `BadgeBudget/siri-code.txt` · Show Document Picker **off** · Error If Not Found **off** → `Code`. *If Save File in step 4 complains about the folder, create `BadgeBudget` once in Files → iCloud Drive → Shortcuts.* |
| 2 | If | `Code` has no value |
| 3 | ↳ Ask for Input | Text · "Paste your BadgeBudget Siri code (open the app → Settings → Siri)" |
| 4 | ↳ Save File | Shortcuts (iCloud) · `BadgeBudget/siri-code.txt` · Overwrite **on** · Ask Where To Save **off** |
| 5 | ↳ Set Variable | `Code` ← Provided Input · **End If** |
| 6 | Dictionary | `code`: Code · `client`: `shortcut` · `v`: **1** (Number) · `mode`: `meta` |
| 7 | Get Contents of URL | `https://mnnlgcxnvodjwlhhiphq.supabase.co/functions/v1/siri-ingest` · POST · Header `Content-Type: application/json` · Body JSON = step 6 → `Meta` |
| 8 | Get Dictionary Value | `status` from `Meta` → `MetaStatus` |
| 9 | If | `MetaStatus` is `error` → Get Dictionary Value `message` → Show Result "BadgeBudget: [message]"; Get Dictionary Value `error`; If it is `invalid_code` → Delete Files `BadgeBudget/siri-code.txt` (Ask Before Deleting **off**) · End If · **Stop Shortcut** · End If |
| 10 | If | `MetaStatus` is `update` → Get Dictionary Value `message` → Show Result; Get Dictionary Value `update_url` → Open URLs · **Stop Shortcut** · End If |
| 11 | Ask for Input | Date · "Which day?" · Default Current Date → `Day` |
| 12 | Find Calendar Events | Filter: Start Date **is in** `Day` (whole day) · Calendar: **All** (or the ones she chooses) · Sort Start Date → `Events` |
| 13 | If | `Events` has any value → Get Details of Calendar Events (Title + Start Date for each; Combine Text with new lines) → **Show Alert** "On [Day] you have:\n[list]\nStill log a shift?" (Cancel stops the Shortcut) · End If. *Titles are displayed on the phone only; nothing from this step is sent.* |
| 14 | Get Dictionary Value | `templates` from `Meta` → Get Dictionary Value `label` (for each) → **Choose from List** "Which shift?" → `Pick` |
| 15 | Get Dictionary Value | `key` of the matching template → `Template` *(or: build the list as "label" and let the server match on label — either is fine; server accepts both `template` key and label)* |
| 16 | Format Date | `Day` · Custom · `yyyy-MM-dd` → `DateKey` |
| 17 | Dictionary | `code`: Code · `client`: `shortcut` · `v`: **1** · `mode`: `form` · `op`: {Dictionary} `type`: `add_shift`, `date`: DateKey, `template`: Template |
| 18 | Get Contents of URL | same URL/headers · Body JSON = step 17 → `Result` |
| 19 | Get Dictionary Value | `status` from `Result` → `Status`; Get Dictionary Value `message` → `Message` |
| 20 | If | `Status` is `queued` → Show Result "[Message]" *(server text: "Queued: Fri Sep 12 · ICU night 12h. Open BadgeBudget to confirm.")* |
| 21 | Otherwise | Show Result "BadgeBudget: [Message]" · If `error` is `invalid_code` → Delete Files `BadgeBudget/siri-code.txt` · End If · **End If** |
| 22 | If | `Result` → `update_url` has any value → Show Result "[Message]" → Open URLs `update_url` · End If |

Siri phrase = the Shortcut name, **"Log a shift"**. Show in Share Sheet off. Action Button optional.

## Shortcut 2 — "Plan shifts" (shell v1, Session B)

The owner's ask: *"check my calendar for dates xx/xx to xx/xx so I know of any blockers before
selecting potential shifts."* Range in, blockers surfaced from her own calendar, several days picked
at once, one template, N proposed shifts queued for per-item confirm in the app.

| # | Action | Configuration |
|---|---|---|
| 1–5 | *(same code-file block as Shortcut 1)* | |
| 6 | Ask for Input | Date · "From which day?" → `From` |
| 7 | Ask for Input | Date · "Through which day?" · Default `From` → `To` |
| 8 | Find Calendar Events | Start Date **is after** `From` (Adjust Date −1 day) **and** Start Date **is before** `To` (Adjust Date +1 day) · Calendar: All or her choice · Sort Start Date → `Events` |
| 9 | Repeat with Each | `Events` → Format Date (Start Date · Custom · `yyyy-MM-dd`) → **Add to Variable** `BusyDates` · End Repeat. *Dates only. Titles stay on the phone.* |
| 10 | Format Date ×2 | `From`, `To` → `yyyy-MM-dd` → `FromKey`, `ToKey` |
| 11 | Dictionary | `code`, `client`: `shortcut`, `v`: 1, `mode`: `plan`, `from`: FromKey, `to`: ToKey, `busy`: BusyDates (Array) |
| 12 | Get Contents of URL | POST → `Plan` |
| 13 | *(status / update handling as steps 8–10 of Shortcut 1)* | |
| 14 | Get Dictionary Value | `days` from `Plan` → **Choose from List** · Prompt "Pick the days to work" · **Select Multiple on** → `Picked` |
| 15 | Get Dictionary Value | `templates` → labels → **Choose from List** "Which shift?" → `Template` |
| 16 | Dictionary | `code`, `client`, `v`, `mode`: `form_multi`, `dates`: Picked (Array), `template`: Template |
| 17 | Get Contents of URL | POST → `Result` |
| 18 | *(status / message / update handling as steps 19–22 of Shortcut 1)* | |

Optional step between 13 and 14: **Show Alert** listing the busy days with their titles (from
`Events`, on-device) so she sees *what* the blocker is before the picker; the picker itself only shows
"⚠︎ busy". If she keeps BadgeBudget's own `.ics` export or calendar subscription in her iPhone
calendar, "already working" days show up as busy automatically — the server is never asked.

## Test checklist (owner, once per shell version)

1. Fresh install from the iCloud link on a phone with no code file → prompts for the code → saves it.
2. Revoke the code in Settings → next run shows the server's message and the code file is deleted →
   run again prompts for a new code.
3. Pick a day with a personal event → the alert names it; Cancel stops; Continue proceeds.
4. Templates in the picker match Settings → templates by name.
5. Queued shift appears in the app's "From Siri" sheet within ~15 s; Add puts it on the calendar;
   Skip leaves it off.
6. Bump `siri_shortcut_v` in `app_config` to 99 → next run shows the update message and opens the
   link; set it back.
7. "Plan shifts": a 10-day range with two personal events → those two days show ⚠︎; pick three days →
   three rows in the sheet, each individually confirmable.

## Publishing a new shell version

Edit the Shortcut → Share → Copy iCloud Link → update `app_config.siri_shortcut_url` and bump
`siri_shortcut_v` (one SQL update, no deploy). Every installed copy learns on its next run. Do this
rarely; that is the whole point of the design.
