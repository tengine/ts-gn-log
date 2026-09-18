/**
 * Cloud Logging 向けの JSON 整形 (py-gn-log の gnlog.google.cloud_logging と対)
 *
 * Cloud Logging が構造化ログとして認識する特殊フィールド (severity / timestamp /
 * logging.googleapis.com/labels) を付けた JSON を 1 行で出す。
 * 参考: https://cloud.google.com/logging/docs/structured-logging
 */
import { type Formatter } from "../output.js";
/** Cloud Logging の labels フィールドのキー */
export declare const CLOUD_LOGGING_LABELS_KEY = "logging.googleapis.com/labels";
/** Error Reporting が認識するスタックトレースのフィールド */
export declare const STACK_TRACE_KEY = "stack_trace";
/** ERROR 未満で err を渡したときにその文字列を入れるフィールド */
export declare const ERROR_KEY = "error";
/** フィールドを直列化できなかったとき、その理由を入れるフィールド */
export declare const FIELDS_ERROR_KEY = "fields_error";
export interface JsonFormatOptions {
    /** 全行の logging.googleapis.com/labels に入れる固定の labels */
    labels?: Record<string, string>;
    /**
     * logging.googleapis.com/trace の組み立てに使うプロジェクト ID。無ければ、文脈に trace が
     * あっても trace のフィールドを付けない (設計案 §2.2。既定値を持たない)
     */
    projectId?: string;
}
/**
 * Cloud Logging 向けの JSON 行を作る Formatter。
 *
 * 全行に `severity` / `message` / `timestamp` (ISO 8601 UTC) / `name` /
 * `logging.googleapis.com/labels` を付け、呼び出し時のフィールドをそのまま並べる。
 * 文脈に trace があり projectId が分かれば `logging.googleapis.com/trace` / `spanId` /
 * `trace_sampled` を付ける。
 * これらの固定キーと同名のフィールドは固定キーが勝つ。
 *
 * フィールドに循環参照や BigInt があっても行を出し (循環は "[Circular]"、BigInt は文字列)、
 * それでも直列化できないときはフィールドを落として `fields_error` に理由を入れ、severity /
 * message などの固定キーは必ず出す。固定キー自体が直列化できないときは投げる — 「ログの
 * 呼び出しは投げない」の保証は createCoreLogger の emit が持ち、最後の手段の行を出す。
 *
 * `err` を渡した行は、severity が ERROR 以上なら `stack_trace` (Error Reporting が認識する
 * フィールド。py-gn-log PR #9 と同じく ERROR 以上のみ)、それ未満なら `error` にその文字列を
 * 入れる。WARNING 以下を Error Reporting に集計させないため。
 * py-gn-log が labels に入れる thread_id / thread_name は、Node にスレッドが無いので付けない。
 */
export declare function jsonFormat(options?: JsonFormatOptions): Formatter;
