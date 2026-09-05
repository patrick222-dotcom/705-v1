// siri-ingest — Supabase Edge Function (Deno). v4 (Session B, 2026-09-05).
//
// Purpose: Path B of the agent gateway (docs/agent-gateway-scope.md → Path B; the wire contract is
// docs/siri-shortcut.md → "Server contract"). Two iOS Shortcuts ("Log a shift", "Plan shifts") POST
// here with the nurse's Siri code. The function validates the code and the op(s) and queues rows in
// public.ops_inbox. Nothing is written to user_data: the app lists queued rows in a "From Siri" sheet
// and the nurse taps Add or Skip per item. This function is the only writer to ops_inbox.
//
// MODES
//   form        one op (v3 shape; also accepts `template:<key or label>` in place of shiftType/hours)
//   form_multi  {dates[], template | shiftType+hours} → one row per date (cap 14); a date may be a
//               bare ISO date or a label that starts with one ("2026-09-08 | Thu Sep 8 · has plans")
//   meta        the nurse's shift templates as {label, key, start, hours} — names, start times and
//               hours only, never rates. Feeds the Shortcut's picker and its on-device conflict check.
//   dictation   {transcript, today, tz} → parsed by a small Claude model through a forced, strict
//               tool schema, then run through the SAME allowlist/coercions as form; invalid ops are
//               dropped; the transcript is stored on each row so the sheet can say "Siri heard: …".
//   There is deliberately NO calendar or planning mode: day labels and conflict markers are built on
//   the phone, so the server never learns which days she has plans.
//
// SHORTCUT ENVELOPE. When the body carries client:"shortcut", every expected outcome is HTTP 200 with
// a string `status` ("queued" | "ok" | "error" | "update") and a plain-English `message` — Shortcuts'
// Get Contents of URL halts the whole Shortcut on any 4xx/5xx, so a 401 could never reach the branch
// that deletes a stale code file. Every other caller (curl, tests) keeps the v3 status codes exactly.
//
// VERSION HANDSHAKE. public.app_config (migration 005; anon/authenticated SELECT only) holds
// siri_shortcut_url / siri_shortcut_v and siri_plan_url / siri_plan_v (+ optional *_min_v). Read per
// request, cached ≤ 60 s. A shell whose `v` is behind gets update_url + latest_v on every response; a
// shell below the minimum safe version gets status:"update" and nothing is processed.
//
// SECURITY (verify_jwt is OFF — the caller is a Shortcut holding a code, not a signed-in JWT — so
// this function defends itself; review carefully):
//   * The Siri code is a BEARER CREDENTIAL. It is hashed (SHA-256) and looked up by hash
//     (`siri_tokens.code_hash`); it is never logged, never echoed, never stored in plaintext anywhere.
//     Errors are deliberately vague. Unknown or revoked code → invalid_code. Nothing here can
//     enumerate users or codes.
//   * PRIVACY BOUNDARY (CLAUDE.md Invariant 14): a code can queue ops and read template names, start
//     times and hours. The template read selects `data->templates` only, so pay settings, logged
//     shifts and dates worked never even enter this process. Nothing else is ever returned.
//   * Rate limits per user: 10 inbox rows per 60 s and 20 pending at once → rate_limited /
//     too_many_pending (429 for non-Shortcut callers). A multi-row call must fit under the pending
//     cap; the per-minute check runs before it, so one batch passes and the next minute is throttled.
//   * Pending rows older than 7 days are expired on the way through, so a forgotten queue can't grow.
//   * Ops are allowlisted and validated with the same coercions the app's sanitizeData() applies:
//     finite 0<hours≤24, a real ISO date within ±400 days, shift type in the app's enum, event kind in
//     the app's enum, note trimmed and capped at the app's MAX_NOTE_LEN, bonus type in the app's enum.
//     Anything that fails is refused (form) or dropped (dictation) and is never queued.
//   * Dictation sends the transcript — and only the transcript plus a date calendar and the template
//     names — to the Anthropic Messages API with ANTHROPIC_API_KEY from the function's secrets. No pay
//     data, no shifts, no code. The transcript is never logged. Without the secret, dictation answers
//     dictation_unavailable and the other modes are unaffected.
//   * Inserts run with the service role (there is no client insert policy on ops_inbox). The
//     service-role client is created from the runtime's injected env and never leaves this process.
//
// Deploy: `supabase functions deploy siri-ingest --no-verify-jwt` (or the MCP deploy tool with
// verify_jwt=false). Secrets: ANTHROPIC_API_KEY (dictation only).

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import Anthropic from "npm:@anthropic-ai/sdk@0.124.0";

