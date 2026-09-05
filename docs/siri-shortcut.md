# The Siri Shortcuts — build guide, wire contract, drift-proofing

Companion to `agent-gateway-scope.md` → Path B. That section says *why* an inbox; this file is what the
owner holds while building the Shortcuts on a phone, plus the contract the `siri-ingest` function
honours so the Shortcuts never have to change. Written 2026-09-05 after Session A shipped (#70) and
revised the same evening for hour-level calendar conflicts. Everything under **Server contract** is
**Session B scope**.

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

## Server contract (Session B — `siri-ingest` v4)

Additive to the v3 function shipped in #70.

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

## Shortcut 2 — "Plan shifts" (shell v1, Session B)

The owner's ask: *"check my calendar for dates xx/xx to xx/xx so I know of any blockers before
selecting potential shifts."* Template first, then a range; the phone reads its own calendar for the
range, shows what's there, builds the day list with markers itself, and queues N proposed shifts for
per-item confirm in the app. **No calendar data is sent.** The server contributes only the template
list and the queue.

| # | Action | Configuration |
|---|---|---|
| 1–11 | *(code-file block, meta call, status handling, template pick — exactly as Shortcut 1, steps 1–11)* | |
| 12 | Ask for Input | Date · "From which day?" → `From` |
| 13 | Ask for Input | Date · "Through which day?" · Default `From` → `To` |
| 14 | Find Calendar Events | **Start Date is after** `From` (Adjust Date −1 day) **and Start Date is before** `To` (Adjust Date +2 days) · Calendar: All or her choice · Sort Start Date → `Events` |
| 15 | Repeat with Each | `Events` → Format Date (Start Date · Custom · `yyyy-MM-dd`) → **Add to Variable** `BusyKeys`; Text `[Start Date, short date] · [Title] · [Start Date, time]` → Add to Variable `Lines` · End Repeat |
| 16 | If | `Lines` has any value → **Show Alert** "On your calendar in that range" · message = `Lines` (Combine Text, new lines) · "Continue to pick days" (Cancel stops) · End If |
| 17 | Get Time Between Dates | `From` → `To` · in **Days** → `Span` |
| 18 | Repeat | `Span` + 1 times: **Adjust Date** `From` + (Repeat Index − 1) days → `D`; Format Date `D` → `yyyy-MM-dd` → `Key`; Format Date `D` → `EEE MMM d` → `Nice`; Format Date `D` → `EEE` → `Dow`; **Text** `[Key] | [Nice]`; If `BusyKeys` (as text) **contains** `Key` → append ` · has plans`; If `Dow` is `Sat` or `Sun` → append ` · weekend` → **Add to Variable** `DayList` · End Repeat |
| 19 | Choose from List | `DayList` · Prompt "Pick the days to work" · **Select Multiple on** → `Picked` |
| 20 | Dictionary | `code` · `client`: `shortcut` · `v`: 1 · `mode`: `form_multi` · `dates`: Picked (Array — the server reads the leading ISO date of each label) · `template`: Pick |
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
