import { describe, expect, it } from "vitest";

import { CLOUD_LOGGING_LABELS_KEY, jsonFormat } from "../../src/google/cloud-logging.js";
import { createCoreLogger } from "../../src/output.js";
import { collect, FIXED_TIME } from "../helpers.js";

function makeLogger(level: "DEBUG" | "INFO" = "INFO", labels?: Record<string, string>) {
  const out = collect();
  const log = createCoreLogger({
    name: "bff",
    level,
    format: jsonFormat(labels === undefined ? {} : { labels }),
    write: out.write,
    now: () => FIXED_TIME,
  });
  return { log, out, last: () => JSON.parse(out.lines.at(-1)?.line ?? "null") };
}

describe("jsonFormat (設計案 §2.1 すべての行に付くもの)", () => {
  it("severity / message / timestamp / name / labels を 1 行の JSON で出す", () => {
    const { log, out, last } = makeLogger("INFO", { service: "frontend" });
    log.info("task accepted");
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]?.line).not.toContain("\n");
    expect(last()).toEqual({
      severity: "INFO",
      message: "task accepted",
      timestamp: "2026-09-09T01:23:45.678Z",
      name: "bff",
      [CLOUD_LOGGING_LABELS_KEY]: { service: "frontend" },
    });
  });

  it("severity は Cloud Logging の LogSeverity の名前", () => {
    const { log, out } = makeLogger("DEBUG");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    log.critical("c");
    expect(out.lines.map((l) => JSON.parse(l.line).severity)).toEqual([
      "DEBUG",
      "INFO",
      "WARNING",
      "ERROR",
      "CRITICAL",
    ]);
  });

  it("labels 未指定なら空のオブジェクト。thread_id / thread_name は付けない", () => {
    const { log, last } = makeLogger();
    log.info("x");
    expect(last()[CLOUD_LOGGING_LABELS_KEY]).toEqual({});
  });

  it("呼び出し時のフィールドと子ロガーの固定フィールドをそのまま並べる (snake_case は利用側の流儀)", () => {
    const { log, last } = makeLogger();
    log.child({ site: "site-a" }).info("inside", { operation: "POST /api/v1/things" });
    expect(last()).toMatchObject({ site: "site-a", operation: "POST /api/v1/things" });
  });

  it("固定キーと同名のフィールドは固定キーが勝つ", () => {
    const { log, last } = makeLogger();
    log.info("real", { message: "fake", severity: "CRITICAL", name: "other" });
    expect(last()).toMatchObject({ message: "real", severity: "INFO", name: "bff" });
  });

  it("level 未満は出力しない", () => {
    const { log, out } = makeLogger("INFO");
    log.debug("hidden");
    expect(out.lines).toHaveLength(0);
  });
});

describe("jsonFormat (設計案 §2.3 ERROR 以上に付くもの)", () => {
  it("ERROR 以上で err を渡すと stack_trace に err.stack が入る", () => {
    const { log, last } = makeLogger();
    const err = new Error("boom");
    log.error("save failed", { err, error_type: "infra" });
    const entry = last();
    expect(entry.stack_trace).toBe(err.stack);
    expect(entry.stack_trace).toMatch(/^Error: boom\n\s+at /);
    expect(entry.error_type).toBe("infra");
    expect(entry).not.toHaveProperty("err");
    expect(entry).not.toHaveProperty("error");
  });

  it("CRITICAL でも stack_trace", () => {
    const { log, last } = makeLogger();
    log.critical("down", { err: new Error("fatal") });
    expect(last().stack_trace).toMatch(/^Error: fatal/);
  });

  it("WARNING 以下で err を渡すと stack_trace ではなく error に入る (Error Reporting に集計させない)", () => {
    const { log, last } = makeLogger();
    log.warn("retrying", { err: new Error("transient") });
    expect(last()).not.toHaveProperty("stack_trace");
    expect(last().error).toMatch(/^Error: transient/);
  });

  it("err が Error でなければ文字列にして入れ、message は変えない", () => {
    const { log, last } = makeLogger();
    log.error("failed", { err: "plain string" });
    expect(last()).toMatchObject({ message: "failed", stack_trace: "plain string" });
    log.error("failed", { err: { code: 42 } });
    expect(last().stack_trace).toBe('{"code":42}');
    log.error("failed", { err: undefined });
    expect(last().stack_trace).toBe("undefined");
  });

  it("stack の無い Error は name: message", () => {
    const { log, last } = makeLogger();
    const err = new Error("no stack");
    delete err.stack;
    log.error("x", { err });
    expect(last().stack_trace).toBe("Error: no stack");
  });

  it("err を渡さなければ stack_trace も error も付かない", () => {
    const { log, last } = makeLogger();
    log.error("plain");
    expect(last()).not.toHaveProperty("stack_trace");
    expect(last()).not.toHaveProperty("error");
  });
});
