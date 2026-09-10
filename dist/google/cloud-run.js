/**
 * Cloud Run 向けの入口 (py-gn-log の gnlog.google.cloud_run と対)
 *
 * `isCloudRun()` は Cloud Run (Service / Job / Worker Pool) 上で動いているかを判定する。
 */
import { levelFromEnv, parseLevel } from "../level.js";
import { createCoreLogger, lastResortJson, lastResortText, textFormat, useJsonOutput as useJsonOutputCommon, } from "../output.js";
import { jsonFormat } from "./cloud-logging.js";
// Cloud Run 上で自動設定される環境変数。いずれかが存在すれば Cloud Run 環境と判定する。
// - K_SERVICE: Cloud Run Service でのみ自動設定される
//   https://cloud.google.com/run/docs/container-contract#services-env-vars
// - CLOUD_RUN_JOB: Cloud Run Job でのみ自動設定される
//   https://cloud.google.com/run/docs/container-contract#jobs-env-vars
// - CLOUD_RUN_WORKER_POOL: Cloud Run Worker Pool でのみ自動設定される
//   https://cloud.google.com/run/docs/container-contract#worker-pools-env-vars
const CLOUD_RUN_ENV_VARS = ["K_SERVICE", "CLOUD_RUN_JOB", "CLOUD_RUN_WORKER_POOL"];
/**
 * Cloud Run (Service / Job / Worker Pool) 上で実行されているかを判定する。
 *
 * py-gn-log の `is_cloud_run()` と同じく、3 つの環境変数のいずれかが存在する
 * (値が空文字列でも存在すれば真) ことで判定する。
 */
export function isCloudRun(env = process.env) {
    return CLOUD_RUN_ENV_VARS.some((name) => env[name] !== undefined);
}
/**
 * JSON 形式で出力するかを決める (引数 > 環境変数 GNLOG_FORMAT > Cloud Run 上かどうか)。
 * py-gn-log の gnlog.google.cloud_run.use_json_output と対。
 */
export function useJsonOutput(json, env = process.env) {
    return useJsonOutputCommon(json, () => isCloudRun(env), env);
}
/**
 * Cloud Run 向けのロガーを作る。プロセスで 1 回呼ぶ (py-gn-log の setup_logging() に相当)。
 *
 * Cloud Run 上 (または GNLOG_FORMAT=json / json: true) なら Cloud Logging 向けの JSON 行、
 * それ以外なら人が読む text 形式で、console を経由せず stdout / stderr に書く。
 *
 * @throws 環境変数 GNLOG_FORMAT の値が "json" / "text" のいずれでもないとき (json 未指定の場合のみ)
 */
export function createLogger(options) {
    const env = options.env ?? process.env;
    const json = useJsonOutput(options.json, env);
    // 外から来る値はここで正規化する。TypeScript の型は JS からの利用や JSON.parse した設定値を守らない。
    // level: 未指定なら LOG_LEVEL、未知の文字列や文字列以外は INFO (parseLevel が 1 か所で倒す)
    const level = options.level === undefined ? levelFromEnv(env) : parseLevel(options.level);
    // fields: オブジェクト以外 (null / 配列 / 文字列) は無視する
    const fields = isPlainObject(options.fields) ? options.fields : undefined;
    // labels: オブジェクト以外は無視し、値は文字列にする (Cloud Logging の labels は文字列の map)
    const labels = isPlainObject(options.labels) ? stringValues(options.labels) : undefined;
    const format = json ? jsonFormat(labels === undefined ? {} : { labels }) : textFormat;
    const core = {
        name: options.name,
        level,
        format,
        lastResort: json ? lastResortJson : lastResortText,
    };
    if (fields !== undefined)
        core.fields = fields;
    if (options.write !== undefined)
        core.write = options.write;
    return createCoreLogger(core);
}
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
// 値の文字列化 (toString) が投げる項目は落とす。入口の正規化は投げない
function stringValues(record) {
    const out = {};
    for (const [key, value] of Object.entries(record)) {
        try {
            out[key] = String(value);
        }
        catch {
            // この項目だけ落とす
        }
    }
    return out;
}