// ---- the app's enums, mirrored (index.html: DIFF_DEFAULTS keys minus 'overtime', EVENT_KINDS, MAX_NOTE_LEN, BONUS) ----
const SHIFT_TYPES = ["base", "night", "weekday-eve", "weekend-day", "weekend-eve", "holiday", "bonus-incentive"];
const SHIFT_ALIASES: Record<string, string> = {
  day: "base", days: "base", regular: "base", "day-regular": "base", "day-shift": "base",
  nights: "night", "night-shift": "night",
  evening: "weekday-eve", evenings: "weekday-eve", "weekday-evening": "weekday-eve",
  weekend: "weekend-day", "weekend-days": "weekend-day", "weekend-day-shift": "weekend-day",
  "weekend-night": "weekend-eve", "weekend-nights": "weekend-eve", "weekend-evening": "weekend-eve",
  bonus: "bonus-incentive", incentive: "bonus-incentive",
};
const SHIFT_LABEL: Record<string, string> = {
  base: "Day", night: "Night", "weekday-eve": "Weekday evening", "weekend-day": "Weekend day",
  "weekend-eve": "Weekend night", holiday: "Holiday", "bonus-incentive": "Bonus incentive",
};
const EVENT_KINDS = ["pto", "education", "appointment", "off"];
const EVENT_LABEL: Record<string, string> = { pto: "PTO", education: "Education", appointment: "Appointment", off: "Off" };
const BONUS_TYPES = ["none", "charge", "preceptor", "oncall", "custom"];   // the app's BONUS keys
const MAX_NOTE_LEN = 240;            // the app's MAX_NOTE_LEN — saveDayShifts() slices to this anyway
const MAX_TEMPLATES = 12;            // the app's MAX_TEMPLATES
const MAX_TEMPLATE_NAME = 40;
const DATE_WINDOW_DAYS = 400;
const DEFAULT_SHIFT_HOURS = 12;      // the Add-Shift sheet's own default when the Shortcut omits hours

const OPS = ["add_shift", "add_day_event", "set_note"];
const MODES = ["form", "form_multi", "meta", "dictation"];
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 10;
const MAX_PENDING = 20;
const EXPIRE_AFTER_DAYS = 7;
const MAX_BODY_BYTES = 8 * 1024;
const MAX_MULTI_DATES = 14;
const MAX_TRANSCRIPT = 2000;         // ops_inbox.transcript check
const CFG_TTL_MS = 60_000;
const CFG_KEYS = ["siri_shortcut_url", "siri_shortcut_v", "siri_shortcut_min_v",
                  "siri_plan_url", "siri_plan_v", "siri_plan_min_v", "siri_dictation_model"];
const DICTATION_MODEL_DEFAULT = "claude-haiku-4-5";   // small + fast: the parse is a lookup, not reasoning
const DICTATION_CAL_BACK = 7, DICTATION_CAL_FWD = 60; // calendar handed to the model so dates are looked up, never computed
const DEFAULT_TZ = "America/New_York";               // only used when the Shortcut sends neither `today` nor a valid `tz`

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
// Pre-envelope errors (we don't know the caller yet): {ok:false, status:"error", error, message}.
function bad(status: number, error: string, message: string): Response {
  return json(status, { ok: false, status: "error", error, message });
}

// ---- caller context + envelope ----
type Shell = "shortcut" | "plan";
type Handshake = { apply: boolean; behind: boolean; tooOld: boolean; latest: number; url: string };
type Ctx = { shortcut: boolean; hs: Handshake };
const NO_HS: Handshake = { apply: false, behind: false, tooOld: false, latest: 1, url: "" };

function reply(c: Ctx, http: number, body: Record<string, unknown>): Response {
  const out: Record<string, unknown> = { ...body };
  if (c.hs.apply && c.hs.behind) {
    out.latest_v = c.hs.latest;
    if (c.hs.url) {
      out.update_url = c.hs.url;
      if (typeof out.message === "string" && out.status !== "update") {
        out.message = `${out.message} A newer Shortcut is available — install it, then delete this copy.`;
      }
    }
  }
  return json(c.shortcut ? 200 : http, out);
}
const fail = (c: Ctx, http: number, error: string, message: string) =>
  reply(c, http, { ok: false, status: "error", error, message });

