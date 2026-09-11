import { describe, expect, it } from "vitest";

import { LEVELS } from "../src/level.js";

import { createCoreLogger, textFormat } from "../src/output.js";
import { collect, FIXED_TIME } from "./helpers.js";

function makeLogger() {
  const out = collect();
  const log = createCoreLogger({
    name: "bff",
    level: "DEBUG",
    format: textFormat,
    write: out.write,
    now: () => FIXED_TIME,
  });
  return { log, last: () => out.lines.at(-1)?.line };
}

describe("textFormat (ローカル向け)", () => {
  it("timestamp / severity / name / message を 1 行に並べる", () => {
    const { log, last } = makeLogger();
    log.info("task accepted");
    expect(last()).toBe("2026-09-09T01:23:45.678Z INFO     bff  task accepted");
  });

  it("severity は 8 桁に揃える (CRITICAL が最長)", () => {
    const { log, last } = makeLogger();
    log.critical("x");
    expect(last()).toBe("2026-09-09T01:23:45.678Z CRITICAL bff  x");
    log.warn("y");
    expect(last()).toBe("2026-09-09T01:23:45.678Z WARNING  bff  y");
  });

  it("フィールドがあれば末尾に JSON で付ける", () => {
    const { log, last } = makeLogger();
    log.child({ site: "a" }).info("m", { n: 1 });
    expect(last()).toBe('2026-09-09T01:23:45.678Z INFO     bff  m  {"site":"a","n":1}');
  });

  it("err があれば次の行以降に stack を続ける (LEVELS の全値を回す)", () => {
    const { log, last } = makeLogger();
    const err = new Error("boom");
    const methods = {
      DEBUG: "debug",
      INFO: "info",
      WARNING: "warn",
      ERROR: "error",
      CRITICAL: "critical",
    } as const;
    for (const level of LEVELS) {
      log[methods[level]]("m", { err });
      expect(last()).toBe(`2026-09-09T01:23:45.678Z ${level.padEnd(8)} bff  m\n${err.stack}`);
    }
    log.error("failed", { err: "plain" });
    expect(last()).toBe("2026-09-09T01:23:45.678Z ERROR    bff  failed\nplain");
  });
});
