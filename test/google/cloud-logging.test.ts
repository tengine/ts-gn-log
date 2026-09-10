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
