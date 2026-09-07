# The Siri Shortcuts — build guide, wire contract, drift-proofing

Companion to `agent-gateway-scope.md` → Path B. That section says *why* an inbox; this file is what the
owner holds while building the Shortcuts on a phone, plus the contract the `siri-ingest` function
honours so the Shortcuts never have to change. Written 2026-09-05 after Session A shipped (#70) and
revised the same evening for hour-level calendar conflicts. The **Server contract** shipped the same
evening as `siri-ingest` v4 + migration 005 (Session B); its *As built* subsection records the
deviations. What remains is the owner's: build the two Shortcuts below, run the test checklist, paste
the two iCloud links into `app_config`.

## The one rule

**Everything that can change lives on the server. The Shortcut is a shell.** An iCloud share link is a
snapshot, an installed copy is the recipient's own frozen object, and Shortcuts has no update channel.
So the shell collects inputs, reads the phone's own calendar, makes one or two POSTs, and shows what
the server says. Menus, wording, validation, versions and the install link all come from the server.
If the shell itself ever has to change, every user deletes and re-adds — treat the shell like a
migration: test once, then leave it.

## Privacy boundary (the Siri code, and the calendar)

Two separate promises, both explainable to a unit of nurses in one breath each.

**The Siri code can queue shifts and can read your shift templates (name, start time, hours). Nothing
else.** It never returns pay figures, differentials, logged shifts or the dates you are working — a
leaked code must not tell anyone when a nurse is away from home.

**Your calendar never leaves your phone.** The conflict check runs entirely on-device with the
Shortcuts *Find Calendar Events* action against the iPhone's Calendar, which already aggregates
Gmail, iCloud, Outlook and any shared or subscribed calendars (a spouse's, the family one, the unit's).
Titles, times and even dates stay on the phone; the server only ever receives the shift dates you
chose to queue. That is Invariant 14's scope; widen it only by a deliberate owner decision.

## Server contract (`siri-ingest` v4 — shipped 2026-09-05, Session B)

Additive to the v3 function shipped in #70. Deployed and proven with curl; see *As built* at the end of
this section for the exact error codes and the places the build differs from the text.

**Client envelope.** The Shortcut always sends `"client":"shortcut"` and `"v":<shell version>`.
When `client` is `shortcut`, the function answers **HTTP 200 for every expected outcome** and puts the
outcome in `status` — because Shortcuts' *Get Contents of URL* treats any 4xx/5xx as a failure and
**halts the whole Shortcut with its own error alert**, so a 401 could never reach the branch that
deletes a stale code file. Non-Shortcut callers (curl, tests) keep the v3 status codes.

```
{ "status": "queued" | "error" | "update" | "ok",
  "message": "plain English, one line — this is what the Shortcut shows/speaks",
  "summary": "Thu Sep 8 · Night 12h · 7:00 PM",        (queued)
  "queued": 1,                                          (queued)
  "error": "invalid_code" | "rate_limited" | …,         (error)
  "update_url": "https://www.icloud.com/shortcuts/…",   (update, or alongside any status when behind)
  "latest_v": 2 }
```
`status` is a **string**, compared as text in the Shortcut's If — JSON booleans round-trip through
Shortcuts as Yes/No and are unreliable in comparisons.

**Modes.**
- `mode:"meta"` — `{code, client, v}` → `{status:"ok", templates:[{label:"ICU night 12h",
  key:"…", start:"19:00", hours:12}, …], update_url?, latest_v}`. Labels feed *Choose from List*;
  `start` + `hours` let the phone compute the shift window for the conflict check. Names, start
  times and hours only — never rates.
- `mode:"form"` — as v3; also accepts `template:<key or label>` in place of `shiftType`/`hours`
  (resolved server-side to the template's shiftType/hours/start/bonus).
- `mode:"form_multi"` — `{code, client, v, dates:[…], template | shiftType+hours}` → one `ops_inbox`
  row per date, `{status:"queued", queued:n, summary:"3 shifts · ICU night 12h · Thu Sep 8, Sat Sep
  10, Tue Sep 13"}`. Each date may be a bare ISO date **or a label that starts with one**
  (`"2026-09-08 | Thu Sep 8 · has plans"`); the function reads the leading date and ignores the
  rest. Cap 14 dates per call.
- `mode:"dictation"` — `{transcript, today, tz}` → parsed to ops with a forced JSON schema, validated
  through the same allowlist, one summary line per op; transcript kept on the row for "Siri heard: …"
  and deleted with it.
- There is deliberately **no server-side calendar or planning mode.** Day labels are built on the
  phone (see Shortcut 2), so the server never learns which days she has plans.

**Version handshake.** `app_config` (migration 005: `key text pk, value text`; `anon` and
`authenticated` SELECT only; no other grants; public values only) holds `siri_shortcut_url`,
`siri_shortcut_v`, `siri_plan_url`, `siri_plan_v`. The function reads them per request (cache ≤ 60 s);
the Settings card reads them for its two install links — **one row edit changes a link everywhere, no
deploy**, and `SIRI_SHORTCUT_URL` in `index.html` goes away. When a request's `v` is below the current
one, every response carries `update_url` + `latest_v`; a shell too old to be safe gets
`status:"update"`. The `message` says "…install it, then delete the old one" — iOS adds a re-added
Shortcut as a new item rather than replacing it.

**Shell versions.** `v` is bumped only when the *shell* changes (a new action, a renamed key). Server
changes never bump it.

### As built — Session B (2026-09-05)

Shipped as `siri-ingest` v4 + migration `005_app_config.sql` against the contract above. Deviations and
additions, all deliberate:

- **No server-side calendar or planning mode**, as the contract says: `mode:"plan"` answers `bad_mode`.
  The Plan shell's only write is `form_multi`, which reads the leading `YYYY-MM-DD` of each label and
  ignores the rest.
- **Every response carries both `ok` (boolean) and `status` (string)** whichever client sent it, so a
  curl test and a Shortcut see one shape; only the HTTP code differs (Shortcut → always 200; others →
  401 invalid_code · 400 bad_json / bad_mode / bad_op / bad_date / bad_dates / bad_hours /
  bad_shift_type / bad_start / bad_kind / bad_text / bad_template / too_many_dates / bad_transcript ·
  404 no_templates · 405 · 413 · 422 nothing_understood · 426 update_required · 429 rate_limited /
  too_many_pending · 502 queue_failed / dictation_failed · 503 dictation_unavailable · 500 internal).
  `no_templates` exists so the shell's *Choose from List* never receives an empty array — the shell's
  error branch shows the message ("Save a shift template in BadgeBudget first…") and stops.
- **Handshake details.** A shell is *behind* when `v` < `siri_<shell>_v`; the response then carries
  `latest_v` always and `update_url` when that row is non-empty, and the `message` gains the sentence
  "A newer Shortcut is available — install it, then delete this copy." *Too old to be safe* is `v` <
  the optional `siri_<shell>_min_v` row (default 1; insert the row to force an update, delete it to
  relax) → `status:"update"`, nothing processed. A non-Shortcut caller that sends no `v` gets no
  handshake at all. Which shell: `form_multi` is always the Plan shell; every other mode is the
  Log-a-shift shell unless the body says `"shell":"plan"` — **so add `shell`: `plan` to the Plan
  Shortcut's dictionaries (steps 6 and 20 below)**, or its `meta` call is compared against
  `siri_shortcut_v`.
- **`meta` reads `data->templates` only** — a PostgREST JSON-path select — so pay settings, logged
  shifts and goals never enter the function. A template without a start time is reported with a
  default for the phone's conflict window (19:00 night / weekend night, 15:00 weekday evening, 07:00
  otherwise); that default is never written into a queued op. `key` is the template's `id` as a string,
  `label` its name; `template:` in `form` / `form_multi` matches key first, then name
  (case-insensitive) — and, since 2026-09-07 (function version 6), it also accepts **the whole picked
  meta item** in any shape a Shortcut hands over: a JSON object, that object coerced to JSON text by a
  Text-typed field, or Shortcuts' `label: …` line form. The shell stays frozen; the server absorbs the
  shape.
- **Template-resolved ops carry the template's pay shape:** `payload` gets `templateId`, `templateName`
  and, when set, `bonusType` / `customBonus`; the app's `siriShiftFromOp` honours them and the sheet
  line names the template ("Add “ICU night 12h” — Night shift, 12h from 7:00 PM, on Tue, Sep 8").
- **Batches without a new column.** `form_multi` and `dictation` rows share `payload.batch` (a UUID);
  the sheet groups on it. Multi-row responses add `lines[]` (one summary per row) beside the one-line
  `summary`.
- **Limits with multi-row calls.** The 10-rows-per-minute check runs before the insert, so one batch of
  up to 14 passes on a quiet minute and the next minute is throttled; the pending cap is enforced as
  pending + n ≤ 20 (`too_many_pending`). Both run before the model call in dictation, so a leaked code
  can't spend API calls past the limits.
- **Dictation.** `claude-haiku-4-5` through `npm:@anthropic-ai/sdk`, one forced call of a strict tool
  `queue_ops` — `{ops:[{type, date, shiftType, hours, start, template, kind, text}]}`, every field
  required, empty string / 0 meaning "not said" — with a Sun–Sat calendar from `today`−7 to `today`+60
  and the template names in the system prompt, so dates are looked up, never computed. `today` defaults
  to the current date in `tz`; `tz` defaults to `America/New_York` when missing or invalid (the Shortcut
  can send it with *Format Date* → custom `VV`). Parsed ops go through the same `buildOp` as form, one
  op per day per kind, invalid ones dropped; zero survivors → `nothing_understood`. The model id can be
  overridden without a deploy via the optional `app_config` row `siri_dictation_model`. **The
  `ANTHROPIC_API_KEY` function secret is not set yet**, so the live function answers
  `dictation_unavailable`: the pipeline around the model call is proven, the call itself is not. The
  transcript goes to the Anthropic API and is stored on the rows for "Siri heard: …"; it is never
  logged and never enters `events`.
- **`app_config` extras:** a `*_url` row must be '' or start with `https://` (a table check, and the
  card checks again before rendering a link); `updated_at` is kept by a trigger; the optional rows
  `siri_shortcut_min_v`, `siri_plan_min_v` and `siri_dictation_model` are read when present.
- **Verification.** Migration 005 applied live through the MCP (`20260905184845 app_config`): RLS on,
  one SELECT policy for `anon` + `authenticated`, table and column grants SELECT only, 4 seed rows,
  advisors unchanged. Function proven with curl on a throwaway user carrying two codes (one revoked) and
  a templates-only blob: non-Shortcut 401 / 405 / 400 / 503 / 200; Shortcut envelope 200 + `status` for
  invalid code, bad op, bad template, bad date, 15 dates, pending overflow and the 10-a-minute burst;
  `meta` returned names + start + hours and nothing else; `form_multi` made 3 rows from 4 labels;
  bumping `siri_shortcut_v` → fields + message on ok and error responses with the Plan shell unaffected,
  `min_v` → `status:"update"` (200) and 426 for a plain caller, reset → clean. The user was deleted and
  `app_config` is back at its seed. App gate 62/62 (prod React) and 63/63 (dev React) with the hero,
  stats and breakdown byte-identical to the deployed build.

## Shortcut 1 — "Log a shift" (shell v1.1)

Template first (so the phone knows the shift's hours), then the day, then **only the calendar events
that overlap that window** are shown, then one op is queued. Build after Session B ships, so the one
Courtney installs is the one that never has to change.

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
| 11 | Get Dictionary Value | `templates` from `Meta` → **Choose from List** "Which shift?" (items show each template's `label`) → `Pick`; then Get Dictionary Value `start` → `Start` and `hours` → `Hours` from the picked template |
| 12 | Ask for Input | Date · "Which day?" · Default Current Date → `Day` |
| 13 | Format Date | `Day` · Custom · `yyyy-MM-dd` → `DateKey` |
| 14 | Text → Get Dates from Input | Text `[DateKey] [Start]` (e.g. `2026-09-08 19:00`) → **Get Dates from Input** → `ShiftStart` |
| 15 | Adjust Date | `ShiftStart` · Add `Hours` hours → `ShiftEnd` *(a 7 PM start + 12 h correctly ends at 7 AM the next day)* |
| 16 | Find Calendar Events | Filters (All of the following): **Start Date is before** `ShiftEnd` **and End Date is after** `ShiftStart` · Calendar: **All** (or the ones she chooses — shared and subscribed calendars are included) · Sort Start Date → `Conflicts` |
| 17 | If | `Conflicts` has any value → Repeat with Each: Text `[Title] · [Start Date, time] – [End Date, time]` → Add to Variable `Lines` · End Repeat → **Show Alert** title "Overlaps your [Pick] on [Day]" · message = `Lines` · "Still log it?" (Cancel stops the Shortcut) · End If. *Titles and times are displayed on the phone only; nothing from this step is sent.* |
| 18 | Dictionary | `code`: Code · `client`: `shortcut` · `v`: **1** · `mode`: `form` · `op`: {Dictionary} `type`: `add_shift`, `date`: DateKey, `template`: Pick |
| 19 | Get Contents of URL | same URL/headers · Body JSON = step 18 → `Result` |
| 20 | Get Dictionary Value | `status` from `Result` → `Status`; Get Dictionary Value `message` → `Message` |
| 21 | If | `Status` is `queued` → Show Result "[Message]" *(server text: "Queued: Thu Sep 8 · ICU night 12h. Open BadgeBudget to confirm.")* |
| 22 | Otherwise | Show Result "BadgeBudget: [Message]" · If `error` is `invalid_code` → Delete Files `BadgeBudget/siri-code.txt` · End If · **End If** |
| 23 | If | `Result` → `update_url` has any value → Show Result "[Message]" → Open URLs `update_url` · End If |

Siri phrase = the Shortcut name, **"Log a shift"**. Show in Share Sheet off. Action Button optional.
With the owner's example: dentist 9:00–10:00 AM on Thu 9/8 → picking **Night 12h** finds no overlap
and queues silently; picking **Day 12h** stops on the alert naming the appointment.

### Review of the Siri-generated build (2026-09-07)

The owner generated "Log a shift" with the Shortcuts app's own AI and shared the signed file; it was
decoded (AEA profile 0 → Apple Archive → `Shortcut.wflow`, 57 actions, client 5037) and checked action
by action against the table above. **Matches the contract:** the code-file block (Get File without
erroring, Ask → Save with overwrite → the file's text as `code`, both calls wired to that same output),
the meta call (`client`, `v` as a Number, `mode`), the `status` branches (error → message + delete the
code file on `invalid_code`; update → message + open `update_url`; otherwise → the flow — built with
the app's newer *Otherwise If*, fine on the OS that generated it), the `yyyy-MM-dd` date, the form
call's `op` `{type: add_shift, date, template}`, per-call `invalid_code` handling and the trailing
`update_url` handling. Nothing but the code, the shell version and the op leaves the phone. Three
things to know:

1. **`template` is the whole picked item.** *Choose from List* returns the template dictionary, and a
   Text-typed JSON field coerces it to JSON text, so the server received `{"label":…,"key":…,…}` where
   the contract said key-or-label — every real run would have ended in `bad_template`. Fixed on the
   server (see *As built*, `meta`), proven with the exact bytes the Shortcut sends, no change to the
   Shortcut needed.
2. **The conflict check is day-level and runs before the template pick:** *Find Calendar Events where
   Start Date is [the chosen day]*, then an alert listing titles. That is the simpler check the "Plan
   shifts" section argues for, not the hour-level window of steps 11–17 above, so a 9 AM dentist
   prompts even for a night shift. Verify on the phone that "Start Date **is** [date]" matches events
   on that day at all — if the alert never appears with an event present, change it to *is after*
   [day − 1 s] **and** *is before* [next day], or adopt steps 11–17.
3. **Confirm "Show Document Picker" is off on the first Get File.** The generated file sets the path
   but not the toggle; if the first run opens a file picker, flip it off and re-share.

## Shortcut 2 — "Plan shifts" (shell v1, Session B)

The owner's ask: *"check my calendar for dates xx/xx to xx/xx so I know of any blockers before
selecting potential shifts."* Template first, then a range; the phone reads its own calendar for the
range, shows what's there, builds the day list with markers itself, and queues N proposed shifts for
per-item confirm in the app. **No calendar data is sent.** The server contributes only the template
list and the queue.

| # | Action | Configuration |
|---|---|---|
| 1–11 | *(code-file block, meta call, status handling, template pick — exactly as Shortcut 1, steps 1–11, **plus `shell`: `plan` in the step-6 Dictionary** so the version check runs against `siri_plan_v`)* | |
| 12 | Ask for Input | Date · "From which day?" → `From` |
| 13 | Ask for Input | Date · "Through which day?" · Default `From` → `To` |
| 14 | Find Calendar Events | **Start Date is after** `From` (Adjust Date −1 day) **and Start Date is before** `To` (Adjust Date +2 days) · Calendar: All or her choice · Sort Start Date → `Events` |
| 15 | Repeat with Each | `Events` → Format Date (Start Date · Custom · `yyyy-MM-dd`) → **Add to Variable** `BusyKeys`; Text `[Start Date, short date] · [Title] · [Start Date, time]` → Add to Variable `Lines` · End Repeat |
| 16 | If | `Lines` has any value → **Show Alert** "On your calendar in that range" · message = `Lines` (Combine Text, new lines) · "Continue to pick days" (Cancel stops) · End If |
| 17 | Get Time Between Dates | `From` → `To` · in **Days** → `Span` |
| 18 | Repeat | `Span` + 1 times: **Adjust Date** `From` + (Repeat Index − 1) days → `D`; Format Date `D` → `yyyy-MM-dd` → `Key`; Format Date `D` → `EEE MMM d` → `Nice`; Format Date `D` → `EEE` → `Dow`; **Text** `[Key] | [Nice]`; If `BusyKeys` (as text) **contains** `Key` → append ` · has plans`; If `Dow` is `Sat` or `Sun` → append ` · weekend` → **Add to Variable** `DayList` · End Repeat |
| 19 | Choose from List | `DayList` · Prompt "Pick the days to work" · **Select Multiple on** → `Picked` |
| 20 | Dictionary | `code` · `client`: `shortcut` · `v`: 1 · `shell`: `plan` · `mode`: `form_multi` · `dates`: Picked (Array — the server reads the leading ISO date of each label) · `template`: Pick |
| 21 | Get Contents of URL | POST → `Result` |
| 22 | *(status / message / update handling as Shortcut 1, steps 20–23)* | |

Why day-level here rather than the exact overlap of Shortcut 1: a range picker needs one window per
day, and night shifts cross midnight, so exact per-day overlap in Shortcuts is fiddly logic living in
the frozen shell. The alert in step 16 shows every event **with its time**, so she judges "dentist at
9, night shift is fine" herself; the marker in the picker is a reminder, not a verdict. If she keeps
BadgeBudget's own `.ics` export or calendar subscription in her iPhone calendar, days she already
works show up as "has plans" automatically — the server is never asked.

## Test checklist (owner, once per shell version)

1. Fresh install from the iCloud link on a phone with no code file → prompts for the code → saves it.
2. Revoke the code in Settings → next run shows the server's message and the code file is deleted →
   run again prompts for a new code.
3. Put a 9–10 AM event on a day → "Log a shift" with a **Night** template queues silently; with a
   **Day** template it stops on the alert naming the event; Cancel stops, Continue proceeds.
4. A shared calendar's event (spouse / family) appears in the alert like any other.
5. Templates in the picker match Settings → templates by name.
6. Queued shift appears in the app's "From Siri" sheet within ~15 s; Add puts it on the calendar;
   Skip leaves it off.
7. Bump `app_config.siri_shortcut_v` to 99 → next run shows the update message and opens the link;
   set it back.
8. "Plan shifts": a 10-day range with two personal events → the alert lists both with times; those
   two days carry "· has plans" in the picker; pick three days → three rows in the sheet, each
   individually confirmable.

## Publishing a new shell version

Edit the Shortcut → Share → Copy iCloud Link → update `app_config.siri_shortcut_url` (or
`siri_plan_url`) and bump the matching `_v` (one SQL update, no deploy). Every installed copy learns on
its next run. Do this rarely; that is the whole point of the design.
