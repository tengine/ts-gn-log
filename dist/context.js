/**
 * リクエスト / タスク単位の文脈を全ログ行に付ける (py-gn-log の gnlog.context と対)
 *
 * `node:async_hooks` の AsyncLocalStorage に置いた値を、ロガーが出力時に読んでフィールドとして
 * 混ぜる。Next.js の Route Handler は Node の非同期文脈をそのまま通すので、リクエストごとの
 * 文脈を全 await 先まで運べる (Python の ContextVar と同じ位置づけ)。
 *
 * - `runWithContext(values, fn)`: fn の間だけ値を足す (py の `bind`)。抜けると元に戻る。入れ子は内側が勝つ
 * - `setContext(values)` / `clearContext()`: 現在の非同期の流れに残す (py の `set` / `clear`)
 * - `getContext()`: 現在の文脈
 *
 * キーは JSON 出力のキー名になる。py-gn-log の extra と同じく snake_case を推奨する。
 * 値が null / undefined のキーは出力されない (入れ子で外側の値を一時的に外すのに使える)。
 * `trace` キーは予約で、出力には混ぜない (`ts-gn-log/trace` が `{ traceId, spanId, sampled }`
 * の形で置き、`ts-gn-log/google/cloud-trace` が Cloud Logging のフィールドに変換して出す)。
 */
import { AsyncLocalStorage } from "node:async_hooks";
/** 文脈の `trace` キー。予約されていて出力には混ぜない */
export const TRACE_CONTEXT_KEY = "trace";
/**
 * 文脈に置けないキー。JSON 出力の固定キーと同名だと、文脈の値が固定の値に消されるか
 * 固定の値を壊すので、置いた時点でエラーにする (py-gn-log が LogRecord の属性名を拒むのと同じ)。
 */
export const RESERVED_CONTEXT_KEYS = new Set([
    "severity",
    "message",
    "timestamp",
    "name",
    "logging.googleapis.com/labels",
    "stack_trace",
    "error",
    "fields_error",
    "format_error",
    "err",
]);
const EMPTY = Object.freeze({});
const storage = new AsyncLocalStorage();
function validateKeys(values) {
    const reserved = Object.keys(values)
        .filter((k) => RESERVED_CONTEXT_KEYS.has(k))
        .sort();
    if (reserved.length > 0) {
        throw new Error(`Context keys conflict with log entry fields: ${JSON.stringify(reserved)}. Choose different key names.`);
    }
}
/** 現在の文脈。何も置かれていなければ空 */
export function getContext() {
    return storage.getStore() ?? EMPTY;
}
/**
 * fn の間だけ文脈に値を足す。fn が返す Promise が終わるまで (await 先も含めて) 有効で、
 * 抜けると元の文脈に戻る。入れ子にでき、内側の値が同じキーを上書きする。
 *
 * @throws 予約キー (固定キーと同名) を含むとき
 */
export function runWithContext(values, fn) {
    validateKeys(values);
    return storage.run(Object.freeze({ ...getContext(), ...values }), fn);
}
/**
 * 現在の非同期の流れの文脈に値を足す (runWithContext と違い、clearContext するか
 * その流れが終わるまで残る)。リクエストの開始時に置き、終了時に clearContext する使い方。
 * runWithContext の中で呼んだ場合は、その runWithContext の範囲に残る。
 *
 * @throws 予約キーを含むとき
 */
export function setContext(values) {
    validateKeys(values);
    storage.enterWith(Object.freeze({ ...getContext(), ...values }));
}
/** 現在の非同期の流れの文脈をすべて消す */
export function clearContext() {
    storage.enterWith(EMPTY);
}
/**
 * 出力に混ぜるフィールドとしての文脈。予約の `trace` と、値が null / undefined のキーを除く。
 */
export function contextFields(context = getContext()) {
    const out = {};
    for (const [key, value] of Object.entries(context)) {
        if (key === TRACE_CONTEXT_KEY)
            continue;
        if (value === null || value === undefined)
            continue;
        out[key] = value;
    }
    return out;
}
