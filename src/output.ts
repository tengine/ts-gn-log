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
