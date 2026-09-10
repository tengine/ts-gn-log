import { describe, expect, expectTypeOf, it } from "vitest";

import {
  type ContextFields,
  normalizeContextFields,
  RESERVED_CONTEXT_KEYS,
  type ReservedContextKey,
  runWithContext,
} from "../src/context.js";
import { logFields } from "../src/google/cloud-trace.js";
import { runWithTrace } from "../src/trace.js";

const TID = "4bf92f3577b34da6a3ce929d0e0e4736";

describe("予約キーは型で弾く (ContextFields)", () => {
  it("予約キーのリテラルと logFields() の返り値は fields に渡せない (型)", () => {
    // @ts-expect-error 予約キーのリテラル
    expectTypeOf<{ severity: string }>().toMatchTypeOf<ContextFields>();
    // @ts-expect-error logFields の返り値 (固定キーを持つ型)
    expectTypeOf(logFields({ traceId: TID }, "p")).toMatchTypeOf<ContextFields>();
    // @ts-expect-error spread しても同じ
    expectTypeOf({ ...logFields({ traceId: TID }, "p"), extra: 1 }).toMatchTypeOf<ContextFields>();
    // 通常のフィールドと動的な Record は通る
    expectTypeOf<{ request_id: string }>().toMatchTypeOf<ContextFields>();
    expectTypeOf<Record<string, unknown>>().toMatchTypeOf<ContextFields>();
  });

  it("型で分からない動的な値は実行時の検査に掛かり、trace のフィールドが自動で付くことを案内する", () => {
    const dynamic: Record<string, unknown> = { "logging.googleapis.com/trace": "x" };
    expect(() => runWithContext(dynamic, () => {})).toThrow(
      /derived automatically from the reserved `trace` key/,
    );
    expect(() => runWithTrace({ traceId: TID }, dynamic, () => {})).toThrow(
      /Context keys conflict/,
    );
  });

  it("実行時の集合と型の union は同じ内容", () => {
    const keys: ReservedContextKey[] = [
      "severity",
      "message",
      "timestamp",
      "name",
      "logging.googleapis.com/labels",
      "logging.googleapis.com/trace",
      "logging.googleapis.com/spanId",
      "logging.googleapis.com/trace_sampled",
      "stack_trace",
      "error",
      "fields_error",
      "format_error",
      "err",
    ];
    expect(new Set(keys)).toEqual(RESERVED_CONTEXT_KEYS);
  });
});

describe("normalizeContextFields (利用側の関数の返り値を境界で受ける)", () => {
  it("予約キーを落とし、プレーンなオブジェクト以外 (null / 配列 / 文字列) は undefined。投げない", () => {
    expect(normalizeContextFields({ message: "x", request_id: "r1" })).toEqual({
      request_id: "r1",
    });
    expect(normalizeContextFields(null)).toBeUndefined();
    expect(normalizeContextFields(["a"])).toBeUndefined();
    expect(normalizeContextFields("str")).toBeUndefined();
    expect(normalizeContextFields({})).toEqual({});
  });
});
