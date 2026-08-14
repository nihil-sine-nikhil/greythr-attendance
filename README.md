# greytHR Attendance Bot 🕐

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2022-5FA04E?logo=node.js&logoColor=white)](https://nodejs.org)
[![Browser: Browserbase](https://img.shields.io/badge/browser-Browserbase-F5A623)](https://browserbase.com)
[![Driven by: Stagehand](https://img.shields.io/badge/driven%20by-Stagehand%20v4-8A63D2)](https://github.com/browserbase/stagehand)
[![Schedule: GitHub Actions](https://img.shields.io/badge/schedule-GitHub%20Actions-2088FF?logo=githubactions&logoColor=white)](.github/workflows/attendance.yml)
[![Use this template](https://img.shields.io/badge/Use%20this-template-24292e?logo=github)](https://github.com/nihil-sine-nikhil/greythr-attendance/generate)

Marks your attendance on [greytHR](https://www.greythr.com/) for you — **Sign
In** in the morning, **Sign Out** in the evening — on a weekday schedule, with
your laptop closed.

It drives a real Chrome browser in **[Browserbase](https://browserbase.com)**'s
cloud using **[Stagehand](https://github.com/browserbase/stagehand)**, which
finds page elements from plain-English descriptions rather than hardcoded CSS
selectors. That matters here: every company's greytHR tenant renders slightly
differently, and a selector scraped from one won't survive on another.

Works on any greytHR tenant. Runs free: Browserbase's free tier covers both the
browser and the AI, and GitHub Actions provides the schedule.

![A dry run: the bot logs in, locates the attendance Sign Out button inside the
attendance card, prints the matched element and its selector, and stops without
clicking](docs/demo.gif)

<sub>A `--dry-run`: logs in, finds the button, shows you what it matched — and
stops before clicking. Tenant and session id are masked.</sub>

---

## Quick start

You need **Node.js 22+** (Stagehand v4 uses the global `WebSocket`, which Node
20 lacks) and a free [Browserbase API key](https://browserbase.com/settings).

```bash
git clone https://github.com/YOUR-USERNAME/greythr-attendance.git
cd greythr-attendance
npm install
cp .env.example .env
```

Fill in four values in `.env`:

| Variable | What it is |
|---|---|
| `BROWSERBASE_API_KEY` | From <https://browserbase.com/settings> |
| `GREYTHR_SUBDOMAIN` | If you log in at `https://acme.greythr.com/…`, this is `acme` |
| `GREYTHR_USERNAME` | Your employee number or email |
| `GREYTHR_PASSWORD` | Your greytHR password |

Then check it works **without touching your attendance record**:

```bash
npm run signout:dry
```

A dry run logs in, finds the attendance button, prints exactly what it matched,
and stops before clicking. If it reports a sensible-looking match, you're set:

```bash
npm run signin      # mark attendance Sign In
npm run signout     # mark attendance Sign Out
```

Every run prints a **replay link** (`https://www.browserbase.com/sessions/<id>`)
you can watch live or scrub through afterwards, and saves a screenshot
(`attendance-signin.png` / `attendance-signout.png`) as proof.

> 🔒 `.env` holds your password. It's git-ignored — never commit it. Note that
> the Browserbase session replay records the login being typed, so treat replay
> links as sensitive too.

---

## Setting this up with a coding agent

Using Claude Code, Cursor, Copilot, Codex or similar? Paste the prompt below.
There's also an [`AGENTS.md`](AGENTS.md) in the repo that most agents read on
their own.

<details>
<summary><b>Copy this prompt</b></summary>

```text
Set up the greytHR attendance bot from
https://github.com/nihil-sine-nikhil/greythr-attendance for me.

Do this:
1. Create a PRIVATE repo from that template (it's a GitHub template repo), and
   clone it. It must be private — a public repo exposes Actions logs and
   artifacts, and this uploads a screenshot of my HR dashboard.
2. Run `npm install`. Check I'm on Node 22+ and tell me if I'm not.
3. Create .env from .env.example. Fill in GREYTHR_SUBDOMAIN. Then STOP and ask
   me to type my greytHR username and password into .env myself — do not ask
   me to paste them into chat, and do not put them in any file you'd commit.
4. Run `npm run signout:dry`. This logs in and locates the attendance button
   without clicking. Show me the matched element and the replay link, and
   confirm the selector is inside the attendance card (look for
   `gt-attendance-info` in the xpath), NOT the header logout icon.
5. Ask me what times I want, then run
   `npm run cron -- <signin> <signout> <my IANA timezone>`
   and paste both lines into .github/workflows/attendance.yml — updating the
   SIGNIN_CRON / SIGNOUT_CRON values in the "Decide mode" step to match.
6. Push, then add repo secrets BROWSERBASE_API_KEY, GREYTHR_USERNAME,
   GREYTHR_PASSWORD and the variable GREYTHR_SUBDOMAIN. Set the secrets by
   piping from .env so the values are never printed to the terminal.
7. Trigger the workflow manually with dry_run=true and show me the result.

Rules:
- Never commit .env, and never print my password or API key.
- Don't do a real (non-dry) click without asking me first — it writes to my
  actual attendance record.
- If something fails, open the Browserbase replay link before guessing.
```

</details>

**Two things worth telling your agent explicitly**, because they're the
mistakes that actually happen:

- **Don't hand it your password in chat.** Have it stop and let you type the
  credentials into `.env` yourself. Anything you paste into a chat lives in
  that transcript.
- **Dry run before a real click.** `--dry-run` proves the targeting without
  writing to your attendance record. A real click is a real HR record.

---

## No LLM key needed

Stagehand needs a model to interpret instructions like *"the Sign Out button in
the attendance card"*. This project routes that through **Browserbase's Model
Gateway**, billed to your Browserbase key — so you don't need an OpenAI,
Anthropic or Google key at all. The free tier includes **$5 of tokens**; a run
costs roughly 10k tokens, so twice-daily use lasts a long while.

Two things that will waste your afternoon if you don't know them:

- **Don't set a provider key** (`OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`,
  …) to a placeholder. Stagehand will try to use it and fail with a misleading
  `API key not valid`. Leave them unset.
- **You don't need `BROWSERBASE_PROJECT_ID`.** The script resolves it from your
  API key at startup.

To use your own LLM key instead, set `STAGEHAND_MODEL` and that provider's key.

---

## How the button works

greytHR's attendance card has **one toggle button**, not two. It reads
`Sign In` while you're out and `Sign Out` once you're in. So the button a given
mode looks for only exists in the state you're trying to leave:

- `signin` when you're already signed in → finds nothing, exits cleanly. It
  can't double-mark.
- Same for `signout` when you're already out.

After clicking, the script re-checks that the label flipped, so a click that
silently didn't register is reported as a failure instead of a success.

There's one trap it guards against: greytHR's top-right **power icon logs you
out of the portal** and reads a lot like "sign out". The script targets the
attendance card specifically and refuses to click anything that looks like the
logout control.

If your tenant labels the toggle differently — "Clock In", "Punch In", "Swipe
In" — set `GREYTHR_SIGNIN_LABEL` / `GREYTHR_SIGNOUT_LABEL` in `.env`.

---

## Taking a day off

Working from home, on leave, or it's a holiday? Tell it to sit that day out:

```bash
npm run skip -- tomorrow              # not going in tomorrow
npm run skip -- 2026-10-02            # a holiday
npm run skip -- 2026-12-24..2026-12-31   # on leave for a week
npm run skip -- pause                 # stop entirely
npm run skip -- resume                # start again
npm run skip                          # show what's currently skipped
```

That writes to the `SKIP_DATES` repository variable via the GitHub CLI, so
your leave calendar lives in repo settings rather than in a committed file —
which matters if you also push this code somewhere public. You can equally set
`SKIP_DATES` by hand under *Settings → Secrets and variables → Actions →
Variables*, as a comma-separated list.

Skipped days are decided in **your** timezone (`SCHEDULE_TZ`, default
`Asia/Kolkata`), not the runner's UTC — otherwise a late-evening sign-out
would compare against the wrong date. The check happens before a browser
session is opened, so a day off costs nothing.

Prefer a file? Put the same entries in `skip-dates.txt`, one per line, `#` for
comments. Both sources are merged.

---

## Run it unattended

The script has to run *somewhere that's on at the scheduled time*.

> **Browserbase Functions can't do this alone.** It's a runtime for hosting
> code, not a scheduler — the CLI offers only `init`, `dev`, `publish`,
> `invoke`, and the API has no cron endpoint. Something external still has to
> trigger it, so it buys you nothing over the option below.

### Option A — GitHub Actions (recommended: always-on, free)

[`.github/workflows/attendance.yml`](.github/workflows/attendance.yml) is ready
to go. GitHub supplies the schedule and the runner; Browserbase supplies the
browser.

1. **Fork this repo, or use it as a template — make your copy private.** You'll
   be storing your greytHR password in its secrets.
2. **Set your times.** GitHub cron is UTC only. Get your two lines with:
   ```bash
   npm run cron -- 09:05 17:15 Asia/Kolkata
   ```
   Paste them over the `cron:` lines in the workflow, and update the matching
   `SIGNIN_CRON` / `SIGNOUT_CRON` values in the *Decide mode* step.
3. **Add three secrets** under *Settings → Secrets and variables → Actions*:
   `BROWSERBASE_API_KEY`, `GREYTHR_USERNAME`, `GREYTHR_PASSWORD`.
4. **Add one variable** on the *Variables* tab: `GREYTHR_SUBDOMAIN`.
5. **Test it.** *Actions → greytHR attendance → Run workflow*, with **dry run**
   ticked. Then untick it for a real one.

Each run uploads its screenshot as an artifact (kept 7 days), so you can see
what happened from the run page.

⚠️ **GitHub disables scheduled workflows after 60 days of repo inactivity.** A
quiet repo will quietly stop signing you in. Watch for the warning email, or
push something occasionally.

### Option B — cron on your own machine

Only fires when the machine is awake, which makes it a poor fit for something
you rely on daily.

```cron
5  9  * * 1-5  cd /path/to/greythr-attendance && /usr/bin/env node greythr-attendance.mjs signin  >> bot.log 2>&1
15 17 * * 1-5  cd /path/to/greythr-attendance && /usr/bin/env node greythr-attendance.mjs signout >> bot.log 2>&1
```

> `which node` gives the exact path if `/usr/bin/env node` doesn't resolve
> under cron.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `ReferenceError: WebSocket is not defined` | Node < 22. Upgrade. |
| `API key not valid` | A provider LLM key is set to a placeholder. Unset it. |
| `BROWSERBASE_PROJECT_ID is required` | You're on Stagehand v2. This needs v4 — `npm install`. |
| Button never found, both modes | Your tenant uses different labels. Set `GREYTHR_SIGNIN_LABEL` / `GREYTHR_SIGNOUT_LABEL`. |
| Login page never clears | Watch the replay link. Wrong credentials, or an MFA prompt this script doesn't handle. |
| Scheduled runs stopped | GitHub disabled the workflow after 60 days idle. Re-enable it in the Actions tab. |

Every failure prints the replay link. Watching it is almost always faster than
reading the log.

---

## Caveats

- **Bot detection.** greytHR let a plain Browserbase browser log in without
  complaint in testing. If your tenant is stricter, you'd need Browserbase
  **Proxies / Verified** sessions, which are paid.
- **MFA is not supported.** If your login requires a second factor, this won't
  get past it.
- **Your employer's rules are your problem.** Automating attendance may breach
  your company's policy. That's between you and them.
- **Scheduler drift.** GitHub cron is best-effort; runs can be minutes late. And
  it doesn't observe DST, so re-run `npm run cron` after a clock change.

---

## Files

| File | What it is |
|---|---|
| `greythr-attendance.mjs` | The automation script |
| `scripts/cron-times.mjs` | Converts local times to UTC cron lines |
| `scripts/skip.mjs` | Marks days off (`npm run skip`) |
| `.github/workflows/attendance.yml` | The weekday cloud schedule |
| `AGENTS.md` | Setup notes and guardrails for AI coding agents |
| `.env.example` | Config template |
| `.env` | Your real config (git-ignored, you create it) |

MIT licensed. Not affiliated with greytHR or Browserbase.
