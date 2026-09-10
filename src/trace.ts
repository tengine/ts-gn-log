/**
 * 分散トレースの文脈 (W3C Trace Context) を扱う共通部 (provider を知らない。py-gn-log の gnlog.trace と対)
 *
 * TraceContext と、W3C の traceparent ヘッダの解釈・組み立て、現在の trace を文脈
 * (ts-gn-log/context の予約キー `trace`) に置く関数を提供する。ログに出すフィールド
 * (Cloud Logging の特殊フィールド等) の形は provider ごとに違うので、provider のサブパス
 * (`ts-gn-log/google/cloud-trace` 等) が担う。
 *
 * 参考: https://www.w3.org/TR/trace-context/
 */

import { randomBytes } from "node:crypto";
import {
  type Context,
  type ContextFields,
  getContext,
  runWithContext,
  setContext,
  TRACE_CONTEXT_KEY,
} from "./context.js";

/** 1 つのリクエスト / 処理に対応する trace の識別子 */
export interface TraceContext {
  /** 32 桁の 16 進 (小文字) */
  traceId: string;
  /** 16 桁の 16 進 (小文字)。不明なら省略 */
  spanId?: string;
  /** トレースにサンプリングされているか。不明なら省略 */
  sampled?: boolean;
}

/** W3C のヘッダ名 */
export const TRACEPARENT_HEADER = "traceparent";

// traceparent: version-trace_id-parent_id-flags (version 00 のみ対応)
// https://www.w3.org/TR/trace-context/#traceparent-header-field-values
const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
export const INVALID_TRACE_ID = "0".repeat(32);
export const INVALID_SPAN_ID = "0".repeat(16);

/**
 * ヘッダの入れ物。Web 標準の Headers (Next.js の Request.headers)、Node の
 * IncomingHttpHeaders のような名前と値の Record、Map のいずれでもよい。
 * Pub/Sub の属性など同じ形のものも渡せる。
 */
export type HeadersLike =
  | { get(name: string): string | null | undefined }
  | Map<string, unknown>
  | Readonly<Record<string, unknown>>;

/** 大文字小文字を区別せずにヘッダの値を取り出す。無ければ undefined */
export function headerValue(headers: HeadersLike, name: string): string | undefined {
  const lowered = name.toLowerCase();
  if (typeof (headers as { get?: unknown }).get === "function" && !(headers instanceof Map)) {
    const v = (headers as { get(name: string): string | null | undefined }).get(name);
    return v === null || v === undefined ? undefined : String(v);
  }
  const entries: Iterable<[string, unknown]> =
    headers instanceof Map ? headers.entries() : Object.entries(headers);
  for (const [key, value] of entries) {
    if (key.toLowerCase() !== lowered) continue;
    if (value === null || value === undefined) return undefined;
    // Node の IncomingHttpHeaders は同名ヘッダを配列にする。先頭を採る
    return String(Array.isArray(value) ? value[0] : value);
  }
  return undefined;
}

/**
 * W3C の traceparent ヘッダを解釈する。undefined や不正な形式、trace_id / span_id が
 * すべて 0 の無効値は undefined を返す。
 */
export function parseTraceparent(value: string | undefined): TraceContext | undefined {
  if (value === undefined) return undefined;
  const m = TRACEPARENT_PATTERN.exec(value.trim());
  if (m === null) return undefined;
  const [, traceId, spanId, flags] = m as unknown as [string, string, string, string];
  if (traceId === INVALID_TRACE_ID || spanId === INVALID_SPAN_ID) return undefined;
  return { traceId, spanId, sampled: (Number.parseInt(flags, 16) & 0x01) === 1 };
}

/**
 * W3C の traceparent ヘッダの値を組み立てる。traceparent は parent-id と flags が必須で
 * 「不明」を表せないため、spanId と sampled の両方が分かっているときだけ組み立てる。
 */
export function formatTraceparent(trace: TraceContext): string | undefined {
  if (trace.spanId === undefined || trace.sampled === undefined) return undefined;
  return `00-${trace.traceId}-${trace.spanId}-${trace.sampled ? "01" : "00"}`;
}

