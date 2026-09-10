import { describe, expect, it } from "vitest";

import { getContext } from "../../src/context.js";
import { createLogger } from "../../src/google/cloud-run.js";
import {
  currentTrace,
  SPAN_ID_KEY,
  TRACE_KEY,
  traceHeaders,
  withRequestTrace,
} from "../../src/google/cloud-trace.js";
import { collect } from "../helpers.js";

const TID = "4bf92f3577b34da6a3ce929d0e0e4736";

function makeLogger() {
  const out = collect();
  const log = createLogger({
    name: "bff",
    env: { K_SERVICE: "x", GOOGLE_CLOUD_PROJECT: "p" },
    write: out.write,
  });
  return { log, last: () => JSON.parse(out.lines.at(-1)?.line ?? "null") };
}

describe("withRequestTrace (Route Handler の薄い包み)", () => {
  it("X-Cloud-Trace-Context がある → その trace id が全ログ行と currentTrace に付く", async () => {
    const { log, last } = makeLogger();
    const handler = withRequestTrace(async (req: Request) => {
      log.info("received", { path: new URL(req.url).pathname });
      await Promise.resolve();
      return Response.json({ trace_id: currentTrace()?.traceId });
    });
    const res = await handler(
      new Request("http://x/api", { headers: { "X-Cloud-Trace-Context": `${TID}/1;o=1` } }),
    );
    expect(await res.json()).toEqual({ trace_id: TID });
    expect(last()).toMatchObject({
      message: "received",
      path: "/api",
      [TRACE_KEY]: `projects/p/traces/${TID}`,
    });
    expect(currentTrace()).toBeUndefined();
  });

  it("traceparent だけ → 同じく", async () => {
    const { log, last } = makeLogger();
    const handler = withRequestTrace(async () => {
      log.info("m");
      return currentTrace();
    });
    const t = await handler(
      new Request("http://x", { headers: { traceparent: `00-${TID}-00f067aa0ba902b7-01` } }),
    );
    expect(t?.traceId).toBe(TID);
    expect(last()[SPAN_ID_KEY]).toBe("00f067aa0ba902b7");
  });

  it("どちらも無い → 新規に 32 hex の trace id を生成する (spanId / sampled は不明)", async () => {
    const { log, last } = makeLogger();
    const handler = withRequestTrace(async () => {
      log.info("m");
      return currentTrace();
    });
    const t = await handler(new Request("http://x"));
    expect(t?.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(t?.spanId).toBeUndefined();
    expect(last()[TRACE_KEY]).toBe(`projects/p/traces/${t?.traceId}`);
    expect(last()).not.toHaveProperty(SPAN_ID_KEY);
    // 送信用のヘッダは X-Cloud-Trace-Context だけ
    const headers = await withRequestTrace(async () => traceHeaders())(new Request("http://x"));
    expect(Object.keys(headers)).toEqual(["X-Cloud-Trace-Context"]);
  });

  it("fields (固定 / リクエストから組み立て) も文脈に置く。追加の引数はそのまま渡る", async () => {
    const handler = withRequestTrace(
      async (_req: Request, ctx: { params: { id: string } }): Promise<Record<string, unknown>> => ({
        ...getContext(),
        id: ctx.params.id,
      }),
      { fields: (req) => ({ method: req.method }) },
    );
    const r = await handler(new Request("http://x", { method: "POST" }), { params: { id: "42" } });
    expect(r).toMatchObject({ method: "POST", id: "42" });
    expect(r.trace).toBeDefined();
  });

  it("newTrace で生成を差し替えられる。Headers 以外 (Record) の headers も受ける", async () => {
    const handler = withRequestTrace(async () => currentTrace(), {
      newTrace: () => ({ traceId: "f".repeat(32), spanId: "1".repeat(16), sampled: true }),
    });
    expect(await handler({ headers: {} })).toEqual({
      traceId: "f".repeat(32),
      spanId: "1".repeat(16),
      sampled: true,
    });
    expect(await handler({ headers: { "x-cloud-trace-context": TID } })).toEqual({ traceId: TID });
  });

  it("newTrace が不正な値を返しても投げず、正規化するか生成し直す", async () => {
    const dropSpan = withRequestTrace(async () => [currentTrace(), traceHeaders()] as const, {
      newTrace: () => ({ traceId: TID, spanId: "" }),
    });
    const [t1, h1] = await dropSpan({ headers: {} });
    expect(t1).toEqual({ traceId: TID });
    expect(h1).toEqual({ "X-Cloud-Trace-Context": TID });
    const regen = withRequestTrace(async () => currentTrace(), {
      newTrace: () => ({ traceId: "bad" }),
    });
    expect((await regen({ headers: {} }))?.traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("newTrace / fields の関数が投げても、ログの都合でリクエストを落とさない", async () => {
    const h1 = withRequestTrace(async () => currentTrace(), {
      newTrace: () => {
        throw new Error("gen");
      },
    });
    expect((await h1({ headers: {} }))?.traceId).toMatch(/^[0-9a-f]{32}$/);
    const h2 = withRequestTrace(async () => getContext(), {
      fields: () => {
        throw new Error("fields");
      },
    });
    const ctx = await h2({ headers: { "x-cloud-trace-context": TID } });
    expect(Object.keys(ctx)).toEqual(["trace"]);
  });

  it("handler が投げても伝播し、文脈は残らない", async () => {
    const handler = withRequestTrace(async () => {
      throw new Error("boom");
    });
    await expect(handler(new Request("http://x"))).rejects.toThrow("boom");
    expect(currentTrace()).toBeUndefined();
  });
});
