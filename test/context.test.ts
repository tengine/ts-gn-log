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

  it("コールバック (setTimeout / then) の中で set しても、同じ範囲なので残る", async () => {
    await runWithContext({ site: "a" }, async () => {
      await new Promise<void>((resolve) =>
        setTimeout(() => {
          setContext({ from_timer: 1 });
          resolve();
        }, 1),
      );
      await Promise.resolve().then(() => {
        setContext({ from_then: 2 });
      });
      expect(getContext()).toEqual({ site: "a", from_timer: 1, from_then: 2 });
    });
  });

  it("runWithContext の外では使えない (プロセス全体の既定にしない)", () => {
    expect(() => setContext({ request_id: "x" })).toThrow(/must be called inside runWithContext/);
    expect(() => clearContext()).toThrow(/must be called inside runWithContext/);
    expect(getContext()).toEqual({});
  });

  it("並行する範囲で set しても互いに漏れない", async () => {
    const results = await Promise.all(
      ["a", "b"].map((id) =>
        runWithContext({}, async () => {
          if (id === "a") setContext({ who: "a" });
          await tick();
          return getContext();
        }),
      ),
    );
    expect(results).toEqual([{ who: "a" }, {}]);
    expect(getContext()).toEqual({});
  });

  it("入れ子の内側で clear しても、外側の範囲の値は外側に戻れば見える (内側だけを消す)", async () => {
    await runWithContext({ o: 1 }, async () => {
      await runWithContext({ i: 2 }, async () => {
        clearContext();
        expect(getContext()).toEqual({});
        await tick();
        expect(getContext()).toEqual({});
      });
      expect(getContext()).toEqual({ o: 1 });
    });
  });

  it("範囲が終わった後 (await し忘れた処理から) の set / clear はエラーで知らせる", async () => {
    let late: Promise<unknown> | undefined;
    await runWithContext({ a: 1 }, async () => {
      // await し忘れた投げ放しの処理。範囲の中で始まるので Scope を掴んでいる
      late = (async () => {
        await tick();
        await tick();
        const before = getContext();
        let error: unknown;
        try {
          setContext({ z: 9 });
        } catch (e) {
          error = e;
        }
        return { before, error, after: getContext() };
      })();
    });
    const r = (await late) as { before: unknown; error: unknown; after: unknown };
    // 読み取りは最後の値を返すが、更新は受け付けない
    expect(r.before).toEqual({ a: 1 });
    expect(String(r.error)).toMatch(/after its runWithContext\(\) scope ended/);
    expect(r.after).toEqual({ a: 1 });
  });

  it("await しない fn の reject は握り潰されず、unhandledRejection として届く", async () => {
    const caught = new Promise<unknown>((resolve) => {
      const handler = (reason: unknown) => {
        process.off("unhandledRejection", handler);
        resolve(reason);
      };
      process.on("unhandledRejection", handler);
    });
    runWithContext({}, async () => {
      throw new Error("uncaught-boom");
    });
    const reason = await Promise.race([
      caught,
      tick()
        .then(() => tick())
        .then(() => "not fired"),
    ]);
    expect(String(reason)).toMatch(/uncaught-boom/);
  });

  it("await した場合は同じ値 / 同じエラーが返り、settle 後に範囲が閉じる", async () => {
    await expect(runWithContext({}, async () => 42)).resolves.toBe(42);
    const err = new Error("e");
    await expect(
      runWithContext({}, async () => {
        throw err;
      }),
    ).rejects.toBe(err);
  });

  it("同期の fn は戻った時点で範囲が終わり、そこから逃げたマイクロタスクの更新もエラー", async () => {
    const seen = new Promise<unknown>((resolve) => {
      runWithContext({}, () => {
        queueMicrotask(() => {
          try {
            setContext({ z: 1 });
            resolve("no error");
          } catch (e) {
            resolve(e);
          }
        });
      });
    });
    expect(String(await seen)).toMatch(/scope ended/);
  });

  it("例外で範囲を抜けても、set した値は範囲ごと消えて次の流れに漏れない", async () => {
    await expect(
      runWithContext({}, async () => {
        setContext({ request_id: "A" });
        await tick();
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await runWithContext({}, async () => {
      await tick();
      expect(getContext()).toEqual({});
    });
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
      runWithContext({}, () => {
        expect(() => setContext({ [key]: "x" })).toThrow(/Context keys conflict/);
      });
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
