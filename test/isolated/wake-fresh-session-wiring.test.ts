/**
 * buildWakeCommand wiring: `freshSession` routes exactly like `freshLaunch`.
 *
 * Moved out of test/wake-fresh-session.test.ts: buildWakeCommand loads the
 * real config through import-frozen CONFIG_DIR (src/core/paths), so on a bare
 * runner (CI) it threw "no default engine configured". Isolated (fresh global
 * environment per file) so MAW_CONFIG_DIR can point at a fixture before the
 * module graph is imported.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const CONFIG_DIR = mkdtempSync(join(tmpdir(), "maw-fresh-session-wiring-"));
writeFileSync(
  join(CONFIG_DIR, "maw.config.json"),
  JSON.stringify({ commands: { default: "claude --dangerously-skip-permissions --continue" } }),
);
process.env.MAW_CONFIG_DIR = CONFIG_DIR;

const { buildWakeCommand } = await import("../../src/commands/shared/wake-cmd");

afterAll(() => {
  rmSync(CONFIG_DIR, { recursive: true, force: true });
});

describe("buildWakeCommand wiring: freshSession routes exactly like freshLaunch", () => {
  test("freshSession produces the same launch line as freshLaunch, without --continue", () => {
    const viaSession = buildWakeCommand("w", "/repos/x", { freshSession: true });
    const viaLaunch = buildWakeCommand("w", "/repos/x", { freshLaunch: true });
    expect(viaSession).toBe(viaLaunch);
    expect(viaSession).not.toContain("--continue");
  });

  test("neither flag → the two fresh forms still agree, and keep --continue", () => {
    const a = buildWakeCommand("w", "/repos/x", {});
    const b = buildWakeCommand("w", "/repos/x", { freshSession: false, freshLaunch: false });
    expect(a).toBe(b);
    expect(a).toContain("--continue");
  });
});
