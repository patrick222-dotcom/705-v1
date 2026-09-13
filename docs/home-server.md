# Docker home server — concept note

*Logged 2026-09-09. **Not BadgeBudget app work** and not nightly-loop work — this is the owner's
personal infrastructure track, filed here because it is the eventual host for the agent-gateway
work in `docs/agent-gateway-scope.md` and the two decisions interlock.*

## The bet

A Docker home server is the right long-term infrastructure play for the owner's personal stack.
Everything currently routed through third-party SaaS (notes, context persistence, connectors)
either paywalls, disappears, or can't be reached from where it's needed. A box the owner controls
removes the vendor-longevity question entirely.

## What gates it

**The mobile custom-MCP gap.** A home server hosting MCP endpoints is only useful once a Claude
client on a phone can reach a custom MCP server. Until then, anything self-hosted is unreachable
from the surface where it would actually get used, so building now buys nothing but maintenance.
This is the trigger condition — when that gap closes, the project starts. It is deliberately not a
crawl/walk/run staging; it's a single external dependency to watch.

Interim context layer in the meantime: the Google Drive brain folder. Ruled out and not to be
revisited without new information — Mem, Craft and comparable third-party note tools (longevity and
paywall risk), OneDrive MCP (blocked on personal-account OAuth), and building cross-platform apps
to work around what is fundamentally a connector problem.

## Why it matters to this repo

`docs/agent-gateway-scope.md` scopes an MCP surface for BadgeBudget as a Supabase Edge Function
authenticated by Supabase's own OAuth 2.1 server, so RLS applies to the agent unchanged. That
remains the right shape for the *hosted* gateway — the home server does not replace it. What the
home box could give the gateway work:

- a **rehearsal environment** — one of the five owner decisions gating the first gateway session is
  which project to rehearse against, and a self-hosted stack is a candidate that doesn't touch the
  live Supabase project holding real users' pay history;
- a place to run **owner-only tooling** (the ops dashboard, groom/seed jobs, the `te_swap_p2_algo.js`
  and `rls_audit.js` suites that are still not in `tests/`) without a cloud runner;
- a host for **personal** MCP servers that have nothing to do with BadgeBudget, which is most of the
  actual point.

## Rust belongs here, not in the app

From the 2026-09-09 evaluation (prompted by the Rust debugging survey published 2026-09-07): Rust
is a bad fit for `index.html` and a bad fit for the gateway Edge Function, but a good fit for the
home server.

Against the app: the only plausible surface is WASM for the wage core, and the survey's own numbers
say WebAssembly is where Rust's debugging story is thinnest (81% of respondents prefer print
debugging, with setup called out as worst on Windows and WASM; 74% of debugger users report poor
value representation). It would trade a wage core the harness can call directly via `page.evaluate`
for an opaque blob, break "single file, no build step," add a fifth artifact to the load-bearing
4-file publish set (Invariant 8), and put the most safety-critical code on the one loading path
where SRI (Invariant 2) doesn't reach. None of the thirteen invariants — nor the 23505 upsert bug,
nor the WebKit `getSession()` deadlock — describes a memory-safety or data-race failure. The whole
recorded failure history of this repo is integration, protocol and deployment failures.

Against Rust in the gateway: rewriting the Edge Function in Rust means hosting it off Supabase
(Workers/Fly/Shuttle) and hand-maintaining JWT verification, which forfeits the "RLS applies to the
agent unchanged" property that is the entire security argument for the design.

For the home server: single static binaries, no runtime to containerize around, a memory footprint
that matters when a dozen services share one box, and failure modes — long-lived processes,
concurrent connections, resource lifetimes — that are exactly what the borrow checker is for. A
Rust MCP server on the home box is the sensible learning vehicle, and it is isolated from anything
a nurse depends on.

**One idea worth stealing back into the app regardless of Rust:** money is currently `f64`
throughout the wage core (`shiftGross`, `computeNet`), and `hourlyRate` falls through to
`base + diff.amount` for any unrecognised `diff.type`. Integer cents plus an explicit
unknown-type branch would capture most of what a `Money` newtype and an exhaustive `match` would
buy, in JS, in about an hour. Invariant 3 protocol applies — dedicated session, not a nightly.
