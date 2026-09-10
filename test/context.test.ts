import { describe, expect, it } from "vitest";

import {
  clearContext,
  contextFields,
  getContext,
  runWithContext,
  setContext,
} from "../src/context.js";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

describe("runWithContext / getContext", () => {
  it("fn の中で複数回 await をまたいでも文脈が保たれ、抜けると元に戻る", async () => {
    expect(getContext()).toEqual({});
    await runWithContext({ site: "a", request_id: "r1" }, async () => {
      expect(getContext()).toEqual({ site: "a", request_id: "r1" });
      await tick();
      expect(getContext()).toEqual({ site: "a", request_id: "r1" });
      await Promise.resolve();
      await tick();
      expect(getContext()).toEqual({ site: "a", request_id: "r1" });
    });
    expect(getContext()).toEqual({});
  });

  it("入れ子は内側が勝ち、抜けると外側の値に戻る (ネストの上書き規則)", async () => {
    await runWithContext({ site: "outer", keep: 1 }, async () => {
      await runWithContext({ site: "inner", extra: 2 }, async () => {
        await tick();
        expect(getContext()).toEqual({ site: "inner", keep: 1, extra: 2 });
      });
      expect(getContext()).toEqual({ site: "outer", keep: 1 });
    });
  });

  it("並行する流れは互いに漏れない", async () => {
    const seen: string[] = [];
    await Promise.all(
      ["a", "b", "c"].map((site) =>
        runWithContext({ site }, async () => {
          await tick();
          seen.push(String(getContext().site));
          await tick();
          expect(getContext().site).toBe(site);
        }),
      ),
    );
    expect(seen.sort()).toEqual(["a", "b", "c"]);
  });

  it("同期の fn でも使え、戻り値を返す", () => {
    const v = runWithContext({ k: 1 }, () => getContext().k);
    expect(v).toBe(1);
  });

  it("例外で抜けても元に戻る", async () => {
    await expect(
      runWithContext({ site: "x" }, async () => {
        await tick();
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(getContext()).toEqual({});
  });

  it("文脈は凍結されていて、外から書き換えられない", () => {
    runWithContext({ k: 1 }, () => {
      expect(() => {
        (getContext() as Record<string, unknown>).k = 2;
      }).toThrow();
    });
  });
});

describe("setContext / clearContext", () => {
  it("runWithContext の中で set した値はその範囲に残り、外には漏れない", async () => {
    await runWithContext({ site: "a" }, async () => {
      setContext({ request_id: "r1" });
      await tick();
      expect(getContext()).toEqual({ site: "a", request_id: "r1" });
      clearContext();
      expect(getContext()).toEqual({});
    });
    expect(getContext()).toEqual({});
  });
});

describe("予約キー", () => {
  it("固定キーと同名は置けない", () => {
    for (const key of [
      "severity",
      "message",
      "timestamp",
      "name",
      "logging.googleapis.com/labels",
      "stack_trace",
      "err",
    ]) {
      expect(() => runWithContext({ [key]: "x" }, () => {})).toThrow(/Context keys conflict/);
      expect(() => setContext({ [key]: "x" })).toThrow(/Context keys conflict/);
    }
  });

  it("trace は置けるが、出力用のフィールドには混ぜない", () => {
    runWithContext({ trace: { traceId: "t" }, site: "a" }, () => {
      expect(getContext().trace).toEqual({ traceId: "t" });
      expect(contextFields()).toEqual({ site: "a" });
    });
  });
});

describe("contextFields", () => {
  it("null / undefined の値は出力しない (外側の値を一時的に外せる)", async () => {
    await runWithContext({ site: "outer", user: "u" }, async () => {
      await runWithContext({ user: null }, async () => {
        expect(contextFields()).toEqual({ site: "outer" });
      });
      expect(contextFields()).toEqual({ site: "outer", user: "u" });
    });
  });
});
