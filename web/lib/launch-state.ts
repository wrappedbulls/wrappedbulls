// launch-state.ts — RUNTIME launch-state, read from a JSON file on
// every request. Server-side only.
//
// WHY THIS EXISTS (the most important lesson from the last launch):
// `NEXT_PUBLIC_*` env vars are inlined into the client bundle at BUILD
// time. When the previous launch needed to roll the site back from
// "live" to "pre-launch", flipping the env var did nothing for
// browsers that already had the bundle — the only "rollback" was a
// full rebuild, which 502'd the site at the worst possible moment.
// See docs/POSTMORTEM.md §3 and docs/LESSONS_LEARNED.md L1.
//
// The fix: launch state is a RUNTIME fact, read from a file a running
// process re-reads on every request. Flipping the site is a single
// atomic file write — no rebuild, no downtime.
//
// State file resolution order:
//   1. process.env.LAUNCH_STATE_FILE  (production — systemd sets this
//      to /var/lib/<slug>/state.json)
//   2. <web>/config/launch-state.json (dev — gitignored, optional)
//   3. built-in safe default: { state: "pre-launch", tokenMint: null }
//
// A malformed or unreadable file degrades to the safe default and
// logs a warning. It NEVER throws — a broken state file must not take
// the site down (fail safe, not fail closed).
//
// To flip the site live (production):
//   echo '{"state":"live","tokenMint":"<mint>"}' \
//     > /var/lib/<slug>/state.json
// To roll back:
//   echo '{"state":"pre-launch"}' > /var/lib/<slug>/state.json
// Both take effect on the next page load. No deploy.

import fs from "node:fs";
import path from "node:path";

export type LaunchState = "pre-launch" | "live";

export interface LaunchStateData {
  /** Current launch phase. */
  state: LaunchState;
  /**
   * The $TOKEN mint address (base58), or null when not yet launched.
   * Set at the same time as flipping to "live" so the flip is atomic.
   * The on-chain bank is still the authority for wrap/unwrap; this
   * value only feeds display badges.
   */
  tokenMint: string | null;
  /** ISO timestamp the file was last written, if the writer set it. */
  updatedAt: string | null;
}

const SAFE_DEFAULT: LaunchStateData = {
  state: "pre-launch",
  tokenMint: null,
  updatedAt: null,
};

function resolveStateFilePath(): string | null {
  const fromEnv = (process.env.LAUNCH_STATE_FILE || "").trim();
  if (fromEnv) return fromEnv;
  // Dev fallback. process.cwd() is the web/ dir during next dev/build.
  const devPath = path.join(process.cwd(), "config", "launch-state.json");
  if (fs.existsSync(devPath)) return devPath;
  return null;
}

function isValidMint(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)
  );
}

/**
 * Read the current launch state from disk. Called per request from
 * server components and the /api/launch-state route. Never throws.
 */
export function readLaunchState(): LaunchStateData {
  const filePath = resolveStateFilePath();
  if (!filePath) return SAFE_DEFAULT;

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    // File missing or unreadable — safe default. Not an error worth
    // logging on every request; missing-file is a valid dev state.
    return SAFE_DEFAULT;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(
      `[launch-state] ${filePath} is not valid JSON — defaulting to pre-launch`,
    );
    return SAFE_DEFAULT;
  }

  const state: LaunchState = parsed?.state === "live" ? "live" : "pre-launch";
  const tokenMint = isValidMint(parsed?.tokenMint) ? parsed.tokenMint : null;
  const updatedAt =
    typeof parsed?.updatedAt === "string" ? parsed.updatedAt : null;

  return { state, tokenMint, updatedAt };
}

/** Convenience: is the site in pre-launch mode right now? */
export function isPreLaunch(): boolean {
  return readLaunchState().state === "pre-launch";
}

/** Current launch phase. */
export function getLaunchState(): LaunchState {
  return readLaunchState().state;
}

/**
 * $TOKEN mint for display badges. Null until the operator flips the
 * site live with the mint set. Wrap/unwrap read the mint from the
 * on-chain bank, not from here.
 */
export function getTokenMint(): string | null {
  return readLaunchState().tokenMint;
}
