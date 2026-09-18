/**
 * ログ出力の共通部 (provider を知らない。py-gn-log の gnlog.output と対)
 *
 * 出力形式の決定 (環境変数 GNLOG_FORMAT) を持つ。どの環境でどの形式にするかは
 * provider ごとのサブパス (`ts-gn-log/google/cloud-run` など) が決め、このモジュールの
 * 関数を組み合わせて入口 (`createLogger()`) を作る。
 */

import { type Context, contextFields, getContext } from "./context.js";
import { type Env, isEnabled, type Level } from "./level.js";

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
  env: Env = process.env,
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

/** 1 行のログの材料。Formatter が文字列にする */
export interface LogRecord {
  /** ロガー名 (Cloud Logging の `name`) */
  name: string;
  level: Level;
  message: string;
  timestamp: Date;
  /** 文脈 (ts-gn-log/context)、子ロガーの固定フィールド、呼び出し時のフィールドを合わせたもの (`err` は含まない) */
  fields: Record<string, unknown>;
  /** 呼び出し時に `err` として渡されたもの。Error でなくてもよい */
  err?: unknown;
  /** 出力時の文脈 (ts-gn-log/context) のスナップショット。予約キー `trace` は provider の Formatter がここから読む */
  context: Context;
}

/** LogRecord を文字列にする。JSON 形式は改行を含めない (Cloud Logging が 1 行を 1 エントリとして読む) */
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
  /** 固定フィールドを持つ子ロガー。名前・レベル・出力先は親と同じ。`err` を渡せば呼び出し時と同じく特別に扱う */
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
  /**
   * format か write が例外を投げたときに書く最後の手段の行。省略時は lastResortJson。
   * 文字列化に依存しない材料だけで組み、投げないことが求められる
   */
  lastResort?: LastResort;
}

/** base (複製済みの素のオブジェクト) に extra を重ねる。extra の列挙が投げたら base だけを返す */
function safeMerge(
  base: Record<string, unknown>,
  extra: Record<string, unknown> | undefined,
): Record<string, unknown> {
  try {
    return { ...base, ...(extra ?? {}) };
  } catch {
    return { ...base };
  }
}

function safeNow(now: () => Date): Date {
  try {
    return now();
  } catch {
    return new Date();
  }
}

/** 最後の手段の行を組む。record の値は信用せず、safeString で素の文字列にしてから使う */
export type LastResort = (record: LogRecord, error: unknown) => string;

/** どんな値でも投げずに文字列にする */
export function safeString(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return String(value);
  } catch {
    return "[unprintable]";
  }
}

