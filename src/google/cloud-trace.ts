/**
 * Cloud Trace と連携して、全ログ行に trace / spanId を付ける (py-gn-log の gnlog.google.cloud_trace と対)
 *
 * Cloud Run はリクエストごとに X-Cloud-Trace-Context ヘッダ (と W3C の traceparent) を付ける。
 * Cloud Logging は JSON の特殊フィールド logging.googleapis.com/trace
 * (projects/<PROJECT_ID>/traces/<TRACE_ID>)、logging.googleapis.com/spanId、
 * logging.googleapis.com/trace_sampled を認識してログエントリを trace に紐付ける。
 *
 * このモジュールは、共通部 ts-gn-log/trace の上に、X-Cloud-Trace-Context の解釈と
 * Cloud Logging の特殊フィールドの組み立てを載せたもの。
 *
 * 参考:
 * - https://cloud.google.com/logging/docs/structured-logging#special-payload-fields
 * - https://cloud.google.com/trace/docs/trace-context
 */

import type { Env } from "../level.js";
import {
  type HeadersLike,
  headerValue,
  INVALID_TRACE_ID,
  type TraceContext,
  traceFromHeaders as traceparentFromHeaders,
} from "../trace.js";

/** Cloud Logging の特殊フィールド名 */
export const TRACE_KEY = "logging.googleapis.com/trace";
export const SPAN_ID_KEY = "logging.googleapis.com/spanId";
export const TRACE_SAMPLED_KEY = "logging.googleapis.com/trace_sampled";

/** Cloud Run が付けるヘッダ名 */
export const CLOUD_TRACE_CONTEXT_HEADER = "X-Cloud-Trace-Context";

/** プロジェクト ID を読む環境変数 */
export const PROJECT_ID_ENV_VAR = "GOOGLE_CLOUD_PROJECT";

// X-Cloud-Trace-Context: TRACE_ID/SPAN_ID;o=TRACE_TRUE (SPAN_ID は 10 進、;o= は省略可)
// https://cloud.google.com/trace/docs/trace-context#legacy-http-header
const CLOUD_TRACE_CONTEXT_PATTERN = /^([0-9a-fA-F]{32})(?:\/(\d{1,20}))?(?:;o=([01]))?$/;
const MAX_SPAN_ID = (1n << 64n) - 1n;

/**
 * Cloud Run が付ける X-Cloud-Trace-Context ヘッダを解釈する。
 * TRACE_ID/SPAN_ID;o=TRACE_TRUE の形式。SPAN_ID は 10 進で、Cloud Logging の spanId に
 * 合わせて 16 桁の 16 進に変換する。;o= が無ければ sampled は省略。
 */
export function parseCloudTraceContext(value: string | undefined): TraceContext | undefined {
  if (value === undefined) return undefined;
  const m = CLOUD_TRACE_CONTEXT_PATTERN.exec(value.trim());
  if (m === null) return undefined;
  const traceId = (m[1] as string).toLowerCase();
  if (traceId === INVALID_TRACE_ID) return undefined;
  const trace: TraceContext = { traceId };
  if (m[2] !== undefined) {
    const spanInt = BigInt(m[2]);
    if (spanInt > 0n && spanInt <= MAX_SPAN_ID) {
      trace.spanId = spanInt.toString(16).padStart(16, "0");
    }
  }
  if (m[3] !== undefined) trace.sampled = m[3] === "1";
  return trace;
}

/**
 * 受信ヘッダ (または Pub/Sub の属性など同じ形のもの) から trace を取り出す。
 * py-gn-log と同じく traceparent を優先し、無ければ X-Cloud-Trace-Context を見る。
 * キーの大文字小文字は区別しない。どちらも無いか不正なら undefined (新規生成はしない —
 * それは withRequestTrace の責務)。
 */
export function traceFromHeaders(headers: HeadersLike): TraceContext | undefined {
  return (
    traceparentFromHeaders(headers) ??
    parseCloudTraceContext(headerValue(headers, CLOUD_TRACE_CONTEXT_HEADER))
  );
}

/** 環境変数 GOOGLE_CLOUD_PROJECT からプロジェクト ID を取る (未設定か空なら undefined) */
export function projectIdFromEnv(env: Env = process.env): string | undefined {
  const value = env[PROJECT_ID_ENV_VAR];
  return value === undefined || value === "" ? undefined : value;
}

/**
 * trace から Cloud Logging の特殊フィールドを組み立てる。projectId が無ければ空
 * (trace のフィールドは付けない — 既定値で本番のプロジェクト ID を持たないため)。
 */
export function logFields(
  trace: TraceContext,
  projectId: string | undefined,
): Record<string, unknown> {
  if (projectId === undefined || projectId === "") return {};
  const fields: Record<string, unknown> = {
    [TRACE_KEY]: `projects/${projectId}/traces/${trace.traceId}`,
  };
  if (trace.spanId !== undefined) fields[SPAN_ID_KEY] = trace.spanId;
  if (trace.sampled !== undefined) fields[TRACE_SAMPLED_KEY] = trace.sampled;
  return fields;
}
