import { describe, expect, it } from "vitest";

import {
  parseCloudTraceContext,
  projectIdFromEnv,
  traceFromHeaders,
} from "../../src/google/cloud-trace.js";

const TID = "4bf92f3577b34da6a3ce929d0e0e4736";
const SID = "00f067aa0ba902b7";

describe("parseCloudTraceContext", () => {
  it("TRACE_ID/SPAN_ID;o=1 を解釈し、SPAN_ID は 10 進から 16 桁の 16 進に", () => {
    expect(parseCloudTraceContext(`${TID}/1;o=1`)).toEqual({
      traceId: TID,
      spanId: "0000000000000001",
      sampled: true,
    });
    expect(parseCloudTraceContext(`${TID}/${BigInt(`0x${SID}`)};o=0`)).toEqual({
      traceId: TID,
      spanId: SID,
      sampled: false,
    });
  });

  it(";o= が無ければ sampled は省略、SPAN_ID が無ければ spanId は省略", () => {
    expect(parseCloudTraceContext(`${TID}/5`)).toEqual({
      traceId: TID,
      spanId: "0000000000000005",
    });
    expect(parseCloudTraceContext(TID)).toEqual({ traceId: TID });
    expect(parseCloudTraceContext(`${TID};o=1`)).toEqual({ traceId: TID, sampled: true });
  });

  it("大文字の TRACE_ID は小文字に。すべて 0、範囲外の SPAN_ID、不正な形式", () => {
    expect(parseCloudTraceContext(`${TID.toUpperCase()}/1`)).toEqual({
      traceId: TID,
      spanId: "0000000000000001",
    });
    expect(parseCloudTraceContext(`${"0".repeat(32)}/1`)).toBeUndefined();
    expect(parseCloudTraceContext(`${TID}/0`)).toEqual({ traceId: TID });
    expect(parseCloudTraceContext(`${TID}/18446744073709551616`)).toEqual({ traceId: TID });
    expect(parseCloudTraceContext("garbage")).toBeUndefined();
    expect(parseCloudTraceContext(undefined)).toBeUndefined();
  });
});

describe("traceFromHeaders (Cloud Run 向け)", () => {
  it("traceparent を優先し、無ければ X-Cloud-Trace-Context (py-gn-log と同じ順)", () => {
    const both = new Headers({
      traceparent: `00-${TID}-${SID}-01`,
      "X-Cloud-Trace-Context": `${"a".repeat(32)}/1;o=0`,
    });
    expect(traceFromHeaders(both)).toEqual({ traceId: TID, spanId: SID, sampled: true });
    expect(traceFromHeaders(new Headers({ "x-cloud-trace-context": `${TID}/1;o=1` }))).toEqual({
      traceId: TID,
      spanId: "0000000000000001",
      sampled: true,
    });
  });

  it("不正な traceparent があれば X-Cloud-Trace-Context に倒れる", () => {
    expect(traceFromHeaders({ traceparent: "bad", "X-Cloud-Trace-Context": TID })).toEqual({
      traceId: TID,
    });
  });

  it("どちらも無ければ undefined (新規生成はしない)", () => {
    expect(traceFromHeaders(new Headers())).toBeUndefined();
    expect(traceFromHeaders({})).toBeUndefined();
  });
});

describe("projectIdFromEnv", () => {
  it("GOOGLE_CLOUD_PROJECT を読む。未設定か空なら undefined (既定値を持たない)", () => {
    expect(projectIdFromEnv({ GOOGLE_CLOUD_PROJECT: "my-project" })).toBe("my-project");
    expect(projectIdFromEnv({})).toBeUndefined();
    expect(projectIdFromEnv({ GOOGLE_CLOUD_PROJECT: "" })).toBeUndefined();
  });
});
