#!/usr/bin/env node
/**
 * greytHR attendance bot — powered by Browserbase + Stagehand
 * -----------------------------------------------------------
 * Logs into your greytHR portal in a cloud browser and marks attendance.
 *
 *   node greythr-attendance.mjs signin    # mark "Sign In"  (morning)
 *   node greythr-attendance.mjs signout   # mark "Sign Out" (evening)
 *   node greythr-attendance.mjs signout --dry-run   # find, report, don't click
 *
 * If no mode is passed it falls back to the MODE env var, then "signin".
 *
 * Stagehand drives the browser with plain-English instructions
 * (act / observe) instead of brittle CSS selectors, so this keeps working
 * even when your greytHR tenant's markup differs from the next one's.
 *
 * The browser itself runs in Browserbase's cloud — nothing opens on your
 * machine — which is what lets it run unattended on a schedule.
 *
 * Written against Stagehand v4. Needs Node 22+ (Stagehand opens its CDP
 * connection with the global WebSocket, which Node 20 does not have).
 */

import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { Stagehand, browserbase } from "@browserbasehq/stagehand";

const ARGS = process.argv.slice(2);

// signin | signout  (CLI arg wins, then MODE env var, then default)
const MODE = (
  ARGS.find((a) => !a.startsWith("-")) ||
  process.env.MODE ||
  "signin"
).toLowerCase();

// --dry-run finds the attendance button and reports it, but never clicks.
// Use it to check the bot targets the right thing on your tenant without
// touching your real attendance record.
const DRY_RUN = ARGS.includes("--dry-run") || process.env.DRY_RUN === "1";

const API_KEY = process.env.BROWSERBASE_API_KEY;
const USERNAME = process.env.GREYTHR_USERNAME;
const PASSWORD = process.env.GREYTHR_PASSWORD;

// Most greytHR tenants label the attendance toggle "Sign In" / "Sign Out",
// but yours might say "Clock In", "Punch In", "Swipe In"… Override these if
// so — everything else keeps working.
const SIGNIN_LABEL = process.env.GREYTHR_SIGNIN_LABEL || "Sign In";
const SIGNOUT_LABEL = process.env.GREYTHR_SIGNOUT_LABEL || "Sign Out";

// Leave STAGEHAND_MODEL unset to let Browserbase's Model Gateway pick a model
// for you — that needs no provider key of your own. Set it to pin one, e.g.
// "google/gemini-2.5-flash".
// https://docs.browserbase.com/platform/model-gateway/overview
const MODEL_NAME = process.env.STAGEHAND_MODEL;

/**
 * Your portal address. Give either the full URL or just your company's
 * greytHR subdomain — "acme" or "acme.greythr.com" both work.
 */
function resolvePortalUrl() {
  const url = process.env.GREYTHR_URL?.trim();
  if (url) return url;

  const sub = process.env.GREYTHR_SUBDOMAIN?.trim();
  if (sub) {
    const host = sub.includes(".") ? sub : `${sub}.greythr.com`;
    return `https://${host}/v3/portal/`;
  }

  return null;
}

const PORTAL_URL = resolvePortalUrl();

function requireEnv() {
  const missing = [];
  if (!API_KEY) missing.push("BROWSERBASE_API_KEY");
  if (!USERNAME) missing.push("GREYTHR_USERNAME");
  if (!PASSWORD) missing.push("GREYTHR_PASSWORD");
  if (!PORTAL_URL) missing.push("GREYTHR_SUBDOMAIN (or GREYTHR_URL)");

  if (missing.length) {
    console.error(
      `\n✗ Missing required config: ${missing.join(", ")}\n\n` +
        `  Running locally?  Copy .env.example to .env and fill it in:\n` +
        `      cp .env.example .env\n\n` +
        `  Running in GitHub Actions?  Add these as repository secrets under\n` +
        `  Settings → Secrets and variables → Actions.\n`
    );
    process.exit(1);
  }

  if (!["signin", "signout"].includes(MODE)) {
    console.error(
      `\n✗ Unknown mode "${MODE}". Use "signin" or "signout".\n` +
        `  e.g. node greythr-attendance.mjs signout --dry-run\n`
    );
    process.exit(1);
  }
}

/**
 * Browserbase needs a projectId to open a session, but you shouldn't have to
 * look it up by hand — your API key already identifies your account. So ask
 * the Browserbase API which project the key belongs to. Set
 * BROWSERBASE_PROJECT_ID to skip this lookup, or to pin a specific project if
 * your account has several.
 */
async function resolveProjectId() {
  if (process.env.BROWSERBASE_PROJECT_ID) {
    return process.env.BROWSERBASE_PROJECT_ID;
  }

  const res = await fetch("https://api.browserbase.com/v1/projects", {
    headers: { "X-BB-API-Key": API_KEY },
  });

  if (!res.ok) {
    throw new Error(
      `Could not look up your Browserbase project (HTTP ${res.status}). ` +
        `Check BROWSERBASE_API_KEY, or set BROWSERBASE_PROJECT_ID by hand ` +
        `from https://browserbase.com/settings`
    );
  }

  const projects = await res.json();
  if (!Array.isArray(projects) || projects.length === 0) {
    throw new Error(
      "Your Browserbase account has no projects — create one at " +
        "https://browserbase.com/settings"
    );
  }

  return projects[0].id;
}

