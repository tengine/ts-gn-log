/**
 * リクエスト / タスク単位の文脈を全ログ行に付ける (py-gn-log の gnlog.context と対)
 *
 * `node:async_hooks` の AsyncLocalStorage に置いた値を、ロガーが出力時に読んでフィールドとして
 * 混ぜる。Next.js の Route Handler は Node の非同期文脈をそのまま通すので、リクエストごとの
 * 文脈を全 await 先まで運べる (Python の ContextVar と同じ位置づけ)。
 *
 * - `runWithContext(values, fn)`: fn の間だけ値を足す (py の `bind`)。抜けると元に戻る。入れ子は内側が勝つ
 * - `setContext(values)` / `clearContext()`: いちばん内側の runWithContext の範囲を更新する
 *   (py の `set` / `clear`)。runWithContext の外では使えない (エラー)
 * - `getContext()`: 現在の文脈
 *
 * 実装の要点: runWithContext が可変の入れ物を AsyncLocalStorage.run で張り、setContext /
 * clearContext はその入れ物を更新する。enterWith は使わない — enterWith は「今の同期実行の
 * 残り」にしか効かず、コールバックの中で呼ぶと消え、run の外で呼ぶとプロセス全体の既定に
 * なって無関係なリクエストに漏れるため。入れ物は範囲ごとに別なので、並行する流れや
 * 別のリクエストに漏れない。
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
function requireScope(fn) {
    const scope = storage.getStore();
    if (scope === undefined) {
        throw new Error(`${fn}() must be called inside runWithContext() (Route Handler なら withRequestTrace で囲う)`);
    }
    return scope;
}
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
    return storage.getStore()?.values ?? EMPTY;
}
/**
 * fn の間だけ文脈に値を足す。fn が返す Promise が終わるまで (await 先も含めて) 有効で、
 * 抜けると元の文脈に戻る。入れ子にでき、内側の値が同じキーを上書きする。
 *
 * @throws 予約キー (固定キーと同名) を含むとき
 */
export function runWithContext(values, fn) {
    validateKeys(values);
    const scope = { values: Object.freeze({ ...getContext(), ...values }) };
    return storage.run(scope, fn);
}
/**
 * いちばん内側の runWithContext の範囲に値を足す。その範囲が終わるまで (await 先、
 * コールバックの中も含めて) 残り、範囲を抜けると消える。runWithContext の外では使えない。
 *
 * @throws 予約キーを含むとき。runWithContext の外で呼んだとき
 */
export function setContext(values) {
    validateKeys(values);
    const scope = requireScope("setContext");
    scope.values = Object.freeze({ ...scope.values, ...values });
}
/**
 * いちばん内側の runWithContext の範囲の文脈をすべて消す。外側の runWithContext の値は、
 * その範囲に戻れば見える (外側の範囲は消さない)。runWithContext の外では使えない。
 *
 * @throws runWithContext の外で呼んだとき
 */
export function clearContext() {
    requireScope("clearContext").values = EMPTY;
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
