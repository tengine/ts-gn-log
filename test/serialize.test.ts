import { describe, expect, it } from "vitest";

import { jsonFormat } from "../src/google/cloud-logging.js";
import { createCoreLogger, textFormat, tryStringify } from "../src/output.js";
import { collect, FIXED_TIME } from "./helpers.js";

function circular(): Record<string, unknown> {
  const a: Record<string, unknown> = { name: "a" };
  a.self = a;
  return a;
}

describe("tryStringify", () => {
  it("BigInt は文字列、循環参照は [Circular]", () => {
    expect(tryStringify({ n: 10n })).toEqual({ ok: true, json: '{"n":"10"}' });
    expect(tryStringify({ a: circular() })).toEqual({
      ok: true,
      json: '{"a":{"name":"a","self":"[Circular]"}}',
    });
  });

  it("兄弟で同じオブジェクトを参照するのは循環ではない", () => {
    const shared = { v: 1 };
    expect(tryStringify({ x: shared, y: shared })).toEqual({
      ok: true,
      json: '{"x":{"v":1},"y":{"v":1}}',
    });
  });

  it("toJSON が投げるときは ok: false で理由を返し、例外にしない", () => {
    const bad = {
      toJSON() {
        throw new Error("nope");
      },
    };
    expect(tryStringify({ bad })).toEqual({ ok: false, error: "Error: nope" });
  });
});

describe("ログの呼び出しは例外を投げない (JSON / text)", () => {
  const cases: Array<[string, () => Record<string, unknown>]> = [
    ["循環参照", () => ({ a: circular() })],
    ["BigInt", () => ({ n: 10n })],
    [
      "投げる toJSON",
      () => ({
        bad: {
          toJSON() {
            throw new Error("nope");
          },
        },
      }),
    ],
  ];

  for (const [label, fields] of cases) {
    it(`JSON: ${label} でも severity / message を持つ行を出す`, () => {
      const out = collect();
      const log = createCoreLogger({
        name: "bff",
        level: "INFO",
        format: jsonFormat({ labels: { service: "x" } }),
        write: out.write,
        now: () => FIXED_TIME,
      });
      expect(() =>
        log.error("failed", { ...fields(), err: new Error("e"), op: "save" }),
      ).not.toThrow();
      const entry = JSON.parse(out.lines[0]?.line ?? "null");
      expect(entry).toMatchObject({ severity: "ERROR", message: "failed", name: "bff" });
      expect(entry["logging.googleapis.com/labels"]).toEqual({ service: "x" });
      expect(entry.stack_trace).toMatch(/^Error: e/);
    });

    it(`text: ${label} でも行を出す`, () => {
      const out = collect();
      const log = createCoreLogger({
        name: "bff",
        level: "INFO",
        format: textFormat,
        write: out.write,
        now: () => FIXED_TIME,
      });
      expect(() => log.info("m", fields())).not.toThrow();
      expect(out.lines[0]?.line).toMatch(/^2026-09-09T01:23:45\.678Z INFO {5}bff {2}m {2}/);
    });
  }

  it("JSON: 直列化できないときはフィールドを落として fields_error に理由を入れる", () => {
    const out = collect();
    const log = createCoreLogger({
      name: "bff",
      level: "INFO",
      format: jsonFormat(),
      write: out.write,
      now: () => FIXED_TIME,
    });
    log.info("m", {
      ok_field: 1,
      bad: {
        toJSON() {
          throw new Error("nope");
        },
      },
    });
    const entry = JSON.parse(out.lines[0]?.line ?? "null");
    expect(entry).toEqual({
      severity: "INFO",
      message: "m",
      timestamp: "2026-09-09T01:23:45.678Z",
      name: "bff",
      "logging.googleapis.com/labels": {},
      fields_error: "Error: nope",
    });
  });
});
