# greytHR Attendance Bot 🕐

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
| `.github/workflows/attendance.yml` | The weekday cloud schedule |
| `.env.example` | Config template |
| `.env` | Your real config (git-ignored, you create it) |

MIT licensed. Not affiliated with greytHR or Browserbase.