// ---- app_config: public, owner-edited; cached per isolate ≤ 60 s ----
type Cfg = Record<string, string>;
let cfgCache: { at: number; map: Cfg } = { at: 0, map: {} };
async function loadConfig(): Promise<Cfg> {
  if (Date.now() - cfgCache.at < CFG_TTL_MS) return cfgCache.map;
  const { data, error } = await admin!.from("app_config").select("key, value").in("key", CFG_KEYS);
  if (error) return cfgCache.map;                       // stale beats none; an empty map just disables the handshake
  const map: Cfg = {};
  for (const r of (data ?? []) as { key: string; value: string }[]) map[r.key] = r.value;
  cfgCache = { at: Date.now(), map };
  return map;
}
const cfgInt = (cfg: Cfg, key: string, dflt: number) => {
  const n = Math.floor(Number(cfg[key]));
  return Number.isFinite(n) && n >= 0 ? n : dflt;
};
function handshake(cfg: Cfg, shell: Shell, rawV: unknown, isShortcut: boolean): Handshake {
  const hasV = rawV != null && rawV !== "";
  if (!hasV && !isShortcut) return NO_HS;              // a plain API caller that says nothing about its version isn't a shell
  const vNum = Math.floor(Number(rawV));
  const v = Number.isFinite(vNum) && vNum >= 0 ? vNum : 0;   // a shell that sends no/garbage v is v0
  const latest = cfgInt(cfg, `siri_${shell}_v`, 1);
  const minV = cfgInt(cfg, `siri_${shell}_min_v`, 1);
  const url = typeof cfg[`siri_${shell}_url`] === "string" && /^https:\/\//.test(cfg[`siri_${shell}_url`]) ? cfg[`siri_${shell}_url`] : "";
  return { apply: true, behind: v < latest, tooOld: v < minV, latest, url };
}

