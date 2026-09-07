// siri-ingest — Supabase Edge Function (Deno).
//
// Purpose: Path B of the agent gateway (docs/agent-gateway-scope.md → Path B). An iOS Shortcut
// ("Hey Siri, log a shift in BadgeBudget") POSTs a small form here together with the nurse's Siri
// code. The function validates the code and the op and queues ONE row in public.ops_inbox. Nothing
// is written to user_data: the app lists queued rows in a "From Siri" sheet and the nurse taps Add
// or Skip. This function is the only writer to ops_inbox.
//
// SECURITY (verify_jwt is OFF — the caller is a Shortcut holding a code, not a signed-in JWT — so
// this function defends itself; review carefully):
//   * The Siri code is a BEARER CREDENTIAL. It is hashed (SHA-256) and looked up by hash (`siri_tokens.code_hash`); it is
//     never logged, never echoed, never stored in plaintext anywhere. Errors are deliberately vague.
//   * Unknown or revoked code → 401 invalid_code. Nothing here can enumerate users or codes.
//   * Rate limits per user: 10 inbox rows per 60 s, 20 pending at once → 429.
//   * Pending rows older than 7 days are expired on the way through, so a forgotten queue can't grow.
//   * `form` mode only (dictation / Claude parsing is Session B). Ops are allowlisted and validated
//     with the same coercions the app's sanitizeData() applies: finite 0<hours≤24, a real ISO date
//     within ±400 days, shift type in the app's enum, event kind in the app's enum, note trimmed and
//     capped at the app's MAX_NOTE_LEN. Anything that fails is 400 and is never queued.
//   * Inserts run with the service role (there is no client insert policy on ops_inbox). The
//     service-role client is created from the runtime's injected env and never leaves this process.
//
// Deploy: `supabase functions deploy siri-ingest --no-verify-jwt` (or the MCP deploy tool with
// verify_jwt=false). Success response: {ok:true, queued:1, summary:"Fri Sep 12 · Night · 12h"}.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// ---- the app's enums, mirrored (index.html: DIFF_DEFAULTS keys minus 'overtime', EVENT_KINDS, MAX_NOTE_LEN) ----
const SHIFT_TYPES = ["base", "night", "weekday-eve", "weekend-day", "weekend-eve", "holiday", "bonus-incentive"];
const SHIFT_ALIASES: Record<string, string> = {
  day: "base", days: "base", regular: "base", "day-regular": "base",
  nights: "night", "night-shift": "night",
  evening: "weekday-eve", evenings: "weekday-eve", "weekday-evening": "weekday-eve",
  weekend: "weekend-day", "weekend-days": "weekend-day",
  "weekend-night": "weekend-eve", "weekend-nights": "weekend-eve", "weekend-evening": "weekend-eve",
  bonus: "bonus-incentive", incentive: "bonus-incentive",
};
const SHIFT_LABEL: Record<string, string> = {
  base: "Day", night: "Night", "weekday-eve": "Weekday evening", "weekend-day": "Weekend day",
  "weekend-eve": "Weekend night", holiday: "Holiday", "bonus-incentive": "Bonus incentive",
};
const EVENT_KINDS = ["pto", "education", "appointment", "off"];
const EVENT_LABEL: Record<string, string> = { pto: "PTO", education: "Education", appointment: "Appointment", off: "Off" };
const MAX_NOTE_LEN = 240;            // the app's MAX_NOTE_LEN — saveDayShifts() slices to this anyway
const DATE_WINDOW_DAYS = 400;
const DEFAULT_SHIFT_HOURS = 12;      // the Add-Shift sheet's own default when the Shortcut omits hours

