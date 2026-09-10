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
export function useJsonOutput(json, defaultValue = false, env = process.env) {
    if (json !== undefined)
        return json;
    const value = env[GNLOG_FORMAT_ENV_VAR];
    if (value === undefined || value === "") {
        return typeof defaultValue === "function" ? defaultValue() : defaultValue;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === GNLOG_FORMAT_JSON)
        return true;
    if (normalized === GNLOG_FORMAT_TEXT)
        return false;
    throw new Error(`Invalid value ${JSON.stringify(value)} for environment variable ${GNLOG_FORMAT_ENV_VAR}: ` +
        `expected ${JSON.stringify(GNLOG_FORMAT_JSON)} or ${JSON.stringify(GNLOG_FORMAT_TEXT)}`);
}
import { isEnabled } from "./level.js";
/**
 * severity が ERROR 以上なら stderr、それ以外は stdout に 1 行書く。
 * `console` を経由しない (Next.js の console パッチや色付けの影響を受けないため)。
 * Cloud Run は stdout / stderr の両方を取り込む。
 */
export const writeToStdio = (level, line) => {
    const stream = isEnabled(level, "ERROR") ? process.stderr : process.stdout;
    stream.write(`${line}\n`);
};
/**
 * Logger の核。整形 (Formatter) と書き出し (Writer) を差し替えられる。
 * provider ごとの入口 (`ts-gn-log/google/cloud-run` の `createLogger`) がこれを組み合わせる。
 */
export function createCoreLogger(options) {
    const { name, level, format } = options;
    const write = options.write ?? writeToStdio;
    const now = options.now ?? (() => new Date());
    const make = (baseFields) => {
        const emit = (recordLevel, message, fields) => {
            if (!isEnabled(recordLevel, level))
                return;
            const { err, ...rest } = fields ?? {};
            const record = {
                name,
                level: recordLevel,
                message,
                timestamp: now(),
                fields: { ...baseFields, ...rest },
            };
            if (fields !== undefined && "err" in fields)
                record.err = err;
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
/**
 * `err` をログに載せる文字列にする。Error なら stack (無ければ `name: message`)、
 * それ以外 (文字列 / unknown) は文字列にする。`message` は変えない。
 */
export function describeError(err) {
    if (err instanceof Error) {
        return err.stack ?? `${err.name}: ${err.message}`;
    }
    if (typeof err === "string")
        return err;
    try {
        return JSON.stringify(err) ?? String(err);
    }
    catch {
        return String(err);
    }
}
/**
 * ローカル (Cloud Run 外) 向けの、人が読む text 形式。
 * `2026-09-09T01:23:45.678Z INFO     bff  message  {"site":"a"}` の 1 行に、`err` があれば
 * 次の行以降にその文字列 (Error なら stack) を続ける。書式は固定で、py-gn-log の
 * LOG_FORMAT のような書式文字列は持たない。
 */
export const textFormat = (record) => {
    let line = `${record.timestamp.toISOString()} ${record.level.padEnd(8)} ${record.name}  ${record.message}`;
    if (Object.keys(record.fields).length > 0) {
        line += `  ${JSON.stringify(record.fields)}`;
    }
    if ("err" in record) {
        line += `\n${describeError(record.err)}`;
    }
    return line;
};
