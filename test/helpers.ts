import type { Level, Writer } from "../src/index.js";

/** Writer を差し替えて出力を配列に集める */
export function collect(): { lines: Array<{ level: Level; line: string }>; write: Writer } {
  const lines: Array<{ level: Level; line: string }> = [];
  return { lines, write: (level, line) => lines.push({ level, line }) };
}

export const FIXED_TIME = new Date("2026-09-09T01:23:45.678Z");
