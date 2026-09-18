import { describe, expect, it } from "vitest";

import { getContext, runWithContext } from "../src/context.js";
import {
  currentTrace,
  formatTraceparent,
  headerValue,
  newSpanId,
  newTraceId,
  parseTraceparent,
  runWithTrace,
  setTrace,
  traceFromHeaders,
  traceHeaders,
} from "../src/trace.js";

const TID = "4bf92f3577b34da6a3ce929d0e0e4736";
const SID = "00f067aa0ba902b7";

describe("parseTraceparent / formatTraceparent (W3C)", () => {
  it("version 00 の traceparent を解釈する", () => {
    expect(parseTraceparent(`00-${TID}-${SID}-01`)).toEqual({
      traceId: TID,
      spanId: SID,
      sampled: true,
    });
    expect(parseTraceparent(` 00-${TID}-${SID}-00 `)).toEqual({
      traceId: TID,
      spanId: SID,
      sampled: false,
    });
  });

  it("不正な形式、未対応の version、すべて 0 の id は undefined", () => {
    expect(parseTraceparent(undefined)).toBeUndefined();
    expect(parseTraceparent("garbage")).toBeUndefined();
    expect(parseTraceparent(`01-${TID}-${SID}-01`)).toBeUndefined();
    expect(parseTraceparent(`00-${"0".repeat(32)}-${SID}-01`)).toBeUndefined();
    expect(parseTraceparent(`00-${TID}-${"0".repeat(16)}-01`)).toBeUndefined();
    expect(parseTraceparent(`00-${TID.toUpperCase()}-${SID}-01`)).toBeUndefined();
  });

  it("spanId と sampled の両方が分かるときだけ組み立てる", () => {
    expect(formatTraceparent({ traceId: TID, spanId: SID, sampled: true })).toBe(
      `00-${TID}-${SID}-01`,
    );
    expect(formatTraceparent({ traceId: TID, spanId: SID })).toBeUndefined();
    expect(formatTraceparent({ traceId: TID, sampled: true })).toBeUndefined();
  });
});

describe("headerValue", () => {
  it("Headers / Record / Map のどれからでも、大文字小文字を区別せずに取れる", () => {
    const h = new Headers({ Traceparent: "x" });
    expect(headerValue(h, "traceparent")).toBe("x");
    expect(headerValue({ TRACEPARENT: "y" }, "traceparent")).toBe("y");
    expect(headerValue(new Map([["TraceParent", "z"]]), "traceparent")).toBe("z");
    expect(headerValue({}, "traceparent")).toBeUndefined();
  });

  it("Node の IncomingHttpHeaders の配列は先頭を採る", () => {
    expect(headerValue({ traceparent: ["a", "b"] }, "traceparent")).toBe("a");
  });
});

describe("traceFromHeaders / traceHeaders (共通部は traceparent のみ)", () => {
  it("traceparent から取り出す", () => {
    expect(traceFromHeaders(new Headers({ traceparent: `00-${TID}-${SID}-01` }))).toEqual({
      traceId: TID,
      spanId: SID,
      sampled: true,
    });
    expect(
      traceFromHeaders(new Headers({ "X-Cloud-Trace-Context": `${TID}/1;o=1` })),
    ).toBeUndefined();
  });

  it("送信用のヘッダは分かっているときだけ", () => {
    expect(traceHeaders({ traceId: TID, spanId: SID, sampled: false })).toEqual({
      traceparent: `00-${TID}-${SID}-00`,
    });
    expect(traceHeaders({ traceId: TID })).toEqual({});
    expect(traceHeaders(undefined)).toEqual({});
  });
});

describe("newTraceId / newSpanId", () => {
  it("32 桁 / 16 桁の小文字 16 進で、毎回違う", () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/);
    expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/);
    expect(newTraceId()).not.toBe(newTraceId());
  });
});

describe("runWithTrace / setTrace / currentTrace", () => {
  it("文脈の trace キーに置き、fields も置く。抜けると消える", async () => {
    const trace = { traceId: TID, spanId: SID, sampled: true };
    await runWithTrace(trace, { request_id: "r1" }, async () => {
      expect(currentTrace()).toEqual(trace);
      expect(getContext().request_id).toBe("r1");
      expect(traceHeaders()).toEqual({ traceparent: `00-${TID}-${SID}-01` });
    });
    expect(currentTrace()).toBeUndefined();
  });

  it("trace が undefined なら何も置かない", () => {
    runWithTrace(undefined, { a: 1 }, () => {
      expect(getContext()).toEqual({});
    });
    runWithContext({}, () => {
      setTrace(undefined, { a: 1 });
      expect(getContext()).toEqual({});
      setTrace({ traceId: TID }, { a: 1 });
      expect(currentTrace()).toEqual({ traceId: TID });
      expect(getContext().a).toBe(1);
    });
  });
});

describe("normalizeTrace (境界の検証)", () => {
  it("traceId が 32 桁 16 進でなければ trace 無し。大文字は小文字に", async () => {
    const { normalizeTrace } = await import("../src/trace.js");
    expect(normalizeTrace({ traceId: "short" })).toBeUndefined();
    expect(
      normalizeTrace({ traceId: TID.toUpperCase(), spanId: SID.toUpperCase(), sampled: true }),
    ).toEqual({
      traceId: TID,
      spanId: SID,
      sampled: true,
    });
    expect(normalizeTrace("x")).toBeUndefined();
  });

  it("全 0 の traceId は trace 無し、全 0 の spanId は落とす (解析側と同じ。W3C の無効値)", async () => {
    const { normalizeTrace } = await import("../src/trace.js");
    expect(normalizeTrace({ traceId: "0".repeat(32) })).toBeUndefined();
    expect(normalizeTrace({ traceId: TID, spanId: "0".repeat(16), sampled: true })).toEqual({
      traceId: TID,
      sampled: true,
    });
    // 送った traceparent を自分の解析が拒まない
    expect(traceHeaders({ traceId: TID, spanId: "0".repeat(16), sampled: true })).toEqual({});
  });

  it("不正な spanId / sampled は落とす", async () => {
    const { normalizeTrace } = await import("../src/trace.js");
    expect(normalizeTrace({ traceId: TID, spanId: "", sampled: true })).toEqual({
      traceId: TID,
      sampled: true,
    });
    expect(normalizeTrace({ traceId: TID, spanId: "not-hex-16chars!" })).toEqual({ traceId: TID });
    expect(normalizeTrace({ traceId: TID, sampled: "yes" as unknown as boolean })).toEqual({
      traceId: TID,
    });
  });

  it("traceHeaders / runWithTrace / setTrace は不正な値で投げず、正規化して扱う", () => {
    expect(traceHeaders({ traceId: TID, spanId: "xyz", sampled: true })).toEqual({});
    expect(traceHeaders({ traceId: "bad" })).toEqual({});
    runWithTrace({ traceId: TID, spanId: "" }, undefined, () => {
      expect(currentTrace()).toEqual({ traceId: TID });
    });
    runWithTrace({ traceId: "bad" }, { a: 1 }, () => {
      expect(currentTrace()).toBeUndefined();
      expect(getContext()).toEqual({});
    });
    runWithContext({}, () => {
      setTrace({ traceId: "bad" });
      expect(currentTrace()).toBeUndefined();
    });
  });
});
