import { describe, expect, it } from "vitest";

import { runWithContext } from "../src/context.js";
import { jsonFormat } from "../src/google/cloud-logging.js";
import { createCoreLogger } from "../src/output.js";
import { collect, FIXED_TIME } from "./helpers.js";

function makeLogger(fields?: Record<string, unknown>) {
  const out = collect();
  const opts: Parameters<typeof createCoreLogger>[0] = {
    name: "bff",
    level: "INFO",
    format: jsonFormat(),
    write: out.write,
    now: () => FIXED_TIME,
  };
  if (fields) opts.fields = fields;
  const log = createCoreLogger(opts);
  return { log, last: () => JSON.parse(out.lines.at(-1)?.line ?? "null") };
}

describe("出力時に文脈のフィールドを混ぜる", () => {
  it("runWithContext の中のログに文脈が付き、外では付かない", async () => {
    const { log, last } = makeLogger();
    await runWithContext({ request_id: "r1", site: "tokyo" }, async () => {
      log.info("inside");
      await Promise.resolve();
      log.info("after await");
      expect(last()).toMatchObject({ message: "after await", request_id: "r1", site: "tokyo" });
    });
    log.info("outside");
    expect(last()).not.toHaveProperty("request_id");
  });

  it("優先順位は 呼び出し時 > child の固定 > 文脈", () => {
    const { log, last } = makeLogger({ k: "base" });
    runWithContext({ k: "ctx", only_ctx: 1 }, () => {
      log.info("a");
      expect(last()).toMatchObject({ k: "base", only_ctx: 1 });
      log.child({ k: "child" }).info("b");
      expect(last()).toMatchObject({ k: "child" });
      log.child({ k: "child" }).info("c", { k: "call" });
      expect(last()).toMatchObject({ k: "call" });
    });
  });

  it("文脈の trace は混ぜず、null の値も出さない", () => {
    const { log, last } = makeLogger();
    runWithContext({ trace: { traceId: "t" }, site: "a", user: null }, () => {
      log.info("m");
      expect(last()).not.toHaveProperty("trace");
      expect(last()).not.toHaveProperty("user");
      expect(last().site).toBe("a");
    });
  });

  it("文脈の err は置けないので、文脈経由で stack_trace が付くことはない", () => {
    // 型では弾かれるので、動的な値を模して渡す (実行時の検査に掛かる)
    const dynamic: Record<string, unknown> = { err: new Error("x") };
    expect(() => runWithContext(dynamic, () => {})).toThrow(/Context keys conflict/);
  });
});
