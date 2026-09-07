---
name: ship
description: "Ship a BadgeBudget change to production. Use when merging work to the deploy branch, deploying to GitHub Pages, verifying a deploy is live, or when the user says ship / deploy / push it live / merge and deploy. Encodes the fetch-before-branch rule (Invariant 10), the mechanical gate, the PR-to-deploy-branch flow, and the live verification that actually proves the change reached badgebudget.com."
---

# Ship

Deploy is the moment BadgeBudget's missing safety nets bite. There is no rollback button,
the publish set is three files, and until `gate` is a required status check a red CI run
does not block a merge. Follow this in order; the verification step is the one people skip
and it is the only one that proves anything.

## 1. Branch from origin, never from the local ref

Fresh checkouts are shallow and have been seen 14 commits behind (Invariant 10):

```bash
git fetch origin claude/migrate-to-github-deploy-3F5RD
git checkout -B <work-branch> origin/claude/migrate-to-github-deploy-3F5RD
```

Never `git checkout -b` from a local ref. Never push to
`claude/migrate-to-github-deploy-3F5RD` directly — deploy fires on push to it, so a direct
push ships whatever you have with nothing in between.

## 2. Run the gate before you commit

```bash
npm install --no-save @babel/standalone@7.24.7   # if not already vendored
node scripts/check_build.mjs      # invariants 1,2,4,5,6,8,9 + JSX parses
node scripts/test_groom_seed.mjs  # 33 assertions
node tests/smoke.mjs              # 27 assertions, iPhone 13 profile
```

All three green, or you are not shipping. `check_build.mjs` prints Invariants 3, 10, 11 and
12 as UNCHECKED because a machine cannot hold them — if your change touches wage math, stop
and use the `wage-core` skill instead.

## 3. Commit with the Done-log line

`BACKLOG.md`'s Done log is the project's durable memory; the nightly loop reads it to dedupe.
A commit that changes behaviour without a dated Done entry is a commit the loop will
re-propose next week. Say what changed, why, and what the gate reported.

## 4. PR to the deploy branch, then squash-merge

```bash
git push -u origin <work-branch>
```

Open the PR against `claude/migrate-to-github-deploy-3F5RD`. CI runs `gate` and `smoke`.
**Read the run, don't trust the badge** — a workflow that never triggered also shows no
failures. Confirm both jobs actually executed and report their assertion counts.

Squash-merge. Deploy fires automatically and takes 1–2 minutes.

## 5. Verify against badgebudget.com — with a marker

This is the step that has been broken. The old github.io URL 301-redirects with an empty
162-byte nginx body, so anything grepping it for content can never find the change:

```bash
# WRONG — returns a 301 with no app content, can never see your marker
curl -s https://patrick222-dotcom.github.io/705-v1/index.html

# RIGHT — cache-busted, and grep for something unique to THIS change
curl -s "https://badgebudget.com/index.html?cb=$(date +%s)" | grep -c '<marker unique to your change>'
```

Pick the marker before you deploy: a new function name, a new string, a new event name.
"The page returned 200" is not verification — Pages serves the previous build with a 200
just as happily.

Also confirm the deployed bytes match the branch:

```bash
diff <(curl -s https://badgebudget.com/index.html) \
     <(git show origin/claude/migrate-to-github-deploy-3F5RD:index.html) && echo "deploy matches branch"
```

## 6. Clean up

Delete the merged work branch. **Never** delete `claude/clause-md-review-9tqlj8` (the
nightly's working branch), `claude/migrate-to-github-deploy-3F5RD`, or the head of any open
PR (Invariant 11). Delete pushes are 403 from agent sessions — do it in the GitHub UI.

## If something is wrong after deploy

There is no rollback. Recovery is a forward fix through this same flow, or
`git revert` + merge. Because the publish set is exactly `index.html`,
`pdf.worker.min.js` and `CNAME`, a deploy that drops `CNAME` knocks the site off the
custom domain (Invariant 8) — `check_build.mjs` asserts this, so a green gate rules it out.
