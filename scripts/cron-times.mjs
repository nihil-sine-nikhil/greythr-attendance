#!/usr/bin/env node
/**
 * Work out the UTC cron lines for your local sign-in / sign-out times.
 *
 * GitHub Actions cron is always UTC and has no timezone option, which is the
 * single easiest thing to get wrong when setting this up. Rather than doing
 * the arithmetic yourself:
 *
 *   npm run cron -- 09:05 17:15 Asia/Kolkata
 *   npm run cron -- 09:30 18:00 Europe/London
 *
 * Timezone defaults to your machine's. Copy the two lines it prints into
 * .github/workflows/attendance.yml.
 */

const [signinArg, signoutArg, tzArg] = process.argv.slice(2);

if (!signinArg || !signoutArg) {
  console.error(
    `\nUsage: npm run cron -- <signin HH:MM> <signout HH:MM> [IANA timezone]\n` +
      `   e.g. npm run cron -- 09:05 17:15 Asia/Kolkata\n`
  );
  process.exit(1);
}

const TZ = tzArg || Intl.DateTimeFormat().resolvedOptions().timeZone;

function parseHHMM(s, label) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) {
    console.error(`\n✗ ${label} must look like HH:MM (24-hour), got "${s}"\n`);
    process.exit(1);
  }
  const [h, min] = [Number(m[1]), Number(m[2])];
  if (h > 23 || min > 59) {
    console.error(`\n✗ ${label} "${s}" is not a real time.\n`);
    process.exit(1);
  }
  return { h, min };
}

/**
 * Offset of `tz` from UTC, in minutes, on a given date. Positive means ahead
 * of UTC. Derived by formatting one instant in both zones rather than
 * hardcoding a table, so DST is handled for whatever date we probe.
 */
function offsetMinutes(tz, at) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(
    fmt.formatToParts(at).filter((x) => x.type !== "literal")
       .map((x) => [x.type, Number(x.value)])
  );
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return Math.round((asUTC - at.getTime()) / 60000);
}

try {
  Intl.DateTimeFormat("en-US", { timeZone: TZ });
} catch {
  console.error(`\n✗ "${TZ}" is not a recognised IANA timezone.\n`);
  process.exit(1);
}

// Probe on an upcoming weekday so the offset reflects the DST state that will
// actually be in force.
const probe = new Date();
probe.setUTCDate(probe.getUTCDate() + 3);
const offset = offsetMinutes(TZ, probe);

function toCron({ h, min }) {
  const total = h * 60 + min - offset;
  // Positive modulo — a local morning can land on the previous UTC day.
  const wrapped = ((total % 1440) + 1440) % 1440;
  const dayShift = Math.floor(total / 1440);
  return {
    cron: `${wrapped % 60} ${Math.floor(wrapped / 60)} * * 1-5`,
    dayShift,
  };
}

const signin = parseHHMM(signinArg, "sign-in time");
const signout = parseHHMM(signoutArg, "sign-out time");
const a = toCron(signin);
const b = toCron(signout);

const sign = offset >= 0 ? "+" : "-";
const abs = Math.abs(offset);
console.log(
  `\n${TZ} is UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:` +
    `${String(abs % 60).padStart(2, "0")} on ${probe.toISOString().slice(0, 10)}\n`
);
console.log(`Paste into .github/workflows/attendance.yml:\n`);
console.log(`    - cron: "${a.cron}"   # ${signinArg} ${TZ}, Mon–Fri — Sign In`);
console.log(`    - cron: "${b.cron}"   # ${signoutArg} ${TZ}, Mon–Fri — Sign Out`);

if (a.dayShift || b.dayShift) {
  console.log(
    `\n⚠ One of these crosses midnight UTC, so the UTC weekday differs from\n` +
      `  your local one. "1-5" here means Mon–Fri *in UTC* — double-check the\n` +
      `  edge days if that matters to you.`
  );
}

if (/^(Europe|America|Australia)\//.test(TZ)) {
  console.log(
    `\nNote: ${TZ} observes DST, but GitHub cron does not. Re-run this after\n` +
      `each clock change and update the workflow, or accept a one-hour drift.`
  );
}
console.log();