async function run() {
  requireEnv();

  console.log(
    `\n▶ greytHR attendance bot — mode: ${MODE.toUpperCase()}` +
      (DRY_RUN ? "  (dry run — will not click)" : "")
  );
  console.log(`  Portal: ${PORTAL_URL}`);

  const projectId = await resolveProjectId();

  // Open the cloud browser first, so the replay link is printed even if
  // Stagehand itself fails to start.
  const browser = await browserbase.launch({ apiKey: API_KEY, projectId });
  const sessionId = browser.sessionId;
  if (sessionId) {
    console.log(
      `\n  Live view / replay: https://www.browserbase.com/sessions/${sessionId}\n`
    );
  }

  const stagehand = await Stagehand.create({
    apiKey: API_KEY, // also authorises the Model Gateway — no LLM key needed
    browser,
    ...(MODEL_NAME ? { model: { modelName: MODEL_NAME } } : {}),
  });

  try {
    // --- 1. Open the portal ------------------------------------------------
    const page = await stagehand.browser.context.newPage();
    await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", 15000).catch(() => {});

    // --- 2. Log in (only if a login form is present) -----------------------
    // observe() first so we skip login if the session is somehow already in.
    const loginFields = await stagehand.observe(
      "the username/email login input and the password input",
      { page }
    );

    if (loginFields.data.length > 0) {
      console.log("  Logging in…");
      await stagehand.act(
        "type %username% into the username or email login field",
        { page, variables: { username: USERNAME } }
      );
      await stagehand.act("type %password% into the password field", {
        page,
        variables: { password: PASSWORD },
      });
      await stagehand.act("click the Log In button", { page });

      await page.waitForLoadState("networkidle", 30000).catch(() => {});
    } else {
      console.log("  Already authenticated — skipping login.");
    }

    // --- 3. Mark attendance ------------------------------------------------
    // greytHR's attendance card has ONE toggle button: it reads "Sign In"
    // while you're out and "Sign Out" once you're in. So the button we want
    // only exists in the state we're trying to leave — not finding it means
    // the day is already marked, which is a safe no-op rather than an error.
    const buttonLabel = MODE === "signin" ? SIGNIN_LABEL : SIGNOUT_LABEL;
    const flippedLabel = MODE === "signin" ? SIGNOUT_LABEL : SIGNIN_LABEL;
    console.log(`  Looking for the attendance "${buttonLabel}" button…`);

    // Be specific about WHICH control. greytHR's header has a power icon that
    // logs you out of the portal entirely — clicking that instead of the
    // swipe button would leave attendance unmarked.
    const attendanceButton = await stagehand.observe(
      `the "${buttonLabel}" swipe button inside the attendance card — the ` +
        `card showing today's date, the shift name and a running clock, ` +
        `next to the "View Swipes" link. Do NOT return the power / logout ` +
        `icon in the top-right page header, or anything in the left sidebar.`,
      { page }
    );

    if (attendanceButton.data.length === 0) {
      console.log(
        `  ⚠ Could not find a "${buttonLabel}" button — you may already be ` +
          `${MODE === "signin" ? "signed in" : "signed out"} for today. ` +
          `Check the replay link above.`
      );
    } else {
      const target = attendanceButton.data[0];
      console.log(`    → matched: ${target.description}`);
      console.log(`    → selector: ${target.selector}`);

      // Refuse to click something that looks like the portal logout control
      // rather than the attendance swipe button.
      if (
        /log ?out|sign out of|power|header|logout/i.test(target.description) &&
        !/attendance|swipe|shift/i.test(target.description)
      ) {
        throw new Error(
          `Refusing to click — the match looks like the portal logout ` +
            `control, not the attendance button: "${target.description}"`
        );
      }

      if (DRY_RUN) {
        console.log(`  ⏸ Dry run — not clicking.`);
      } else {
        await stagehand.act(target, { page });
        // Give the confirmation toast a moment to appear.
        await page.waitForTimeout(3000);
        console.log(`  ✓ "${buttonLabel}" clicked.`);

        // Confirm the toggle actually flipped, so a silent miss can't look
        // like success.
        const after = await stagehand.observe(
          `a button labelled exactly "${flippedLabel}" inside the attendance ` +
            `card (the card with today's date, the shift name and the ` +
            `running clock). Return nothing if no such button is there.`,
          { page }
        );

        if (after.data.length > 0) {
          console.log(
            `  ✓ Confirmed — the attendance button now reads "${flippedLabel}".`
          );
        } else {
          console.log(
            `  ⚠ Clicked, but the button does not now read "${flippedLabel}". ` +
              `The swipe may not have registered — check the screenshot and ` +
              `the replay link above.`
          );
          process.exitCode = 1;
        }
      }
    }

    // --- 4. Capture proof --------------------------------------------------
    const shot = await page.screenshot();
    await writeFile(`attendance-${MODE}.png`, shot);
    console.log(`  Screenshot saved: attendance-${MODE}.png`);
  } catch (err) {
    console.error("\n✗ Something went wrong:", err?.message || err);
    if (sessionId) {
      console.error(
        `  Watch the replay to see exactly where: ` +
          `https://www.browserbase.com/sessions/${sessionId}`
      );
    }
    process.exitCode = 1;
  } finally {
    await stagehand.close().catch(() => {});
    await browser.close().catch(() => {});
    console.log("  Session closed.\n");
  }
}

run();