// ---- code handling: accept "BB-XXXX-XXXX-XXXX-XXXX" with or without dashes/prefix/case, hash the canonical form ----
const CODE_BODY_RE = /^[A-HJ-NP-Z2-9]{16}$/;   // the app's SIRI_CODE_CHARS alphabet (no 0/O/1/I)
function canonicalCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length === 18 && s.startsWith("BB")) s = s.slice(2);
  if (!CODE_BODY_RE.test(s)) return null;
  return `BB-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
}
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- field coercions (mirror sanitizeData) ----
type ISODate = { y: number; m: number; d: number; key: string };
function parseDate(raw: unknown): ISODate | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(s)) return null;      // "2026-09-12" or an ISO datetime — take the date part
  const key = s.slice(0, 10);
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;   // Feb 30 etc.
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (Math.abs((dt.getTime() - todayUTC) / 86_400_000) > DATE_WINDOW_DAYS) return null;
  return { y, m, d, key };
}
function dateLabel(d: ISODate): string {
  const dt = new Date(Date.UTC(d.y, d.m - 1, d.d));
  return `${DOW[dt.getUTCDay()]} ${MON[d.m - 1]} ${d.d}`;
}
// Hours: finite and within the app's range. `required` false → absent is fine (returns undefined).
function parseHours(raw: unknown, opts: { min: number; required: boolean }): number | null | undefined {
  if (raw == null || raw === "") return opts.required ? null : undefined;
  const n = typeof raw === "string" ? Number(raw.trim().replace(/h(ours?)?$/i, "")) : Number(raw);
  if (!Number.isFinite(n) || n < opts.min || n > 24) return null;
  if (opts.min === 0 && n === 0) return 0;
  return Math.round(n * 100) / 100;
}
function parseShiftType(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const k = raw.trim().toLowerCase().replace(/[\s_]+/g, "-");
  const t = SHIFT_ALIASES[k] || k;
  return SHIFT_TYPES.includes(t) ? t : null;
}
const pad = (n: number) => String(n).padStart(2, "0");
// Start time → "HH:MM" (the app's TIME_RE). undefined = absent, null = present but unreadable.
function parseStart(raw: unknown): string | null | undefined {
  if (raw == null || raw === "") return undefined;
  if (typeof raw !== "string") return null;
  const s = raw.trim().toUpperCase();
  let m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) { const h = +m[1], mi = +m[2]; return (h <= 23 && mi <= 59) ? `${pad(h)}:${pad(mi)}` : null; }
  m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*([AP])\.?\s*M?\.?$/);
  if (m) {
    let h = +m[1]; const mi = +(m[2] || "0");
    if (h < 1 || h > 12 || mi > 59) return null;
    if (m[3] === "P" && h !== 12) h += 12;
    if (m[3] === "A" && h === 12) h = 0;
    return `${pad(h)}:${pad(mi)}`;
  }
  return null;
}
function time12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${pad(m)} ${h >= 12 ? "PM" : "AM"}`;
}
const fmtHours = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(h * 10 % 1 ? 2 : 1)}h`;

// ---- templates: the ONE read a code is allowed (names, start, hours; never rates) ----
type Tpl = { key: string; label: string; shiftType: string; hours: number; start?: string; bonusType: string; customBonus: number };
async function loadTemplates(uid: string): Promise<Tpl[]> {
  // PostgREST JSON-path select: only data->templates crosses the wire. Pay settings, logged shifts,
  // goals and everything else in the blob never enter this function.
  const { data, error } = await admin!.from("user_data").select("templates:data->templates").eq("user_id", uid).maybeSingle();
  if (error || !data) return [];
  const raw = (data as { templates?: unknown }).templates;
  if (!Array.isArray(raw)) return [];
  const out: Tpl[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const o = t as Record<string, unknown>;
    if (typeof o.name !== "string" || !o.name.trim() || o.name.length > MAX_TEMPLATE_NAME) continue;
    const shiftType = parseShiftType(o.shiftType);
    const hours = parseHours(o.hours, { min: 0.1, required: true });
    if (!shiftType || hours == null) continue;
    const key = (typeof o.id === "string" || typeof o.id === "number") ? String(o.id) : "";
    if (!key) continue;
    const start = parseStart(o.start);
    const bonusType = typeof o.bonusType === "string" && BONUS_TYPES.includes(o.bonusType) ? o.bonusType : "none";
    const cb = Number(o.customBonus);
    const customBonus = bonusType === "custom" && Number.isFinite(cb) && cb >= 0 ? Math.min(cb, 9999) : 0;
    out.push({ key, label: o.name.trim(), shiftType, hours, ...(start ? { start } : {}), bonusType, customBonus });
    if (out.length >= MAX_TEMPLATES) break;
  }
  return out;
}
function findTemplate(tpls: Tpl[], ref: unknown): Tpl | null {
  if (typeof ref !== "string" && typeof ref !== "number") return null;
  const s = String(ref).trim();
  if (!s) return null;
  return tpls.find((t) => t.key === s) ?? tpls.find((t) => t.label.toLowerCase() === s.toLowerCase()) ?? null;
}
// For the phone's conflict window when a template has no start time: 12 h hospital shifts start at
// 07:00 / 19:00, evenings at 15:00. Never written into a queued op — meta only.
const defaultStart = (shiftType: string) =>
  (shiftType === "night" || shiftType === "weekend-eve") ? "19:00" : shiftType === "weekday-eve" ? "15:00" : "07:00";

// ---- op validation: returns the row to queue, or an error ----
type Built = { ok: true; op: string; payload: Record<string, unknown>; summary: string } | { ok: false; error: string; message: string };
const err = (error: string, message: string): Built => ({ ok: false, error, message });
function buildOp(op: string, f: Record<string, unknown>, tpl: Tpl | null): Built {
  const date = parseDate(f.date);
  if (!date) return err("bad_date", "I need a date like 2026-09-12, within about a year of today.");
  const when = dateLabel(date);

  if (op === "add_shift") {
    if (tpl) {
      // The template is authoritative for the pay shape; the row remembers which one so the sheet can say so.
      const payload: Record<string, unknown> = { date: date.key, shiftType: tpl.shiftType, hours: tpl.hours, templateId: tpl.key, templateName: tpl.label };
      if (tpl.start) payload.start = tpl.start;
      if (tpl.bonusType !== "none") { payload.bonusType = tpl.bonusType; if (tpl.bonusType === "custom") payload.customBonus = tpl.customBonus; }
      return { ok: true, op, payload, summary: `${when} · ${tpl.label}${tpl.start ? ` · ${time12(tpl.start)}` : ""}` };
    }
    const shiftType = parseShiftType(f.shiftType ?? f.shift_type ?? f.type);
    if (!shiftType) return err("bad_shift_type", "Shift type should be Day, Night, Weekend day, Weekend night, Weekday evening, Holiday or Bonus incentive.");
    const hoursRaw = (f.hours == null || f.hours === "") ? DEFAULT_SHIFT_HOURS : f.hours;   // omitted → the sheet's 12h default
    const hours = parseHours(hoursRaw, { min: 0.1, required: true });
    if (hours == null) return err("bad_hours", "Hours should be a number between 0 and 24.");
    const start = parseStart(f.start ?? f.time);
    if (start === null) return err("bad_start", "Start time should look like 19:00 or 7:00 PM.");
    const payload: Record<string, unknown> = { date: date.key, shiftType, hours };
    if (start) payload.start = start;
    const summary = `${when} · ${SHIFT_LABEL[shiftType]} · ${fmtHours(hours)}${start ? ` · ${time12(start)}` : ""}`;
    return { ok: true, op, payload, summary };
  }

  if (op === "add_day_event") {
    const kindRaw = typeof f.kind === "string" ? f.kind.trim().toLowerCase() : "";
    const kind = kindRaw === "appt" ? "appointment" : kindRaw === "requested-off" || kindRaw === "day off" || kindRaw === "day-off" ? "off" : kindRaw;
    if (!EVENT_KINDS.includes(kind)) return err("bad_kind", "Kind should be PTO, Education, Appointment or Off.");
    const hours = parseHours(f.hours, { min: 0, required: false });
    if (hours === null) return err("bad_hours", "Hours should be a number between 0 and 24.");
    const payload: Record<string, unknown> = { date: date.key, kind };
    if (hours !== undefined) payload.hours = hours;
    const summary = `${when} · ${EVENT_LABEL[kind]}${hours !== undefined ? ` · ${fmtHours(hours)}` : ""}`;
    return { ok: true, op, payload, summary };
  }

  if (op === "set_note") {
    const text = typeof f.text === "string" ? f.text.trim().slice(0, MAX_NOTE_LEN) : "";
    if (!text) return err("bad_text", "The note was empty.");
    const short = text.length > 60 ? text.slice(0, 59) + "…" : text;
    return { ok: true, op, payload: { date: date.key, text }, summary: `${when} · Note: ${short}` };
  }

  return err("bad_op", "I can add a shift, add a day event, or set a note.");
}
const normOp = (raw: unknown) => (typeof raw === "string" ? raw : "").trim().toLowerCase().replace(/[\s-]+/g, "_");

// ---- dictation: transcript → ops through a forced, strict tool schema ----
function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function dowOf(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
function validTz(tz: unknown): string | null {
  if (typeof tz !== "string" || !tz.trim()) return null;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz.trim() }); return tz.trim(); } catch { return null; }
}
function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
const QUEUE_OPS_TOOL: Anthropic.Tool = {
  name: "queue_ops",
  description: "Record the shift-calendar changes the nurse asked for, one op per calendar day. Include only what was clearly said; if the request is not about her schedule, return an empty list.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      ops: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: OPS },
            date: { type: "string", description: "YYYY-MM-DD, taken from the calendar in the instructions" },
            shiftType: { type: "string", enum: ["", ...SHIFT_TYPES], description: "empty unless type is add_shift and no template is named" },
            hours: { type: "number", description: "hours spoken, or 0 when not said" },
            start: { type: "string", description: "start time as 24h HH:MM when spoken, else empty" },
            template: { type: "string", description: "exact name of one of her templates when she names it, else empty" },
            kind: { type: "string", enum: ["", ...EVENT_KINDS], description: "for add_day_event only" },
            text: { type: "string", description: "for set_note only" },
          },
          required: ["type", "date", "shiftType", "hours", "start", "template", "kind", "text"],
          additionalProperties: false,
        },
      },
    },
    required: ["ops"],
    additionalProperties: false,
  },
};
function dictationSystem(today: string, tz: string, tpls: Tpl[]): string {
  const cal: string[] = [];
  for (let i = -DICTATION_CAL_BACK; i <= DICTATION_CAL_FWD; i++) {
    const k = addDays(today, i);
    cal.push(`${dowOf(k)} ${k}${i === 0 ? "  ← today" : ""}`);
  }
  const names = tpls.map((t) => `"${t.label}"`).join(", ");
  return [
    "You turn a nurse's spoken request into shift-calendar operations for the BadgeBudget app by calling queue_ops.",
    `Today is ${dowOf(today)} ${today} (time zone ${tz}).`,
    "Calendar — look every date up here, never compute one:",
    cal.join("\n"),
    "Rules:",
    "- One op per calendar day. A bare weekday (\"Friday\") means the next one on or after today; \"tomorrow\", \"next week\" and \"the 14th\" resolve against the calendar above.",
    "- Shift words → shiftType: night/nights → night; day/days → base; weekend day → weekend-day; weekend night → weekend-eve; evening → weekday-eve; holiday → holiday; bonus or incentive shift → bonus-incentive.",
    "- hours is the number spoken (\"twelve hours\" → 12, \"an eight\" → 8); 0 when not said. start is HH:MM 24h only when a start time is spoken (a night \"at 7\" is 19:00, a day \"at 7\" is 07:00); otherwise empty.",
    names ? `- If she names one of her templates — ${names} — set template to that exact name and leave shiftType empty and hours 0.` : "- She has no saved templates; leave template empty.",
    "- PTO, vacation, sick day → add_day_event kind pto; class or education day → education; appointment → appointment; a requested day off → off. \"Note that …\" or \"remind me …\" → set_note with the text.",
    "- Never invent dates, hours or shifts that were not spoken. If nothing is a schedule change, return an empty ops list.",
  ].join("\n");
}
type DictationResult = { ok: true; ops: Record<string, unknown>[] } | { ok: false; error: string; message: string };
async function parseDictation(transcript: string, today: string, tz: string, tpls: Tpl[], model: string, apiKey: string): Promise<DictationResult> {
  const client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 });
  try {
    const res = await client.messages.create({
      model,
      max_tokens: 1024,
      system: dictationSystem(today, tz, tpls),
      messages: [{ role: "user", content: `Transcript: ${JSON.stringify(transcript)}` }],
      tools: [QUEUE_OPS_TOOL],
      tool_choice: { type: "tool", name: "queue_ops", disable_parallel_tool_use: true },
    });
    const tu = res.content.find((b) => b.type === "tool_use");
    const input = (tu && tu.type === "tool_use" ? tu.input : null) as { ops?: unknown } | null;
    const ops = Array.isArray(input?.ops) ? (input!.ops as unknown[]) : [];
    return { ok: true, ops: ops.filter((o) => o && typeof o === "object") as Record<string, unknown>[] };
  } catch (e) {
    // Coarse only: the class of failure, never the transcript or the request.
    console.error("siri-ingest dictation: model call failed:", (e as { name?: string })?.name ?? "error", (e as { status?: number })?.status ?? "");
    return { ok: false, error: "dictation_failed", message: "I couldn't understand that right now. Try again, or use the form." };
  }
}

// ---- service-role client (RLS bypass is the point: clients have no insert policy on ops_inbox) ----
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = (SUPABASE_URL && SERVICE_KEY)
  ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  : null;

type Row = { user_id: string; token_id: string; source: "siri"; op: string; payload: Record<string, unknown>; summary: string; transcript?: string };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return bad(405, "method_not_allowed", "POST only.");
  if (!admin) return bad(500, "not_configured", "The Siri bridge isn't configured.");

  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_BODY_BYTES) return bad(413, "too_large", "That request was too big.");
  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return bad(413, "too_large", "That request was too big.");
    body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("shape");
  } catch { return bad(400, "bad_json", "I couldn't read that request."); }

  try {
    // 0. Who is calling, in which mode, from which shell — then the config it needs for the handshake.
    const shortcut = typeof body.client === "string" && body.client.trim().toLowerCase() === "shortcut";
    const mode = typeof body.mode === "string" && body.mode.trim() ? body.mode.trim().toLowerCase() : "form";
    const shell: Shell = (mode === "form_multi" || (typeof body.shell === "string" && body.shell.trim().toLowerCase() === "plan")) ? "plan" : "shortcut";
    const cfg = await loadConfig();
    const c: Ctx = { shortcut, hs: handshake(cfg, shell, body.v, shortcut) };

    // 1. The code — canonicalize, hash, look up. Vague on every failure; the code itself is never echoed.
    const code = canonicalCode(body.code);
    if (!code) return fail(c, 401, "invalid_code", "That Siri code isn't valid. Reconnect Siri in BadgeBudget → Settings.");
    const codeHash = await sha256Hex(code);
    const { data: tok, error: tokErr } = await admin
      .from("siri_tokens").select("id, user_id, revoked_at").eq("code_hash", codeHash).maybeSingle();
    if (tokErr || !tok || tok.revoked_at) return fail(c, 401, "invalid_code", "That Siri code isn't valid. Reconnect Siri in BadgeBudget → Settings.");
    const uid: string = tok.user_id;

    // 2. A shell below the minimum safe version is told to update and nothing else is processed.
    if (c.hs.tooOld) {
      return reply(c, 426, {
        ok: false, status: "update", error: "update_required",
        message: c.hs.url ? "This Shortcut is out of date. Install the new one, then delete this copy." : "This Shortcut is out of date. Ask for the new link, then delete this copy.",
        ...(c.hs.url ? { update_url: c.hs.url } : {}), latest_v: c.hs.latest,
      });
    }

    if (!MODES.includes(mode)) return fail(c, 400, "bad_mode", "Mode should be form, form_multi, meta or dictation.");
    const nowISO = new Date().toISOString();

    // 3. meta — the one read: template names, start times and hours. Nothing else about the account.
    if (mode === "meta") {
      const tpls = await loadTemplates(uid);
      await admin.from("siri_tokens").update({ last_used_at: nowISO }).eq("id", tok.id);
      if (!tpls.length) return fail(c, 404, "no_templates", "Save a shift template in BadgeBudget first (Add a shift → Save as template), then run this again.");
      const templates = tpls.map((t) => ({ label: t.label, key: t.key, start: t.start ?? defaultStart(t.shiftType), hours: t.hours }));
      return reply(c, 200, { ok: true, status: "ok", templates, message: `${templates.length} template${templates.length === 1 ? "" : "s"}.` });
    }

    // 4. Build the row(s) for the write modes. Nothing is inserted until every op validates (form modes)
    //    or the survivors are known (dictation).
    let rows: Row[] = [];
    let summaryLine = "", message = "";
    const batch = crypto.randomUUID();   // groups a multi-row queue in the "From Siri" sheet

    if (mode === "form") {
      // Wire format, per docs/agent-gateway-scope.md → Path B: `op` is an object `{type, date, ...}`
      // (what the Shortcut's Dictionary action builds). A flat `{op:"add_shift", date, ...}` or
      // `{op, args:{...}}` is accepted too, so a hand-built Shortcut can't get this wrong.
      let opName = "", fields: Record<string, unknown> = body;
      if (body.op && typeof body.op === "object" && !Array.isArray(body.op)) {
        const o = body.op as Record<string, unknown>;
        opName = typeof o.type === "string" ? o.type : (typeof o.op === "string" ? o.op : "");
        fields = o;
      } else {
        opName = typeof body.op === "string" ? body.op : "";
        if (body.args && typeof body.args === "object" && !Array.isArray(body.args)) fields = body.args as Record<string, unknown>;
      }
      const op = normOp(opName);
      if (!OPS.includes(op)) return fail(c, 400, "bad_op", "I can add a shift, add a day event, or set a note.");
      let tpl: Tpl | null = null;
      const tplRef = fields.template ?? fields.template_key ?? fields.templateKey;
      if (op === "add_shift" && tplRef != null && tplRef !== "") {
        tpl = findTemplate(await loadTemplates(uid), tplRef);
        if (!tpl) return fail(c, 400, "bad_template", `I couldn't find a template called “${String(tplRef).slice(0, MAX_TEMPLATE_NAME)}”. Check Settings → templates in BadgeBudget.`);
      }
      const built = buildOp(op, fields, tpl);
      if (!built.ok) return fail(c, 400, built.error, built.message);
      rows = [{ user_id: uid, token_id: tok.id, source: "siri", op: built.op, payload: built.payload, summary: built.summary }];
      summaryLine = built.summary;
      message = `Queued: ${built.summary}. Open BadgeBudget to confirm.`;
    }

    if (mode === "form_multi") {
      const rawDates = Array.isArray(body.dates) ? body.dates : typeof body.dates === "string" ? body.dates.split(/[\n,]+/) : [];
      const keys: string[] = [];
      for (const d of rawDates) {
        const m = String(d ?? "").trim().match(/^(\d{4}-\d{2}-\d{2})/);   // bare ISO date, or a label that starts with one
        if (!m) return fail(c, 400, "bad_date", "Each day should start with a date like 2026-09-12.");
        if (!keys.includes(m[1])) keys.push(m[1]);
      }
      if (!keys.length) return fail(c, 400, "bad_dates", "Pick at least one day.");
      if (keys.length > MAX_MULTI_DATES) return fail(c, 400, "too_many_dates", `Pick up to ${MAX_MULTI_DATES} days at a time.`);
      let tpl: Tpl | null = null;
      if (body.template != null && body.template !== "") {
        tpl = findTemplate(await loadTemplates(uid), body.template);
        if (!tpl) return fail(c, 400, "bad_template", `I couldn't find a template called “${String(body.template).slice(0, MAX_TEMPLATE_NAME)}”. Check Settings → templates in BadgeBudget.`);
      } else if (!(body.shiftType ?? body.shift_type)) {
        return fail(c, 400, "bad_shift_type", "Pick a template, or say the shift type and hours.");
      }
      const fields: Record<string, unknown> = { shiftType: body.shiftType ?? body.shift_type, hours: body.hours, start: body.start ?? body.time };
      for (const k of keys) {
        const built = buildOp("add_shift", { ...fields, date: k }, tpl);
        if (!built.ok) return fail(c, 400, built.error, built.message);
        rows.push({ user_id: uid, token_id: tok.id, source: "siri", op: built.op, payload: { ...built.payload, batch }, summary: built.summary });
      }
      const n = rows.length;
      const label = tpl ? tpl.label : `${SHIFT_LABEL[rows[0].payload.shiftType as string]} ${fmtHours(rows[0].payload.hours as number)}`;
      const whens = rows.map((r) => r.summary.split(" · ")[0]);
      const shown = whens.slice(0, 5).join(", ") + (n > 5 ? ` +${n - 5} more` : "");
      summaryLine = `${n} shift${n === 1 ? "" : "s"} · ${label} · ${shown}`;
      message = `Queued ${n} shift${n === 1 ? "" : "s"} — ${label} on ${shown}. Open BadgeBudget to confirm each one.`;
    }

    // 5. Housekeeping + limits (per user, not per code — a nurse with two codes is still one inbox).
    //    Runs before the model call in dictation so a leaked code can't spend API calls past the limits.
    const expireBefore = new Date(Date.now() - EXPIRE_AFTER_DAYS * 86_400_000).toISOString();
    await admin.from("ops_inbox")
      .update({ status: "expired", resolved_at: nowISO })
      .eq("user_id", uid).eq("status", "pending").lt("created_at", expireBefore);
    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    const [{ count: recent }, { count: pending }] = await Promise.all([
      admin.from("ops_inbox").select("id", { count: "exact", head: true }).eq("user_id", uid).gte("created_at", since),
      admin.from("ops_inbox").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("status", "pending"),
    ]);
    if ((recent ?? 0) >= RATE_MAX_PER_WINDOW) return fail(c, 429, "rate_limited", "Too many requests at once — try again in a minute.");
    const pendingNow = pending ?? 0;
    const tooManyPending = (n: number) => pendingNow + n > MAX_PENDING;
    const pendingMsg = (n: number) => n > 1
      ? `That would put more than ${MAX_PENDING} things waiting in BadgeBudget — open the app and clear some first.`
      : `There are already ${MAX_PENDING} things waiting in BadgeBudget — open the app and clear them first.`;
    if (rows.length && tooManyPending(rows.length)) return fail(c, 429, "too_many_pending", pendingMsg(rows.length));
    if (mode === "dictation" && tooManyPending(1)) return fail(c, 429, "too_many_pending", pendingMsg(1));

    if (mode === "dictation") {
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
      if (!apiKey) return fail(c, 503, "dictation_unavailable", "Dictation isn't set up yet — use the form.");
      const transcript = typeof body.transcript === "string" ? body.transcript.trim().slice(0, MAX_TRANSCRIPT) : "";
      if (!transcript) return fail(c, 400, "bad_transcript", "I didn't hear anything.");
      const tz = validTz(body.tz) ?? DEFAULT_TZ;
      const todayKey = (typeof body.today === "string" && parseDate(body.today)) ? body.today.trim().slice(0, 10) : todayIn(tz);
      const tpls = await loadTemplates(uid);
      const model = typeof cfg.siri_dictation_model === "string" && /^claude-[a-z0-9-]+$/.test(cfg.siri_dictation_model) ? cfg.siri_dictation_model : DICTATION_MODEL_DEFAULT;
      const parsed = await parseDictation(transcript, todayKey, tz, tpls, model, apiKey);
      if (!parsed.ok) return fail(c, 502, parsed.error, parsed.message);
      // Every parsed op goes through the SAME allowlist and coercions as form. Invalid ones are dropped.
      for (const o of parsed.ops) {
        if (rows.length >= MAX_MULTI_DATES) break;
        const op = normOp(o.type);
        if (!OPS.includes(op)) continue;
        const tpl = op === "add_shift" && o.template ? findTemplate(tpls, o.template) : null;
        const f: Record<string, unknown> = { date: o.date };
        if (typeof o.shiftType === "string" && o.shiftType) f.shiftType = o.shiftType;
        if (typeof o.hours === "number" && o.hours > 0) f.hours = o.hours;
        if (typeof o.start === "string" && o.start) f.start = o.start;
        if (typeof o.kind === "string" && o.kind) f.kind = o.kind;
        if (typeof o.text === "string" && o.text) f.text = o.text;
        const built = buildOp(op, f, tpl);
        if (!built.ok) continue;
        if (rows.some((r) => r.op === built.op && r.payload.date === built.payload.date && r.op !== "set_note")) continue;   // one op per day per kind
        rows.push({ user_id: uid, token_id: tok.id, source: "siri", op: built.op, payload: { ...built.payload, batch }, summary: built.summary, transcript });
      }
      if (!rows.length) return fail(c, 422, "nothing_understood", "I didn't catch a shift in that. Try: “night shift Friday, twelve hours”.");
      if (tooManyPending(rows.length)) return fail(c, 429, "too_many_pending", pendingMsg(rows.length));
      const n = rows.length;
      summaryLine = rows.map((r) => r.summary).join("; ");
      message = `Queued ${n}: ${summaryLine}. Open BadgeBudget to confirm.`;
    }

    // 6. Queue the rows in one insert, then stamp the code. Nothing here touches user_data.
    const { error: insErr } = await admin.from("ops_inbox").insert(rows);
    if (insErr) return fail(c, 502, "queue_failed", "BadgeBudget couldn't save that right now. Try again.");   // vague on purpose
    await admin.from("siri_tokens").update({ last_used_at: nowISO }).eq("id", tok.id);

    const out: Record<string, unknown> = { ok: true, status: "queued", queued: rows.length, summary: summaryLine, message };
    if (rows.length > 1) out.lines = rows.map((r) => r.summary);
    return reply(c, 200, out);
  } catch (e) {
    console.error("siri-ingest: unexpected", (e as { name?: string })?.name ?? "error");   // never the body
    return bad(500, "internal", "BadgeBudget couldn't handle that right now. Try again.");
  }
});
