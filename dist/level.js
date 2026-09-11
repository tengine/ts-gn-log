/**
 * ログレベルの変換と、環境変数 LOG_LEVEL の読み取り (py-gn-log の gnlog.level と対)
 *
 * レベルの名前は Cloud Logging の LogSeverity に合わせた 5 つ。比較のための数値は
 * Python の logging モジュールと同じ (DEBUG=10 ... CRITICAL=50)。
 */
export const LEVELS = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"];
export const DEFAULT_LEVEL = "INFO";
/** 環境変数の名前 */
export const LOG_LEVEL_ENV_VAR = "LOG_LEVEL";
const LEVEL_VALUES = {
    DEBUG: 10,
    INFO: 20,
    WARNING: 30,
    ERROR: 40,
    CRITICAL: 50,
};
// py-gn-log の level.parse と同じく WARN と WARNING の両方を受け付ける
const ALIASES = {
    DEBUG: "DEBUG",
    INFO: "INFO",
    WARN: "WARNING",
    WARNING: "WARNING",
    ERROR: "ERROR",
    CRITICAL: "CRITICAL",
};
/**
 * レベルの文字列 (大文字・小文字を問わない) を Level に変換する。
 * `typeof s !== "string"` なら `defaultLevel` (投げない)。文字列は trim → 大文字化 → 別名表で
 * 引き、無ければ `defaultLevel` (py-gn-log の level.parse と同じ。エラーにしない)。
 * 外部から来る値 (JS からの利用や JSON.parse した設定値) の正規化はこの 1 か所で行い、
 * この判定を散文で言い換えた記述はここ以外に置かない — 受け付ける値の一覧は
 * test/level.test.ts が TYPEOF_SPACE の表で検証する。
 */
export function parseLevel(s, defaultLevel = DEFAULT_LEVEL) {
    if (typeof s !== "string")
        return defaultLevel;
    return ALIASES[s.trim().toUpperCase()] ?? defaultLevel;
}
/**
 * 環境変数 LOG_LEVEL からレベルを読む。未設定か空なら INFO、未知の値も INFO。
 */
export function levelFromEnv(env = process.env) {
    const value = env[LOG_LEVEL_ENV_VAR];
    if (value === undefined || value === "")
        return DEFAULT_LEVEL;
    return parseLevel(value, DEFAULT_LEVEL);
}
/** 比較用の数値 (DEBUG=10, INFO=20, WARNING=30, ERROR=40, CRITICAL=50) */
export function levelValue(level) {
    return LEVEL_VALUES[level];
}
/** `level` が `threshold` 以上か (threshold と同じかそれより深刻か) */
export function isEnabled(level, threshold) {
    return LEVEL_VALUES[level] >= LEVEL_VALUES[threshold];
}
