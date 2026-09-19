/**
 * comm-log-feed.ts — logMessage and emitFeed helpers.
 * Handles message audit log (JSONL) and feed event emission to server plugin pipeline.
 */

import { loadConfig } from "../../config";
import { appendFile, mkdir } from "fs/promises";
import { pruneJsonlFile } from "../../vendor/mpr-plugins/messages/retention";
import { hostname } from "os";
import { dirname } from "path";
import { buildMessageLifecycleFeedEvent, type MessageLifecycleInput } from "../../lib/message-events";
import { mawMessageLogPath } from "../../core/xdg";

/** Log message to the XDG data-primary maw-log.jsonl with normalized from/to. */
export async function logMessage(from: string, to: string, msg: string, route: string) {
  const config = loadConfig();
  if (!config.node) throw new Error("config.node is required — set 'node' in maw.config.json");
  const normalizedFrom = from.includes(":") ? from : `${config.node}:${from}`;
  const logFile = mawMessageLogPath();
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    from: normalizedFrom,
    to,
    msg: msg.slice(0, 500),
    host: hostname(),
    route,
  }) + "\n";
  try { await mkdir(dirname(logFile), { recursive: true }); await appendFile(logFile, line); pruneJsonlFile(logFile); } catch {}
}

/** Emit feed event to server plugin pipeline (CLI → server bridge) */
// Returns the in-flight POST so exit-adjacent callers can AWAIT the ledger
// write before process.exit — otherwise the fire-and-forget fetch is killed
// with the process and the event never reaches the daemon (item2 F2). Happy-path
// callers ignore the return and stay fire-and-forget. When timeoutMs is given the
// request self-aborts (a stalled daemon can never hang the caller) — item2 F2
// bounded-deadline (Riddler review 2026-09-19).
export function emitFeed(event: string, oracle: string, node: string, message: string, port: number, data?: unknown, timeoutMs?: number): Promise<void> {
  return fetch(`http://localhost:${port}/api/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, oracle, host: node, message, ts: Date.now(), ...(data !== undefined ? { data } : {}) }),
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  }).then(() => {}, () => {});
}

// Await a feed write but never longer than `ms` — the deadline resolves the wait
// even if the feed promise stalls, so the caller's error path + process.exit run
// on time regardless of daemon health. The abandoned POST dies with the process.
export function flushWithDeadline(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    const done = () => { clearTimeout(t); resolve(); };
    Promise.resolve(p).then(done, done);
  });
}

/** Emit typed message lifecycle event to the server plugin pipeline. */
export function emitMessageLifecycle(input: MessageLifecycleInput, port: number) {
  const event = buildMessageLifecycleFeedEvent(input);
  fetch(`http://localhost:${port}/api/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  }).catch(() => {});
}
