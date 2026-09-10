/**
 * Cloud Run 向けの入口 (py-gn-log の gnlog.google.cloud_run と対)
 *
 * `isCloudRun()` は Cloud Run (Service / Job / Worker Pool) 上で動いているかを判定する。
 */

// Cloud Run 上で自動設定される環境変数。いずれかが存在すれば Cloud Run 環境と判定する。
// - K_SERVICE: Cloud Run Service でのみ自動設定される
//   https://cloud.google.com/run/docs/container-contract#services-env-vars
// - CLOUD_RUN_JOB: Cloud Run Job でのみ自動設定される
//   https://cloud.google.com/run/docs/container-contract#jobs-env-vars
// - CLOUD_RUN_WORKER_POOL: Cloud Run Worker Pool でのみ自動設定される
//   https://cloud.google.com/run/docs/container-contract#worker-pools-env-vars
const CLOUD_RUN_ENV_VARS = ["K_SERVICE", "CLOUD_RUN_JOB", "CLOUD_RUN_WORKER_POOL"] as const;

/**
 * Cloud Run (Service / Job / Worker Pool) 上で実行されているかを判定する。
 *
 * py-gn-log の `is_cloud_run()` と同じく、3 つの環境変数のいずれかが存在する
 * (値が空文字列でも存在すれば真) ことで判定する。
 */
export function isCloudRun(env: NodeJS.ProcessEnv = process.env): boolean {
  return CLOUD_RUN_ENV_VARS.some((name) => env[name] !== undefined);
}

import { type Level, levelFromEnv } from "../level.js";
import {
  createCoreLogger,
  type Logger,
  textFormat,
  useJsonOutput as useJsonOutputCommon,
  type Writer,
} from "../output.js";
import { jsonFormat } from "./cloud-logging.js";

/**
 * JSON 形式で出力するかを決める (引数 > 環境変数 GNLOG_FORMAT > Cloud Run 上かどうか)。
 * py-gn-log の gnlog.google.cloud_run.use_json_output と対。
 */
export function useJsonOutput(
  json: boolean | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return useJsonOutputCommon(json, () => isCloudRun(env), env);
}

export interface CreateLoggerOptions {
  /** ロガー名。全行の `name` に入る */
  name: string;
  /** 全行の logging.googleapis.com/labels に入れる固定の labels (JSON 形式のみ) */
  labels?: Record<string, string>;
  /** 出力するレベルの下限。省略時は環境変数 LOG_LEVEL、無ければ INFO */
  level?: Level;
  /** true なら JSON、false なら text。省略時は環境変数 GNLOG_FORMAT、無ければ Cloud Run 上なら JSON */
  json?: boolean;
  /** 全行に付く固定フィールド */
  fields?: Record<string, unknown>;
  /** 書き出し先の差し替え (テスト用)。省略時は stdout / stderr */
  write?: Writer;
  /** 環境変数の差し替え (テスト用)。省略時は process.env */
  env?: NodeJS.ProcessEnv;
}

/**
 * Cloud Run 向けのロガーを作る。プロセスで 1 回呼ぶ (py-gn-log の setup_logging() に相当)。
 *
 * Cloud Run 上 (または GNLOG_FORMAT=json / json: true) なら Cloud Logging 向けの JSON 行、
 * それ以外なら人が読む text 形式で、console を経由せず stdout / stderr に書く。
 *
 * @throws 環境変数 GNLOG_FORMAT の値が "json" / "text" のいずれでもないとき (json 未指定の場合のみ)
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  const env = options.env ?? process.env;
  const json = useJsonOutput(options.json, env);
  const level = options.level ?? levelFromEnv(env);
  const format = json
    ? jsonFormat(options.labels === undefined ? {} : { labels: options.labels })
    : textFormat;
  const core: Parameters<typeof createCoreLogger>[0] = { name: options.name, level, format };
  if (options.fields !== undefined) core.fields = options.fields;
  if (options.write !== undefined) core.write = options.write;
  return createCoreLogger(core);
}