/** 受信ヘッダの traceparent から trace を取り出す (provider 固有のヘッダは見ない) */
export function traceFromHeaders(headers: HeadersLike): TraceContext | undefined {
  return parseTraceparent(headerValue(headers, TRACEPARENT_HEADER));
}

/**
 * 他サービスを呼び出すときに付ける traceparent ヘッダを組み立てる。
 * trace を省略すると現在の文脈の trace を使う。無いか、spanId / sampled が不明なら空。
 */
export function traceHeaders(
  trace: TraceContext | undefined = currentTrace(),
): Record<string, string> {
  const normalized = normalizeTrace(trace);
  if (normalized === undefined) return {};
  const value = formatTraceparent(normalized);
  return value === undefined ? {} : { [TRACEPARENT_HEADER]: value };
}

/** 新しい trace id (32 桁の 16 進) */
export function newTraceId(): string {
  return randomBytes(16).toString("hex");
}

/** 新しい span id (16 桁の 16 進) */
export function newSpanId(): string {
  return randomBytes(8).toString("hex");
}

/** 現在の文脈の trace (無ければ undefined) */
export function currentTrace(context: Context = getContext()): TraceContext | undefined {
  return normalizeTrace(context[TRACE_CONTEXT_KEY]);
}

export function isTraceContext(value: unknown): value is TraceContext {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { traceId?: unknown }).traceId === "string"
  );
}

const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;
const SPAN_ID_PATTERN = /^[0-9a-f]{16}$/;

/**
 * 外から来た TraceContext を正規化する (入口の 1 か所で検証し、以降はこの形を信用する)。
 * traceId が 32 桁の 16 進でなければ undefined (trace 無し)。spanId は 16 桁の 16 進で
 * なければ落とし、sampled は boolean でなければ落とす。大文字は小文字にする。
 * 解析 (parseTraceparent / parseCloudTraceContext) の出力は既にこの形。
 */
export function normalizeTrace(value: unknown): TraceContext | undefined {
  if (!isTraceContext(value)) return undefined;
  const traceId = value.traceId.toLowerCase();
  // 解析側 (parseTraceparent / parseCloudTraceContext) と同じく、W3C が無効とする全 0 も拒む
  if (!TRACE_ID_PATTERN.test(traceId) || traceId === INVALID_TRACE_ID) return undefined;
  const trace: TraceContext = { traceId };
  const spanId = typeof value.spanId === "string" ? value.spanId.toLowerCase() : undefined;
  if (spanId !== undefined && SPAN_ID_PATTERN.test(spanId) && spanId !== INVALID_SPAN_ID) {
    trace.spanId = spanId;
  }
  if (typeof value.sampled === "boolean") trace.sampled = value.sampled;
  return trace;
}

/**
 * fn の間だけ trace を文脈に置く (py-gn-log の trace.bind と対)。fields はあわせて文脈に置く
 * フィールド。py-gn-log と違い、Cloud Logging の trace のフィールドはここに渡さない
 * (provider の Formatter が予約キー trace から組む。渡すと型エラー / 予約キーのエラーになる)。
 * trace が undefined なら fields も置かず fn を呼ぶ。
 */
export function runWithTrace<T>(
  trace: TraceContext | undefined,
  fields: ContextFields | undefined,
  fn: () => T,
): T {
  const normalized = normalizeTrace(trace);
  if (normalized === undefined) return runWithContext({}, fn);
  return runWithContext({ ...(fields ?? {}), [TRACE_CONTEXT_KEY]: normalized }, fn);
}

/**
 * いちばん内側の runWithContext の範囲に trace を置く (py-gn-log の trace.set と対)。
 * trace が undefined なら何もしない。
 */
export function setTrace(trace: TraceContext | undefined, fields?: ContextFields): void {
  const normalized = normalizeTrace(trace);
  if (normalized === undefined) return;
  setContext({ ...(fields ?? {}), [TRACE_CONTEXT_KEY]: normalized });
}
