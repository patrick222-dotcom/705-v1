// ical-proxy — Supabase Edge Function (Deno).
//
// Purpose: the browser cannot fetch a Google Calendar / NurseGrid secret .ics feed directly
// (those endpoints send no CORS headers), so ScrubPay's auto-sync calls this proxy, which fetches
// the feed server-side and returns the raw .ics text.
//
// SECURITY (this is the whole reason the function exists — review carefully):
//   * verify_jwt is ON (Supabase default) — only a signed-in ScrubPay user can call this. That
//     stops the function from being an open web proxy.
//   * The target host MUST match the ALLOWLIST below (exact public calendar hosts). This is the
//     primary SSRF guard: an attacker can't point it at 169.254.169.254, localhost, or an internal
//     service, because those hosts aren't on the list.
//   * https only; redirects are NOT followed (redirect:'error') so an allowlisted host can't bounce
//     us to an internal address; response size is capped; a timeout bounds the fetch.
//   * The URL is a bearer credential (anyone with it can read that calendar). It is NEVER logged.
//
// Deploy: `supabase functions deploy ical-proxy` (keep verify_jwt on). Confirm/extend ALLOWLIST for
// the exact NurseGrid feed host before relying on it.

const ALLOWLIST: RegExp[] = [
  /^calendar\.google\.com$/i,          // Google Calendar secret iCal address
  /^www\.google\.com$/i,               // Google's /calendar/ical/... alternate host
  // TODO(owner): confirm NurseGrid's actual .ics feed host from a real feed URL, then pin it here.
  // Example placeholder — REPLACE with the verified host, do not ship a broad wildcard:
  /^([a-z0-9-]+\.)?nursegrid\.com$/i,
];

const MAX_BYTES = 2 * 1024 * 1024;     // 2 MB, matches the client-side .ics import cap
const FETCH_TIMEOUT_MS = 8000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function bad(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return bad(405, "method_not_allowed");

  let body: { url?: string };
  try { body = await req.json(); } catch { return bad(400, "bad_json"); }

  const raw = (body.url || "").trim();
  if (!raw) return bad(400, "missing_url");

  let target: URL;
  try { target = new URL(raw); } catch { return bad(400, "bad_url"); }

  // webcal:// is how calendars are often shared — treat it as https.
  if (target.protocol === "webcal:") target.protocol = "https:";
  if (target.protocol !== "https:") return bad(400, "https_only");
  if (!ALLOWLIST.some((re) => re.test(target.hostname))) return bad(403, "host_not_allowed");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      method: "GET",
      redirect: "error",            // never follow a redirect off the allowlisted host (SSRF)
      signal: ctrl.signal,
      headers: { "Accept": "text/calendar, text/plain, */*", "User-Agent": "ScrubPay-ical-sync/1" },
    });
  } catch {
    clearTimeout(timer);
    return bad(502, "fetch_failed");   // deliberately vague — never echo the URL or upstream detail
  }
  clearTimeout(timer);

  if (!upstream.ok || !upstream.body) return bad(502, "upstream_error");

  // Read with a hard size cap so a hostile/huge feed can't exhaust memory.
  const reader = upstream.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) { reader.cancel(); return bad(413, "too_large"); }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  const text = new TextDecoder("utf-8").decode(buf);

  // Cheap sanity check that this is actually a calendar, not an HTML error page.
  if (!/BEGIN:VCALENDAR/i.test(text)) return bad(422, "not_a_calendar");

  return new Response(text, {
    status: 200,
    headers: { ...cors, "Content-Type": "text/calendar; charset=utf-8" },
  });
});
