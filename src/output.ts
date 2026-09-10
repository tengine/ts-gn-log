/**
 * ログ出力の共通部 (provider を知らない。py-gn-log の gnlog.output と対)
 *
 * 出力形式の決定 (環境変数 GNLOG_FORMAT) を持つ。どの環境でどの形式にするかは
 * provider ごとのサブパス (`ts-gn-log/google/cloud-run` など) が決め、このモジュールの
 * 関数を組み合わせて入口 (`createLogger()`) を作る。
 */

/** 出力形式を明示的に指定する環境変数とその値。未設定なら provider の入口が渡す既定に従う */
export const GNLOG_FORMAT_ENV_VAR = "GNLOG_FORMAT";
export const GNLOG_FORMAT_JSON = "json";
export const GNLOG_FORMAT_TEXT = "text";

/**
 * JSON 形式で出力するかを決める。優先順位は 引数 `json` > 環境変数 `GNLOG_FORMAT` > `defaultValue`。
 *
 * @param json true なら JSON、false なら text。undefined なら環境変数と既定から決める
 * @param defaultValue 引数も環境変数も無いときの既定。boolean か、boolean を返す関数
 *   (provider の入口が「Cloud Run 上かどうか」の判定を渡す)
 * @throws 環境変数 GNLOG_FORMAT の値が "json" / "text" のいずれでもないとき
 *   (py-gn-log の use_json_output と同じく ValueError 相当のエラー)
 */
export function useJsonOutput(
  json: boolean | undefined,
  defaultValue: boolean | (() => boolean) = false,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (json !== undefined) return json;
  const value = env[GNLOG_FORMAT_ENV_VAR];
  if (value === undefined || value === "") {
    return typeof defaultValue === "function" ? defaultValue() : defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === GNLOG_FORMAT_JSON) return true;
  if (normalized === GNLOG_FORMAT_TEXT) return false;
  throw new Error(
    `Invalid value ${JSON.stringify(value)} for environment variable ${GNLOG_FORMAT_ENV_VAR}: ` +
      `expected ${JSON.stringify(GNLOG_FORMAT_JSON)} or ${JSON.stringify(GNLOG_FORMAT_TEXT)}`,
  );
}

import { isEnabled, type Level } from "./level.js";

/** 1 行のログの材料。Formatter が文字列にする */
export interface LogRecord {
  /** ロガー名 (Cloud Logging の `name`) */
  name: string;
  level: Level;
  message: string;
  timestamp: Date;
  /** 子ロガーの固定フィールドと呼び出し時のフィールドを合わせたもの (`err` は含まない) */
  fields: Record<string, unknown>;
  /** 呼び出し時に `err` として渡されたもの。Error でなくてもよい */
  err?: unknown;
}

/** LogRecord を 1 行の文字列にする (改行は含めない) */
export type Formatter = (record: LogRecord) => string;

/** 整形した 1 行を書き出す */
export type Writer = (level: Level, line: string) => void;

/** 呼び出し時に渡すフィールド。`err` だけは特別に扱う (JSON では ERROR 以上で stack_trace になる) */
export interface LogFields {
  err?: unknown;
  [key: string]: unknown;
}

export interface Logger {
  readonly name: string;
  readonly level: Level;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  critical(message: string, fields?: LogFields): void;
  /** 固定フィールドを持つ子ロガー。名前・レベル・出力先は親と同じ */
  child(fields: Record<string, unknown>): Logger;
}

export interface CoreLoggerOptions {
  name: string;
  /** これ未満のレベルは出力しない */
  level: Level;
  format: Formatter;
  /** 省略時は writeToStdio */
  write?: Writer;
  /** 全行に付く固定フィールド */
  fields?: Record<string, unknown>;
  /** テスト用。省略時は new Date() */
  now?: () => Date;
}

/**
 * severity が ERROR 以上なら stderr、それ以外は stdout に 1 行書く。
 * `console` を経由しない (Next.js の console パッチや色付けの影響を受けないため)。
 * Cloud Run は stdout / stderr の両方を取り込む。
 */
export const writeToStdio: Writer = (level, line) => {
  const stream = isEnabled(level, "ERROR") ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
};

/**
 * Logger の核。整形 (Formatter) と書き出し (Writer) を差し替えられる。
 * provider ごとの入口 (`ts-gn-log/google/cloud-run` の `createLogger`) がこれを組み合わせる。
 */
export function createCoreLogger(options: CoreLoggerOptions): Logger {
  const { name, level, format } = options;
  const write = options.write ?? writeToStdio;
  const now = options.now ?? (() => new Date());

  const make = (baseFields: Record<string, unknown>): Logger => {
    const emit = (recordLevel: Level, message: string, fields?: LogFields): void => {
      if (!isEnabled(recordLevel, level)) return;
      const { err, ...rest } = fields ?? {};
      const record: LogRecord = {
        name,
        level: recordLevel,
        message,
        timestamp: now(),
        fields: { ...baseFields, ...rest },
      };
      if (fields !== undefined && "err" in fields) record.err = err;
      write(recordLevel, format(record));
    };
    return {
      name,
      level,
      debug: (message, fields) => emit("DEBUG", message, fields),
      info: (message, fields) => emit("INFO", message, fields),
      warn: (message, fields) => emit("WARNING", message, fields),
      error: (message, fields) => emit("ERROR", message, fields),
      critical: (message, fields) => emit("CRITICAL", message, fields),
      child: (fields) => make({ ...baseFields, ...fields }),
    };
  };
  return make(options.fields ?? {});
}
