/**
 * Regression: a legacy/hand-written fleet JSON without a `windows` array made
 * every `maw wake` crash ("session.windows.filter is not a function") once
 * recoverExactFleetChildWindow (07b22aa1) started iterating fleet sessions on
 * the main wake path. Live incident 2026-09-05 (MAW-FLEET-QUARANTINE-01): two
 * such files (#484 test leftovers) bricked wake fleet-wide on the control node.
 *
 * loadFleet must normalize a missing/invalid `windows` to [] so consumers can
 * iterate unconditionally.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadFleet, loadFleetEntries } from "../../src/core/fleet/fleet-load-core";

const DIR = mkdtempSync(join(tmpdir(), "maw-fleet-legacy-windows-"));
writeFileSync(join(DIR, "concurrent-484.json"), JSON.stringify({ writer: 0 }));
writeFileSync(join(DIR, "serial-484.json"), JSON.stringify({ a: 1 }));
writeFileSync(join(DIR, "healthy.json"), JSON.stringify({
  name: "07-healthy",
  windows: [{ name: "healthy-oracle", repo: "org/repo" }],
}));

afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
});

describe("fleet-load-core — legacy files without windows", () => {
  test("loadFleet normalizes a missing windows array to []", () => {
    const sessions = loadFleet([DIR]);
    expect(sessions).toHaveLength(3);
    for (const session of sessions) {
      expect(Array.isArray(session.windows)).toBe(true);
    }
    const healthy = sessions.find((s) => s.name === "07-healthy");
    expect(healthy?.windows).toHaveLength(1);
  });

  test("loadFleetEntries carries the same normalization", () => {
    for (const entry of loadFleetEntries([DIR])) {
      expect(entry.session.windows.flatMap((w) => [w.name])).toBeArray();
    }
  });
});
