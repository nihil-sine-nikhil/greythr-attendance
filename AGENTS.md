# Notes for coding agents

Context for AI coding agents (Claude Code, Cursor, Copilot, Codex, …) helping
someone set up or modify this project. Humans: [README.md](README.md) is the
one you want.

## What this is

A single Node script that logs into a greytHR HR portal in a **Browserbase**
cloud browser and clicks the attendance toggle. **Stagehand v4** locates
elements from plain-English descriptions, so it works across greytHR tenants
that render differently. **GitHub Actions** provides the weekday schedule.

## Safety rules — read before acting

1. **Never put credentials in chat, and never ask the user to paste them
   there.** Ask them to type the values into `.env` themselves. `.env` is
   git-ignored; keep it that way.
2. **A real run writes to the user's employment record.** Use `--dry-run`
   unless the user explicitly asked for a real swipe. Never "test" with a real
   click on your own initiative.
3. **The user's copy must be a private repo.** Actions logs and artifacts are
   world-readable in public repos, and this uploads a screenshot of their HR
   dashboard.
4. **Don't print or echo secrets.** Set GitHub secrets by piping from `.env`
   (`printf '%s' "$v" | gh secret set NAME`), not by passing them as visible
   arguments.

## Environment gotchas

These are load-bearing. Getting any of them wrong produces a misleading error.

| Thing | Reality |
|---|---|
| Node version | **22+ required.** Node 20 has no global `WebSocket`; Stagehand v4 opens its CDP connection with it and dies with `ReferenceError: WebSocket is not defined`. |
| Stagehand version | **v4 only.** v2 hard-throws without `BROWSERBASE_PROJECT_ID` and has no Model Gateway support; its API (`new Stagehand()`, `page.act`) is entirely different from v4's (`Stagehand.create()`, `stagehand.act`). |
| `BROWSERBASE_PROJECT_ID` | **Not needed.** Resolved from the API key at startup via `GET /v1/projects`. |
| LLM provider keys | **Leave unset.** Inference routes through Browserbase's Model Gateway on the Browserbase key. A placeholder value causes a misleading `API key not valid`. |
| Browserbase Functions | **Cannot schedule this.** It's a runtime — `init`/`dev`/`publish`/`invoke` only, no cron endpoint. Don't propose it as the scheduler. |

## The attendance button

The card has **one toggle**: it reads `Sign In` while out, `Sign Out` while in.
Running the wrong mode is a no-op — but **only because of an explicit DOM
check**, not because `observe()` is discriminating.

`observe()` locates the toggle by position and context and echoes back the
label you asked for. Ask for "Sign In" while the button reads "Sign Out" and it
will return that button, described as "Sign In". Clicking it swipes the wrong
way — this reached production and signed a user out during their workday. It
has also returned "View Swipes" when asked for a label that didn't exist.

So: `page.locator(selector).innerText()` is read before clicking, and the click
is refused unless the real label matches. **Never remove that check, and never
trust `ObserveResult.description` for a decision** — treat it as a hint about
what was found, never as evidence of what it is.

The correct element sits inside greytHR's `gt-attendance-info` component. The
page header also has a **power icon that logs out of the portal** and reads
much like "sign out" — clicking that instead leaves attendance unmarked. The
script's `observe()` instruction excludes it explicitly and there's a
description guard before the click. Keep both if you touch that code.

Tenants using other labels ("Clock In", "Punch In") are handled by
`GREYTHR_SIGNIN_LABEL` / `GREYTHR_SIGNOUT_LABEL` — no code change needed.

## Days off

`SKIP_DATES` (repo variable or env) and an optional `skip-dates.txt` list days
to sit out: `2026-08-20`, `2026-08-20..2026-08-25`, or `PAUSE`. Dates are
compared in `SCHEDULE_TZ` (default `Asia/Kolkata`), **not** the runner's UTC —
a sign-out near midnight UTC would otherwise check the wrong date. The gate
runs before any browser session is opened; a skipped day must cost nothing.

Keep skip entries out of committed files when the repo is public — the
variable exists so a leave calendar isn't published.

## Commands

```bash
npm install
npm run signout:dry            # locate the button, report, don't click
npm run signin                 # real swipe — writes to the HR record
npm run cron -- 09:05 17:15 Asia/Kolkata   # UTC cron lines for the workflow
npm run skip -- tomorrow       # sit tomorrow out
npm run skip                   # show what's skipped
```

## Scheduling

GitHub cron is **UTC only** and has no timezone option — use `npm run cron` and
paste the output rather than doing the arithmetic. If you change the `cron:`
lines, also update `SIGNIN_CRON` / `SIGNOUT_CRON` in the workflow's *Decide
mode* step; they're compared literally and a mismatch fails the run.

Config lives in GitHub **secrets** (`BROWSERBASE_API_KEY`, `GREYTHR_USERNAME`,
`GREYTHR_PASSWORD`) and **variables** (`GREYTHR_SUBDOMAIN`) — not in code, so
the upstream template and a user's copy can share identical commits.

Two scheduler caveats to pass on rather than silently absorb: GitHub cron is
best-effort and can fire minutes late, and **GitHub disables scheduled
workflows after 60 days of repo inactivity.**

## Debugging

Every run prints a Browserbase replay link. **Open it before theorising** —
it shows exactly what the browser saw. Note it records the login being typed,
so treat replay links as sensitive.
