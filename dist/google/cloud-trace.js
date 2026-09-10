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
import { currentTrace, headerValue, INVALID_TRACE_ID, newTraceId, runWithTrace, setTrace, traceFromHeaders as traceparentFromHeaders, traceHeaders as traceparentHeaders, } from "../trace.js";
// 共通部の関数をこのモジュールからも使えるようにする (py-gn-log の cloud_trace と同じ並び)
export { currentTrace, runWithTrace, setTrace };
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
export function parseCloudTraceContext(value) {
    if (value === undefined)
        return undefined;
    const m = CLOUD_TRACE_CONTEXT_PATTERN.exec(value.trim());
    if (m === null)
        return undefined;
    const traceId = m[1].toLowerCase();
    if (traceId === INVALID_TRACE_ID)
        return undefined;
    const trace = { traceId };
    if (m[2] !== undefined) {
        const spanInt = BigInt(m[2]);
        if (spanInt > 0n && spanInt <= MAX_SPAN_ID) {
            trace.spanId = spanInt.toString(16).padStart(16, "0");
        }
    }
    if (m[3] !== undefined)
        trace.sampled = m[3] === "1";
    return trace;
}
/**
 * 受信ヘッダ (または Pub/Sub の属性など同じ形のもの) から trace を取り出す。
 * py-gn-log と同じく traceparent を優先し、無ければ X-Cloud-Trace-Context を見る。
 * キーの大文字小文字は区別しない。どちらも無いか不正なら undefined (新規生成はしない —
 * それは withRequestTrace の責務)。
 */
export function traceFromHeaders(headers) {
    return (traceparentFromHeaders(headers) ??
        parseCloudTraceContext(headerValue(headers, CLOUD_TRACE_CONTEXT_HEADER)));
}
/** 環境変数 GOOGLE_CLOUD_PROJECT からプロジェクト ID を取る (未設定か空なら undefined) */
export function projectIdFromEnv(env = process.env) {
    const value = env[PROJECT_ID_ENV_VAR];
    return value === undefined || value === "" ? undefined : value;
}
/**
 * trace から Cloud Logging の特殊フィールドを組み立てる。projectId が無ければ空
 * (trace のフィールドは付けない — 既定値で本番のプロジェクト ID を持たないため)。
 */
export function logFields(trace, projectId) {
    if (projectId === undefined || projectId === "")
        return {};
    const fields = {
        [TRACE_KEY]: `projects/${projectId}/traces/${trace.traceId}`,
    };
    if (trace.spanId !== undefined)
        fields[SPAN_ID_KEY] = trace.spanId;
    if (trace.sampled !== undefined)
        fields[TRACE_SAMPLED_KEY] = trace.sampled;
    return fields;
}
/**
 * 他サービスを呼び出すときに付ける trace のヘッダを組み立てる。trace を省略すると現在の
 * 文脈の trace を使う。traceparent は spanId と sampled の両方が分かっているときだけ、
 * X-Cloud-Trace-Context は省略で不明を表せるので常に付ける。trace が無ければ空。
 */
export function traceHeaders(trace = currentTrace()) {
    if (trace === undefined)
        return {};
    const headers = traceparentHeaders(trace);
    let cloud = trace.traceId;
    if (trace.spanId !== undefined)
        cloud += `/${BigInt(`0x${trace.spanId}`).toString(10)}`;
    if (trace.sampled !== undefined)
        cloud += `;o=${trace.sampled ? 1 : 0}`;
    headers[CLOUD_TRACE_CONTEXT_HEADER] = cloud;
    return headers;
}
/**
 * Next.js の Route Handler (や、headers を持つリクエストを受ける関数) を包み、受信ヘッダの
 * trace を文脈に置いてから呼ぶ。trace が無ければ新規に生成する (設計案 §3) ので、
 * 包まれた処理の中では currentTrace() が常に返り、応答 body に載せる trace id にも使える。
 *
 * @example
 * export const POST = withRequestTrace(async (req) => {
 *   log.info("received");                  // logging.googleapis.com/trace が付く
 *   return Response.json({ trace_id: currentTrace()?.traceId });
 * });
 */
export function withRequestTrace(handler, options = {}) {
    const generate = options.newTrace ?? (() => ({ traceId: newTraceId() }));
    return (request, ...args) => {
        const trace = traceFromHeaders(request.headers) ?? generate();
        const fields = typeof options.fields === "function" ? options.fields(request) : options.fields;
        return runWithTrace(trace, fields, () => handler(request, ...args));
    };
}
