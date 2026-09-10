/**
 * ログレベルの変換と、環境変数 LOG_LEVEL の読み取り (py-gn-log の gnlog.level と対)
 *
 * レベルの名前は Cloud Logging の LogSeverity に合わせた 5 つ。比較のための数値は
 * Python の logging モジュールと同じ (DEBUG=10 ... CRITICAL=50)。
 */

export const LEVELS = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] as const;

/** ログレベルの名前。Cloud Logging の severity としてそのまま出力する */
export type Level = (typeof LEVELS)[number];

export const DEFAULT_LEVEL: Level = "INFO";

/**
 * 環境変数の入れ物。`process.env` をそのまま渡せる。
 * `NodeJS.ProcessEnv` を使わないのは、利用側が `@types/node` を型に含めていなくても
 * この .d.ts が解決できるようにするため。
 */
export type Env = Readonly<Record<string, string | undefined>>;

/** 環境変数の名前 */
export const LOG_LEVEL_ENV_VAR = "LOG_LEVEL";

const LEVEL_VALUES: Record<Level, number> = {
  DEBUG: 10,
  INFO: 20,
  WARNING: 30,
  ERROR: 40,
  CRITICAL: 50,
};

// py-gn-log の level.parse と同じく WARN と WARNING の両方を受け付ける
const ALIASES: Record<string, Level> = {
  DEBUG: "DEBUG",
  INFO: "INFO",
  WARN: "WARNING",
  WARNING: "WARNING",
  ERROR: "ERROR",
  CRITICAL: "CRITICAL",
};

/**
 * レベルの文字列 (大文字・小文字を問わない) を Level に変換する。
 * 未知の値は `defaultLevel` に倒す (py-gn-log の level.parse と同じ。エラーにしない)。
 */
export function parseLevel(s: string, defaultLevel: Level = DEFAULT_LEVEL): Level {
  return ALIASES[s.trim().toUpperCase()] ?? defaultLevel;
}

/**
 * 環境変数 LOG_LEVEL からレベルを読む。未設定か空なら INFO、未知の値も INFO。
 */
export function levelFromEnv(env: Env = process.env): Level {
  const value = env[LOG_LEVEL_ENV_VAR];
  if (value === undefined || value === "") return DEFAULT_LEVEL;
  return parseLevel(value, DEFAULT_LEVEL);
}

/** 比較用の数値 (DEBUG=10, INFO=20, WARNING=30, ERROR=40, CRITICAL=50) */
export function levelValue(level: Level): number {
  return LEVEL_VALUES[level];
}

/** `level` が `threshold` 以上か (threshold と同じかそれより深刻か) */
export function isEnabled(level: Level, threshold: Level): boolean {
  return LEVEL_VALUES[level] >= LEVEL_VALUES[threshold];
}
