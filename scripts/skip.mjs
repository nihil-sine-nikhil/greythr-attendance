#!/usr/bin/env node
/**
 * Mark days the bot should sit out, without editing any files.
 *
 *   npm run skip                        show what's currently skipped
 *   npm run skip -- tomorrow            not going in tomorrow
 *   npm run skip -- today
 *   npm run skip -- 2026-08-20
 *   npm run skip -- 2026-08-20..2026-08-25    on leave for a week
 *   npm run skip -- pause               stop entirely until resumed
 *   npm run skip -- resume              lift a pause
 *   npm run skip -- clear               clear everything
 *   npm run skip -- remove 2026-08-20
 *
 * Stores the list in the GitHub repository variable SKIP_DATES, so your leave
 * calendar lives in repo settings rather than in a committed file — which
 * matters if you also push this code to a public repo.
 *
 * Requires the GitHub CLI (`gh`), authenticated: https://cli.github.com
 */

import { execFileSync } from "node:child_process";

const TZ = process.env.SCHEDULE_TZ || "Asia/Kolkata";
const VAR = "SKIP_DATES";

function gh(args, { allowFail = false } = {}) {
  try {
    // Capture stderr rather than letting it through: an unset variable is a
    // normal state here, and gh's "not found" line reads like a failure.
    return execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    if (allowFail) return null;
    const msg = (err.stderr || err.message || "").trim();
    if (/not found|ENOENT/i.test(msg)) {
      console.error(
        `\n✗ The GitHub CLI isn't installed. Get it from https://cli.github.com\n` +
          `  Or set the SKIP_DATES variable by hand under\n` +
          `  Settings → Secrets and variables → Actions → Variables.\n`
      );
    } else {
      console.error(`\n✗ gh failed: ${msg}\n`);
    }
    process.exit(1);
  }
}

const dateIn = (tz, offsetDays = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
};

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isRange = (s) => /^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(s);

function read() {
  const raw = gh(["variable", "get", VAR], { allowFail: true }) || "";
  return raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}

function write(entries) {
  const value = [...new Set(entries)].sort().join(",");
  if (value) {
    gh(["variable", "set", VAR, "--body", value]);
  } else {
    gh(["variable", "delete", VAR], { allowFail: true });
  }
  return value;
}

function show(entries) {
  const today = dateIn(TZ);
  if (!entries.length) {
    console.log(`\n  Nothing skipped. Bot runs on every scheduled day.\n`);
    return;
  }
  console.log(`\n  Skipping (today is ${today} in ${TZ}):\n`);
  for (const e of entries) {
    const past =
      (isDay(e) && e < today) || (isRange(e) && e.split("..")[1] < today);
    const mark = /^pause/i.test(e) ? "⏸" : past ? "·" : "→";
    const note = /^pause/i.test(e)
      ? "  paused indefinitely — `npm run skip -- resume` to lift"
      : past
        ? "  (past)"
        : "";
    console.log(`    ${mark} ${e}${note}`);
  }
  console.log();
}

const args = process.argv.slice(2);
let entries = read();

if (args.length === 0) {
  show(entries);
  process.exit(0);
}

const cmd = args[0].toLowerCase();

if (cmd === "clear") {
  write([]);
  console.log(`\n  Cleared. Bot runs on every scheduled day.\n`);
} else if (cmd === "resume") {
  const before = entries.length;
  entries = entries.filter((e) => !/^pause/i.test(e));
  write(entries);
  console.log(
    before === entries.length
      ? `\n  Wasn't paused — nothing to do.\n`
      : `\n  Resumed.\n`
  );
  show(entries);
} else if (cmd === "pause") {
  write([...entries, "PAUSE"]);
  console.log(`\n  ⏸ Paused. Nothing will run until \`npm run skip -- resume\`.\n`);
} else if (cmd === "remove") {
  const target = args[1];
  if (!target) {
    console.error(`\n✗ Which one? e.g. npm run skip -- remove 2026-08-20\n`);
    process.exit(1);
  }
  const next = entries.filter((e) => e !== target);
  if (next.length === entries.length) {
    console.error(`\n✗ "${target}" isn't in the list.\n`);
    show(entries);
    process.exit(1);
  }
  write(next);
  console.log(`\n  Removed ${target}.\n`);
  show(next);
} else {
  let entry = cmd;
  if (entry === "today") entry = dateIn(TZ, 0);
  else if (entry === "tomorrow") entry = dateIn(TZ, 1);

  if (!isDay(entry) && !isRange(entry)) {
    console.error(
      `\n✗ Didn't understand "${args[0]}".\n\n` +
        `  Try:  today | tomorrow | 2026-08-20 | 2026-08-20..2026-08-25\n` +
        `        pause | resume | clear | remove <entry>\n`
    );
    process.exit(1);
  }

  if (isRange(entry)) {
    const [a, b] = entry.split("..");
    if (a > b) entry = `${b}..${a}`;
  }

  if (entries.includes(entry)) {
    console.log(`\n  ${entry} was already skipped.\n`);
    show(entries);
    process.exit(0);
  }

  const next = [...entries, entry];
  write(next);
  console.log(`\n  ✓ Skipping ${entry}.\n`);
  show(next);
}
