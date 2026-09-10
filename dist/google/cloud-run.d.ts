/**
 * Cloud Run 向けの入口 (py-gn-log の gnlog.google.cloud_run と対)
 *
 * `isCloudRun()` は Cloud Run (Service / Job / Worker Pool) 上で動いているかを判定する。
 */
/**
 * Cloud Run (Service / Job / Worker Pool) 上で実行されているかを判定する。
 *
 * py-gn-log の `is_cloud_run()` と同じく、3 つの環境変数のいずれかが存在する
 * (値が空文字列でも存在すれば真) ことで判定する。
 */
export declare function isCloudRun(env?: NodeJS.ProcessEnv): boolean;
import { type Level } from "../level.js";
import { type Logger, type Writer } from "../output.js";
/**
 * JSON 形式で出力するかを決める (引数 > 環境変数 GNLOG_FORMAT > Cloud Run 上かどうか)。
 * py-gn-log の gnlog.google.cloud_run.use_json_output と対。
 */
export declare function useJsonOutput(json: boolean | undefined, env?: NodeJS.ProcessEnv): boolean;
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
export declare function createLogger(options: CreateLoggerOptions): Logger;
