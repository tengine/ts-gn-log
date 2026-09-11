import { afterEach, describe, expect, it, vi } from "vitest";

import { createCoreLogger, writeToStdio } from "../src/output.js";
import { collect, FIXED_TIME } from "./helpers.js";

describe("createCoreLogger", () => {
  it("Formatter に LogRecord を渡し、Writer に整形した行を渡す", () => {
    const out = collect();
    const log = createCoreLogger({
      name: "bff",
      level: "INFO",
      format: (r) => `${r.level}|${r.name}|${r.message}|${JSON.stringify(r.fields)}`,
      write: out.write,
      now: () => FIXED_TIME,
    });
    log.info("hello", { a: 1 });
    expect(out.lines).toEqual([{ level: "INFO", line: 'INFO|bff|hello|{"a":1}' }]);
  });

  it("err はフィールドから取り除いて LogRecord.err に載せる", () => {
    const seen: unknown[] = [];
    const log = createCoreLogger({
      name: "bff",
      level: "INFO",
      format: (r) => {
        seen.push({ err: r.err, fields: r.fields });
        return "";
      },
      write: () => {},
    });
    const err = new Error("boom");
    log.error("failed", { err, op: "save" });
    expect(seen).toEqual([{ err, fields: { op: "save" } }]);
  });

  it("child({ err }) の err も呼び出し時と同じく LogRecord.err に載り、素のフィールドにならない", () => {
    const seen: unknown[] = [];
    const log = createCoreLogger({
      name: "bff",
      level: "INFO",
      format: (r) => {
        seen.push({ err: r.err, fields: r.fields, has: "err" in r });
        return "";
      },
      write: () => {},
    });
    log.child({ err: "fixed", site: "a" }).error("m");
    log.child({ site: "a" }).info("n");
    expect(seen).toEqual([
      { err: "fixed", fields: { site: "a" }, has: true },
      { err: undefined, fields: { site: "a" }, has: false },
    ]);
  });

  it("child は固定フィールドを重ね、呼び出し時のフィールドが優先する", () => {
    const seen: Record<string, unknown>[] = [];
    const log = createCoreLogger({
      name: "bff",
      level: "INFO",
      format: (r) => {
        seen.push(r.fields);
        return "";
      },
      write: () => {},
      fields: { app: "x" },
    });
    log.child({ site: "a" }).child({ site: "b", extra: 1 }).info("m", { extra: 2 });
    expect(seen).toEqual([{ app: "x", site: "b", extra: 2 }]);
  });
});

describe("createCoreLogger の固定フィールド", () => {
  it("渡したオブジェクトを後から書き換えても出力に影響しない (child / labels と同じ)", () => {
    const seen: Record<string, unknown>[] = [];
    const fields: Record<string, unknown> = { app: "x" };
    const log = createCoreLogger({
      name: "bff",
      level: "INFO",
      format: (r) => {
        seen.push(r.fields);
        return "";
      },
      write: () => {},
      fields,
    });
    fields.z = 9;
    log.info("m");
    expect(seen).toEqual([{ app: "x" }]);
  });
});

describe("writeToStdio", () => {
  afterEach(() => vi.restoreAllMocks());

  it("ERROR 以上は stderr、それ以外は stdout に改行付きで書く (5 つのレベルすべて)", () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    writeToStdio("DEBUG", "z");
    writeToStdio("INFO", "a");
    writeToStdio("WARNING", "b");
    writeToStdio("ERROR", "c");
    writeToStdio("CRITICAL", "d");
    expect(stdout.mock.calls.map((c) => c[0])).toEqual(["z\n", "a\n", "b\n"]);
    expect(stderr.mock.calls.map((c) => c[0])).toEqual(["c\n", "d\n"]);
  });
});
