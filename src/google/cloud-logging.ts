/**
 * Cloud Logging 向けの JSON 整形 (py-gn-log の gnlog.google.cloud_logging と対)
 *
 * Cloud Logging が構造化ログとして認識する特殊フィールド (severity / timestamp /
 * logging.googleapis.com/labels) を付けた JSON を 1 行で出す。
 * 参考: https://cloud.google.com/logging/docs/structured-logging
 */

import type { Formatter, LogRecord } from "../output.js";

/** Cloud Logging の labels フィールドのキー */
export const CLOUD_LOGGING_LABELS_KEY = "logging.googleapis.com/labels";

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
    return JSON.stringify(entry);
  };
}
