/**
 * Engine-aware retrospective selection for done-autosave's autoSave.
 *
 * Since f657b392 the retro form comes from the window's AUTHORITATIVE engine
 * (fleet runtime.engine via loadFleetEntries / worktree .maw-engine), never
 * pane_current_command, and fail-closes to skip when unresolved:
 *   - claude / unknown names -> sends "/rrr"
 *   - codex / omx / oh-my-codex -> sends "$rrr"
 *   - aider / opencode -> skips the retro entirely (no tmux send, no 10s wait)
 *   - unresolved engine -> skips (fail-closed)
 *
 * Mocks are registered before importing the target module (it captures SDK,
 * reunion, and soul-sync imports at load time).
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mock } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "node:os";
import { join } from "path";

const SANDBOX = mkdtempSync(join(tmpdir(), "maw-done-engine-retro-"));

let hostExecHandler: (command: string) => string | Promise<string> = () => "";
let sentTexts: Array<{ target: string; text: string }> = [];
let fleetEngine: string | null = null;

mock.module("os", () => ({ homedir: () => join(SANDBOX, "home") }));

mock.module("maw-js/sdk", () => ({
  loadFleetEntries: () => fleetEngine === null ? [] : [{
    file: "work.json", path: "/state/fleet/work.json", num: null, groupName: "work",
    session: { name: "work", windows: [{ name: "tile-1", repo: "x/y", runtime: { engine: fleetEngine } }] },
  }],
  hostExec: async (command: string) => await hostExecHandler(command),
  tmux: {
    sendText: async (target: string, text: string) => {
      sentTexts.push({ target, text });
    },
  },
}));

mock.module(import.meta.resolve("../../src/vendor/mpr-plugins/done/internal/reunion-impl"), () => ({
  cmdReunion: async () => {},
}));

mock.module(import.meta.resolve("../../src/vendor/mpr-plugins/done/internal/soul-sync-impl"), () => ({
  cmdSoulSync: async () => [],
}));

const { autoSave } = await import("../../src/vendor/mpr-plugins/done/done-autosave.ts?engine-retro");

beforeEach(() => {
  sentTexts = [];
  fleetEngine = null;
});

afterAll(() => {
  rmSync(SANDBOX, { recursive: true, force: true });
});

function windowEngine(engine: string | null): void {
  fleetEngine = engine;
  hostExecHandler = (command) =>
    command.includes("pane_current_path") ? "/repo/worktree\n" : "";
}

async function captureConsole(fn: () => Promise<void>): Promise<string> {
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (...parts: unknown[]) => { lines.push(parts.map(String).join(" ")); };
  try {
    await fn();
  } finally {
    console.log = originalLog;
  }
  return lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
}

async function withImmediateTimers(fn: () => Promise<void>): Promise<number[]> {
  const original = globalThis.setTimeout;
  const delays: number[] = [];
  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    delays.push(timeout ?? 0);
    if (typeof handler === "function") handler(...args);
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  try {
    await fn();
    return delays;
  } finally {
    globalThis.setTimeout = original;
  }
}

describe("done autosave engine-aware retro", () => {
  for (const engine of ["claude", "node"]) {
    test(`${engine} pane sends /rrr`, async () => {
      windowEngine(engine);
      let delays: number[] = [];
      const output = await captureConsole(async () => {
        delays = await withImmediateTimers(() => autoSave("tile-1", "work", {}));
      });
      expect(sentTexts).toEqual([{ target: "work:tile-1", text: "/rrr" }]);
      expect(delays).toEqual([10_000]);
      expect(output).toContain("/rrr sent (waited 10s)");
    });
  }

  for (const engine of ["codex", "omx", "oh-my-codex"]) {
    test(`${engine} pane sends $rrr`, async () => {
      windowEngine(engine);
      let delays: number[] = [];
      const output = await captureConsole(async () => {
        delays = await withImmediateTimers(() => autoSave("tile-1", "work", {}));
      });
      expect(sentTexts).toEqual([{ target: "work:tile-1", text: "$rrr" }]);
      expect(delays).toEqual([10_000]);
      expect(output).toContain("$rrr sent (waited 10s)");
    });
  }

  for (const engine of ["aider", "opencode"]) {
    test(`${engine} pane skips the retro entirely`, async () => {
      windowEngine(engine);
      let delays: number[] = [];
      const output = await captureConsole(async () => {
        delays = await withImmediateTimers(() => autoSave("tile-1", "work", {}));
      });
      // No retro command sent and no 10s wait incurred.
      expect(sentTexts).toEqual([]);
      expect(delays).toEqual([]);
      expect(output).toContain("no retrospective command for this engine");
      // Git auto-save still runs for skipped engines.
      expect(output).toContain("committed changes");
    });

    test(`${engine} dry-run announces the skip without sending`, async () => {
      windowEngine(engine);
      const output = await captureConsole(() => autoSave("tile-1", "work", { dryRun: true }));
      expect(sentTexts).toEqual([]);
      expect(output).toContain("would skip retro");
      expect(output).not.toContain("would send");
    });
  }

  test("unresolved engine (no fleet record, no marker) skips the retro fail-closed", async () => {
    windowEngine(null);
    let delays: number[] = [];
    const output = await captureConsole(async () => {
      delays = await withImmediateTimers(() => autoSave("tile-1", "work", {}));
    });
    expect(sentTexts).toEqual([]);
    expect(delays).toEqual([]);
    expect(output).toContain("no retrospective command for this engine");
  });
});
