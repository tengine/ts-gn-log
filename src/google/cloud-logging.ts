/**
 * Cloud Logging 向けの JSON 整形 (py-gn-log の gnlog.google.cloud_logging と対)
 *
 * Cloud Logging が構造化ログとして認識する特殊フィールド (severity / timestamp /
 * logging.googleapis.com/labels) を付けた JSON を 1 行で出す。
 * 参考: https://cloud.google.com/logging/docs/structured-logging
 */

import { isEnabled } from "../level.js";
import { describeError, type Formatter, type LogRecord } from "../output.js";

/** Cloud Logging の labels フィールドのキー */
export const CLOUD_LOGGING_LABELS_KEY = "logging.googleapis.com/labels";

/** Error Reporting が認識するスタックトレースのフィールド */
export const STACK_TRACE_KEY = "stack_trace";

/** ERROR 未満で err を渡したときにその文字列を入れるフィールド */
export const ERROR_KEY = "error";

export interface JsonFormatOptions {
  /** 全行の logging.googleapis.com/labels に入れる固定の labels */
  labels?: Record<string, string>;
}

/**
 * Cloud Logging 向けの JSON 行を作る Formatter。
 *
 * 全行に `severity` / `message` / `timestamp` (ISO 8601 UTC) / `name` /
 * `logging.googleapis.com/labels` を付け、呼び出し時のフィールドをそのまま並べる。
 * これらの固定キーと同名のフィールドは固定キーが勝つ。
 *
 * `err` を渡した行は、severity が ERROR 以上なら `stack_trace` (Error Reporting が認識する
 * フィールド。py-gn-log PR #9 と同じく ERROR 以上のみ)、それ未満なら `error` にその文字列を
 * 入れる。WARNING 以下を Error Reporting に集計させないため。
 * py-gn-log が labels に入れる thread_id / thread_name は、Node にスレッドが無いので付けない。
 */
export function jsonFormat(options: JsonFormatOptions = {}): Formatter {
  const labels = { ...(options.labels ?? {}) };
  return (record: LogRecord): string => {
    const entry: Record<string, unknown> = {
      ...record.fields,
      severity: record.level,
      message: record.message,
      timestamp: record.timestamp.toISOString(),
      name: record.name,
      [CLOUD_LOGGING_LABELS_KEY]: labels,
    };
    if ("err" in record) {
      const key = isEnabled(record.level, "ERROR") ? STACK_TRACE_KEY : ERROR_KEY;
      entry[key] = describeError(record.err);
    }
    return JSON.stringify(entry);
  };
}
