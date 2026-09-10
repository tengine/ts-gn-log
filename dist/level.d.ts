/**
 * ログレベルの変換と、環境変数 LOG_LEVEL の読み取り (py-gn-log の gnlog.level と対)
 *
 * レベルの名前は Cloud Logging の LogSeverity に合わせた 5 つ。比較のための数値は
 * Python の logging モジュールと同じ (DEBUG=10 ... CRITICAL=50)。
 */
export declare const LEVELS: readonly ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"];
/** ログレベルの名前。Cloud Logging の severity としてそのまま出力する */
export type Level = (typeof LEVELS)[number];
export declare const DEFAULT_LEVEL: Level;
/**
 * 環境変数の入れ物。`process.env` をそのまま渡せる。
 * `NodeJS.ProcessEnv` を使わないのは、利用側が `@types/node` を型に含めていなくても
 * この .d.ts が解決できるようにするため。
 */
export type Env = Readonly<Record<string, string | undefined>>;
/** 環境変数の名前 */
export declare const LOG_LEVEL_ENV_VAR = "LOG_LEVEL";
/**
 * レベルの文字列 (大文字・小文字を問わない) を Level に変換する。
 * 未知の値は `defaultLevel` に倒す (py-gn-log の level.parse と同じ。エラーにしない)。
 * 文字列以外 (null / 数値 / 配列など。JS からの利用や JSON.parse した設定値) も同じく
 * `defaultLevel` に倒し、投げない — 外部から来る値の正規化はこの 1 か所で行う。
 */
export declare function parseLevel(s: unknown, defaultLevel?: Level): Level;
/**
 * 環境変数 LOG_LEVEL からレベルを読む。未設定か空なら INFO、未知の値も INFO。
 */
export declare function levelFromEnv(env?: Env): Level;
/** 比較用の数値 (DEBUG=10, INFO=20, WARNING=30, ERROR=40, CRITICAL=50) */
export declare function levelValue(level: Level): number;
/** `level` が `threshold` 以上か (threshold と同じかそれより深刻か) */
export declare function isEnabled(level: Level, threshold: Level): boolean;
