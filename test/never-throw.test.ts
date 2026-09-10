import { describe, expect, it } from "vitest";

import { jsonFormat } from "../src/google/cloud-logging.js";
import { createLogger } from "../src/google/cloud-run.js";
import { createCoreLogger, lastResortText } from "../src/output.js";
import { collect, FIXED_TIME } from "./helpers.js";

describe("「ログの呼び出しは投げない」の保証は emit の境界にある", () => {
  it("Formatter が投げても、最後の手段の行 (severity / message / name / format_error) を出す", () => {
    const out = collect();
    const log = createCoreLogger({
      name: "bff",
      level: "INFO",
      format: () => {
        throw new Error("format broke");
      },
      write: out.write,
      now: () => FIXED_TIME,
    });
    expect(() => log.error("failed", { any: 1 })).not.toThrow();
    expect(JSON.parse(out.lines[0]?.line ?? "null")).toEqual({
      severity: "ERROR",
      message: "failed",
      timestamp: "2026-09-09T01:23:45.678Z",
      name: "bff",
      format_error: "Error: format broke",
    });
  });

  it("text 形式の最後の手段は 1 行の固定書式", () => {
    const out = collect();
    const log = createCoreLogger({
      name: "bff",
      level: "INFO",
      format: () => {
        throw new Error("x");
      },
      lastResort: lastResortText,
      write: out.write,
      now: () => FIXED_TIME,
    });
    log.info("m");
    expect(out.lines[0]?.line).toBe(
      "2026-09-09T01:23:45.678Z INFO     bff  m  (format error: Error: x)",
    );
  });

  it("Writer が投げても呼び出し元に伝播しない", () => {
    const log = createCoreLogger({
      name: "bff",
      level: "INFO",
      format: () => "line",
      write: () => {
        throw new Error("stdout closed");
      },
    });
    expect(() => log.info("m")).not.toThrow();
  });

  it("jsonFormat の固定キー自体が直列化できない (labels が投げる toJSON + message が BigInt) でも行が出る", () => {
    const out = collect();
    const log = createCoreLogger({
      name: "bff",
      level: "INFO",
      format: jsonFormat({
        labels: {
          toJSON() {
            throw new Error("labels-boom");
          },
        } as unknown as Record<string, string>,
      }),
      write: out.write,
      now: () => FIXED_TIME,
    });
    expect(() => log.info(10n as unknown as string)).not.toThrow();
    const entry = JSON.parse(out.lines[0]?.line ?? "null");
    expect(entry).toMatchObject({ severity: "INFO", message: "10", name: "bff" });
    expect(entry.format_error).toMatch(/cannot serialize log entry/);
  });

  it("message や name が文字列でなく toString も投げる値でも、最後の手段は投げない", () => {
    const out = collect();
    const evil = {
      toString() {
        throw new Error("no");
      },
    };
    const log = createCoreLogger({
      name: evil as unknown as string,
      level: "INFO",
      format: () => {
        throw new Error("x");
      },
      write: out.write,
      now: () => FIXED_TIME,
    });
    expect(() => log.info(evil as unknown as string)).not.toThrow();
    expect(JSON.parse(out.lines[0]?.line ?? "null")).toMatchObject({
      message: "[unprintable]",
      name: "[unprintable]",
    });
  });
});

describe("createLogger の入口の正規化は投げない", () => {
  it("labels の値の toString が投げてもロガーは作れ、その項目だけ落ちる", () => {
    const out = collect();
    const log = createLogger({
      name: "bff",
      env: { K_SERVICE: "x" },
      labels: {
        ok: "1",
        bad: {
          toString: () => {
            throw new Error("ts");
          },
        },
      } as unknown as Record<string, string>,
      write: out.write,
    });
    log.info("m");
    expect(JSON.parse(out.lines[0]?.line ?? "null")["logging.googleapis.com/labels"]).toEqual({
      ok: "1",
    });
  });

  it("text 形式でも format が投げれば text の最後の手段が出る", () => {
    const out = collect();
    const log = createLogger({ name: "bff", env: {}, write: out.write });
    // textFormat は record.message に依存する。toString が投げる message で format を壊す
    const evil = {
      toString() {
        throw new Error("no");
      },
    };
    expect(() => log.info(evil as unknown as string)).not.toThrow();
    expect(out.lines[0]?.line).toMatch(/INFO {5}bff {2}\[unprintable\] {2}\(format error: /);
  });
});