function safeTimestamp(record: LogRecord): string {
  try {
    return record.timestamp.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/** 最後の手段 (JSON)。severity / message / name と失敗の理由だけの固定の行。素の文字列しか含まないので投げない */
export const lastResortJson: LastResort = (record, error) =>
  JSON.stringify({
    severity: safeString(record.level),
    message: safeString(record.message),
    timestamp: safeTimestamp(record),
    name: safeString(record.name),
    format_error: safeString(error instanceof Error ? `${error.name}: ${error.message}` : error),
  });

/** 最後の手段 (text) */
export const lastResortText: LastResort = (record, error) =>
  `${safeTimestamp(record)} ${safeString(record.level).padEnd(8)} ${safeString(record.name)}  ${safeString(record.message)}  (format error: ${safeString(error instanceof Error ? `${error.name}: ${error.message}` : error)})`;

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
  const lastResort = options.lastResort ?? lastResortJson;

  const make = (baseFields: Record<string, unknown>): Logger => {
    const emit = (recordLevel: Level, message: string, fields?: LogFields): void => {
      if (!isEnabled(recordLevel, level)) return;
      // 「ログの呼び出しは投げない」の保証はここ 1 か所に置く。フィールドの合流 (spread は
      // 呼び出し元の getter を評価する) から整形までを 1 つの try で囲み、途中で投げても
      // 最後の手段の行を出す。write が投げても (stdout が閉じている等) 伝播させない
      let record: LogRecord | undefined;
      let line: string;
      try {
        // 文脈 (ts-gn-log/context) < 固定フィールド (child) < 呼び出し時のフィールド の順に
        // 重ねてから err を分離する。child({ err }) で渡した err も同じ扱いにするため
        const context = getContext();
        const merged: Record<string, unknown> = {
          ...contextFields(context),
          ...baseFields,
          ...(fields ?? {}),
        };
        const { err, ...rest } = merged;
        record = { name, level: recordLevel, message, timestamp: now(), fields: rest, context };
        if ("err" in merged) record.err = err;
        line = format(record);
      } catch (e) {
        line = lastResort(
          record ?? {
            name,
            level: recordLevel,
            message,
            timestamp: safeNow(now),
            fields: {},
            context: {},
          },
          e,
        );
      }
      try {
        write(recordLevel, line);
      } catch {
        // Python の logging.Handler.handleError と同じく、呼び出し元には伝播させない
      }
    };
    return {
      name,
      level,
      debug: (message, fields) => emit("DEBUG", message, fields),
      info: (message, fields) => emit("INFO", message, fields),
      warn: (message, fields) => emit("WARNING", message, fields),
      error: (message, fields) => emit("ERROR", message, fields),
      critical: (message, fields) => emit("CRITICAL", message, fields),
      // 入口の spread も投げうる (getter)。投げたら基底フィールドだけで作る
      child: (fields) => make(safeMerge(baseFields, fields)),
    };
  };
  // child や labels と同じく複製する。渡したオブジェクトを後から書き換えても出力に影響させない
  return make(safeMerge({}, options.fields));
}

/**
 * フィールドを JSON にする。ログの呼び出しは例外を投げない (Python の logging と同じ) ので、
 * 直列化できない値があっても必ず文字列を返す。
 *
 * - BigInt は 10 進の文字列にする
 * - 循環参照は "[Circular]" に置き換える (祖先に同じオブジェクトがあるときだけ。兄弟で同じ
 *   オブジェクトを参照しているのは循環ではないのでそのまま出す)
 * - それでも失敗するとき (toJSON や getter が投げる等) は `ok: false` で理由を返す
 */
export function tryStringify(
  value: unknown,
): { ok: true; json: string } | { ok: false; error: string } {
  const ancestors: object[] = [];
  function replacer(this: unknown, _key: string, v: unknown): unknown {
    if (typeof v === "bigint") return v.toString();
    if (typeof v !== "object" || v === null) return v;
    while (ancestors.length > 0 && ancestors.at(-1) !== this) ancestors.pop();
    if (ancestors.includes(v)) return "[Circular]";
    ancestors.push(v);
    return v;
  }
  try {
    return { ok: true, json: JSON.stringify(value, replacer) ?? "null" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}

/**
 * `err` をログに載せる文字列にする。Error なら stack (無ければ `name: message`)、
 * それ以外 (文字列 / unknown) は文字列にする。`message` は変えない。
 */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? `${err.name}: ${err.message}`;
  }
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

/**
 * ローカル (Cloud Run 外) 向けの、人が読む text 形式。
 * `2026-09-09T01:23:45.678Z INFO     bff  message  {"site":"a"}` の 1 行に、`err` があれば
 * 次の行以降にその文字列 (Error なら stack) を続ける。書式は固定で、py-gn-log の
 * LOG_FORMAT のような書式文字列は持たない。
 */
export const textFormat: Formatter = (record) => {
  let line = `${record.timestamp.toISOString()} ${record.level.padEnd(8)} ${record.name}  ${record.message}`;
  if (Object.keys(record.fields).length > 0) {
    const r = tryStringify(record.fields);
    line += r.ok ? `  ${r.json}` : `  (fields not serializable: ${r.error})`;
  }
  if ("err" in record) {
    line += `\n${describeError(record.err)}`;
  }
  return line;
};
