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
import { currentTrace, type HeadersLike, runWithTrace, setTrace, type TraceContext } from "../trace.js";
export { currentTrace, runWithTrace, setTrace };
/** Cloud Logging の特殊フィールド名 */
export declare const TRACE_KEY = "logging.googleapis.com/trace";
export declare const SPAN_ID_KEY = "logging.googleapis.com/spanId";
export declare const TRACE_SAMPLED_KEY = "logging.googleapis.com/trace_sampled";
/** Cloud Run が付けるヘッダ名 */
export declare const CLOUD_TRACE_CONTEXT_HEADER = "X-Cloud-Trace-Context";
/** プロジェクト ID を読む環境変数 */
export declare const PROJECT_ID_ENV_VAR = "GOOGLE_CLOUD_PROJECT";
/**
 * Cloud Run が付ける X-Cloud-Trace-Context ヘッダを解釈する。
 * TRACE_ID/SPAN_ID;o=TRACE_TRUE の形式。SPAN_ID は 10 進で、Cloud Logging の spanId に
 * 合わせて 16 桁の 16 進に変換する。;o= が無ければ sampled は省略。
 */
export declare function parseCloudTraceContext(value: string | undefined): TraceContext | undefined;
/**
 * 受信ヘッダ (または Pub/Sub の属性など同じ形のもの) から trace を取り出す。
 * py-gn-log と同じく traceparent を優先し、無ければ X-Cloud-Trace-Context を見る。
 * キーの大文字小文字は区別しない。どちらも無いか不正なら undefined (新規生成はしない —
 * それは withRequestTrace の責務)。
 */
export declare function traceFromHeaders(headers: HeadersLike): TraceContext | undefined;
/** 環境変数 GOOGLE_CLOUD_PROJECT からプロジェクト ID を取る (未設定か空なら undefined) */
export declare function projectIdFromEnv(env?: Env): string | undefined;
/**
 * trace から Cloud Logging の特殊フィールドを組み立てる。projectId が無ければ空
 * (trace のフィールドは付けない — 既定値で本番のプロジェクト ID を持たないため)。
 */
export declare function logFields(trace: TraceContext, projectId: string | undefined): Record<string, unknown>;
/**
 * 他サービスを呼び出すときに付ける trace のヘッダを組み立てる。trace を省略すると現在の
 * 文脈の trace を使う。traceparent は spanId と sampled の両方が分かっているときだけ、
 * X-Cloud-Trace-Context は省略で不明を表せるので常に付ける。trace が無ければ空。
 */
export declare function traceHeaders(trace?: TraceContext | undefined): Record<string, string>;
/** withRequestTrace が受け取るリクエスト。Web 標準の Request でも、headers を持つものなら何でもよい */
export interface RequestLike {
    headers: HeadersLike;
}
export interface WithRequestTraceOptions<Req> {
    /** trace とあわせて文脈に置くフィールド。リクエストから組み立てる関数でもよい */
    fields?: Record<string, unknown> | ((request: Req) => Record<string, unknown>);
    /** ヘッダに trace が無いときの新規生成。省略時は traceId だけ (spanId / sampled は不明) */
    newTrace?: () => TraceContext;
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
export declare function withRequestTrace<Req extends RequestLike, Args extends unknown[], R>(handler: (request: Req, ...args: Args) => R, options?: WithRequestTraceOptions<Req>): (request: Req, ...args: Args) => R;