const OPS = ["add_shift", "add_day_event", "set_note"];
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 10;
const MAX_PENDING = 20;
const EXPIRE_AFTER_DAYS = 7;
const MAX_BODY_BYTES = 8 * 1024;

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
// Error shape: {ok:false, error:<code>, message:<what Siri can say>}. `message` never contains the code.
function bad(status: number, error: string, message: string): Response {
  return json(status, { ok: false, error, message });
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

// ---- op validation: returns the row to queue, or an error response ----
type Queued = { op: string; payload: Record<string, unknown>; summary: string };
function buildOp(op: string, f: Record<string, unknown>): Queued | Response {
  const date = parseDate(f.date);
  if (!date) return bad(400, "bad_date", "I need a date like 2026-09-12, within about a year of today.");
  const when = dateLabel(date);

  if (op === "add_shift") {
    const shiftType = parseShiftType(f.shiftType ?? f.shift_type ?? f.type);
    if (!shiftType) return bad(400, "bad_shift_type", "Shift type should be Day, Night, Weekend day, Weekend night, Weekday evening, Holiday or Bonus incentive.");
    const hoursRaw = (f.hours == null || f.hours === "") ? DEFAULT_SHIFT_HOURS : f.hours;   // omitted → the sheet's 12h default
    const hours = parseHours(hoursRaw, { min: 0.1, required: true });
    if (hours == null) return bad(400, "bad_hours", "Hours should be a number between 0 and 24.");
    const start = parseStart(f.start ?? f.time);
    if (start === null) return bad(400, "bad_start", "Start time should look like 19:00 or 7:00 PM.");
    const payload: Record<string, unknown> = { date: date.key, shiftType, hours };
    if (start) payload.start = start;
    const summary = `${when} · ${SHIFT_LABEL[shiftType]} · ${fmtHours(hours)}${start ? ` · ${time12(start)}` : ""}`;
    return { op, payload, summary };
  }

  if (op === "add_day_event") {
    const kindRaw = typeof f.kind === "string" ? f.kind.trim().toLowerCase() : "";
    const kind = kindRaw === "appt" ? "appointment" : kindRaw === "requested-off" || kindRaw === "day off" ? "off" : kindRaw;
    if (!EVENT_KINDS.includes(kind)) return bad(400, "bad_kind", "Kind should be PTO, Education, Appointment or Off.");
    const hours = parseHours(f.hours, { min: 0, required: false });
    if (hours === null) return bad(400, "bad_hours", "Hours should be a number between 0 and 24.");
    const payload: Record<string, unknown> = { date: date.key, kind };
    if (hours !== undefined) payload.hours = hours;
    const summary = `${when} · ${EVENT_LABEL[kind]}${hours !== undefined ? ` · ${fmtHours(hours)}` : ""}`;
    return { op, payload, summary };
  }

  if (op === "set_note") {
    const text = typeof f.text === "string" ? f.text.trim().slice(0, MAX_NOTE_LEN) : "";
    if (!text) return bad(400, "bad_text", "The note was empty.");
    const short = text.length > 60 ? text.slice(0, 59) + "…" : text;
    return { op, payload: { date: date.key, text }, summary: `${when} · Note: ${short}` };
  }

  return bad(400, "bad_op", "I can add a shift, add a day event, or set a note.");
}

// ---- service-role client (RLS bypass is the point: clients have no insert policy on ops_inbox) ----
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = (SUPABASE_URL && SERVICE_KEY)
  ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  : null;

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

  // 1. The code — canonicalize, hash, look up. Vague on every failure; the code itself is never echoed.
  const code = canonicalCode(body.code);
  if (!code) return bad(401, "invalid_code", "That Siri code isn't valid. Reconnect Siri in BadgeBudget → Settings.");
  const codeHash = await sha256Hex(code);
  const { data: tok, error: tokErr } = await admin
    .from("siri_tokens").select("id, user_id, revoked_at").eq("code_hash", codeHash).maybeSingle();
  if (tokErr || !tok || tok.revoked_at) return bad(401, "invalid_code", "That Siri code isn't valid. Reconnect Siri in BadgeBudget → Settings.");
  const uid: string = tok.user_id;

  // 2. Mode + op. Dictation is Session B — refuse cleanly rather than guess.
  const mode = typeof body.mode === "string" ? body.mode.trim().toLowerCase() : "form";
  if (mode === "dictation") return bad(501, "mode_not_available", "Dictation isn't available yet — use the form.");
  if (mode !== "form") return bad(400, "bad_mode", "Mode should be form.");
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
  const op = opName.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!OPS.includes(op)) return bad(400, "bad_op", "I can add a shift, add a day event, or set a note.");
  const built = buildOp(op, fields);
  if (built instanceof Response) return built;

  const nowISO = new Date().toISOString();

  // 3. Housekeeping: expire stale pending rows so a forgotten queue never grows without bound.
  const expireBefore = new Date(Date.now() - EXPIRE_AFTER_DAYS * 86_400_000).toISOString();
  await admin.from("ops_inbox")
    .update({ status: "expired", resolved_at: nowISO })
    .eq("user_id", uid).eq("status", "pending").lt("created_at", expireBefore);

  // 4. Rate limits (per user, not per code — a nurse with two codes is still one inbox).
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const [{ count: recent }, { count: pending }] = await Promise.all([
    admin.from("ops_inbox").select("id", { count: "exact", head: true }).eq("user_id", uid).gte("created_at", since),
    admin.from("ops_inbox").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("status", "pending"),
  ]);
  if ((recent ?? 0) >= RATE_MAX_PER_WINDOW) return bad(429, "rate_limited", "Too many requests at once — try again in a minute.");
  if ((pending ?? 0) >= MAX_PENDING) return bad(429, "too_many_pending", "There are already 20 things waiting in BadgeBudget — open the app and clear them first.");

  // 5. Queue exactly one row, then stamp the code. Nothing here touches user_data.
  const { error: insErr } = await admin.from("ops_inbox").insert({
    user_id: uid, token_id: tok.id, source: "siri", op: built.op, payload: built.payload, summary: built.summary,
  });
  if (insErr) return bad(502, "queue_failed", "BadgeBudget couldn't save that right now. Try again.");   // vague on purpose
  await admin.from("siri_tokens").update({ last_used_at: nowISO }).eq("id", tok.id);

  return json(200, { ok: true, queued: 1, summary: built.summary });   // queued = rows enqueued (dictation may return >1)
});
