import { describe, expect, test } from "bun:test";
import {
  HEY_PANE_SAFE_CAP,
  shouldAutoRouteToInbox,
  buildInboxPointer,
} from "../src/commands/shared/comm-send";

// Fix: hey truncation class (2026-09-19, receipt fix-hey-truncation).
// F2 routing decision (len/newline/--inbox matrix) + F3 cap + pointer shape.
describe("F2 shouldAutoRouteToInbox — len/newline/--inbox matrix", () => {
  const short = "x".repeat(10);
  const atCap = "x".repeat(HEY_PANE_SAFE_CAP);        // >= cap → route
  const belowCap = "x".repeat(HEY_PANE_SAFE_CAP - 1); // < cap, no \n → pane
  const long1500 = "x".repeat(1500);                  // 1a class → route
  const multiline = "line1\nline2\nline3";            // 1b class → route

  test("short single-line stays on pane", () => {
    expect(shouldAutoRouteToInbox(short, false)).toBe(false);
    expect(shouldAutoRouteToInbox(belowCap, false)).toBe(false);
  });

  test("length >= cap routes to inbox (closes 1a)", () => {
    expect(shouldAutoRouteToInbox(atCap, false)).toBe(true);
    expect(shouldAutoRouteToInbox(long1500, false)).toBe(true);
  });

  test("embedded newline routes to inbox — LF, CR-only, CRLF (closes 1b, Riddler MED)", () => {
    expect(shouldAutoRouteToInbox(multiline, false)).toBe(true);
    expect(shouldAutoRouteToInbox("a\nb", false)).toBe(true);   // LF
    expect(shouldAutoRouteToInbox("a\rb", false)).toBe(true);   // CR-only — was missed
    expect(shouldAutoRouteToInbox("a\r\nb", false)).toBe(true); // CRLF
  });

  test("cap is a BYTE budget — multi-byte scripts route below the UTF-16 cap (Riddler HIGH)", () => {
    const thai400 = "ก".repeat(400);   // 400 UTF-16 units, 1200 UTF-8 bytes
    expect(thai400.length).toBeLessThan(HEY_PANE_SAFE_CAP);
    expect(Buffer.byteLength(thai400, "utf8")).toBeGreaterThanOrEqual(HEY_PANE_SAFE_CAP);
    expect(shouldAutoRouteToInbox(thai400, false)).toBe(true);
    expect(shouldAutoRouteToInbox("文".repeat(350), false)).toBe(true);  // CJK, 1050 bytes
    expect(shouldAutoRouteToInbox("😀".repeat(300), false)).toBe(true);  // emoji, 1200 bytes
    // short multi-byte string under the byte cap still stays on the pane
    expect(shouldAutoRouteToInbox("ก".repeat(10), false)).toBe(false);
  });

  test("--inbox (inboxOnly) never auto-routes — its path is unchanged", () => {
    expect(shouldAutoRouteToInbox(long1500, true)).toBe(false);
    expect(shouldAutoRouteToInbox(multiline, true)).toBe(false);
    expect(shouldAutoRouteToInbox("ก".repeat(400), true)).toBe(false);
  });

  test("cap is a conservative constant below the cooked 1024-byte floor", () => {
    expect(HEY_PANE_SAFE_CAP).toBeLessThan(1024);
    expect(HEY_PANE_SAFE_CAP).toBeGreaterThan(0);
  });
});

describe("F2 buildInboxPointer — single safe line", () => {
  test("pointer never contains a newline (would re-introduce 1b)", () => {
    const p = buildInboxPointer("mba:maw-maint", "line1\nline2\nline3", "2026-09-19_x.md");
    expect(p.includes("\n")).toBe(false);
  });

  test("pointer stays short (well under the safe cap), incl. multi-byte bodies", () => {
    expect(buildInboxPointer("mba:maw-maint", "y".repeat(5000), "2026-09-19_x.md").length)
      .toBeLessThan(HEY_PANE_SAFE_CAP);
    // byte budget holds even for a 4-byte-per-char emoji body
    const pe = buildInboxPointer("mba:maw-maint", "😀".repeat(5000), "2026-09-19_x.md");
    expect(Buffer.byteLength(pe, "utf8")).toBeLessThan(HEY_PANE_SAFE_CAP);
    expect(pe.includes("\n")).toBe(false);
  });

  test("pointer carries sender, a preview, and the inbox filename", () => {
    const p = buildInboxPointer("mba:maw-maint", "hello world body", "2026-09-19_x.md");
    expect(p).toContain("mba:maw-maint");
    expect(p).toContain("hello world");
    expect(p).toContain("2026-09-19_x.md");
  });
});
