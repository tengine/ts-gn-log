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

export type Context = Readonly<Record<string, unknown>>;

/** 文脈の `trace` キー。予約されていて出力には混ぜない */
export const TRACE_CONTEXT_KEY = "trace";

/**
 * 文脈に置けないキー (JSON 出力の固定キー)。同名だと文脈の値が固定の値に消されるか固定の
 * 値を壊すので、型で弾き (ContextFields)、型で分からない動的な値は置いた時点でエラーにする
 * (py-gn-log が LogRecord の属性名を拒むのと同じ)。trace のフィールド
 * (logging.googleapis.com/trace 等) は文脈の予約キー trace から provider の Formatter が組む
 * ので、利用側が置く必要は無い。
 */
export type ReservedContextKey =
  | "severity"
  | "message"
  | "timestamp"
  | "name"
  | "logging.googleapis.com/labels"
  | "logging.googleapis.com/trace"
  | "logging.googleapis.com/spanId"
  | "logging.googleapis.com/trace_sampled"
  | "stack_trace"
  | "error"
  | "fields_error"
  | "format_error"
  | "err";

/**
 * 文脈に置くフィールドの型。予約キーをリテラルで書いたり、固定キーを持つ型の値
 * (`logFields()` の返り値など) を渡したりすると型エラーになる。`Record<string, unknown>` の
 * ような動的な値は通り、実行時の検査 (RESERVED_CONTEXT_KEYS) に掛かる。
 */
export type ContextFields = { [key: string]: unknown } & { [K in ReservedContextKey]?: never };

const RESERVED_LIST: readonly ReservedContextKey[] = [
  "severity",
  "message",
  "timestamp",
  "name",
  "logging.googleapis.com/labels",
  "logging.googleapis.com/trace",
  "logging.googleapis.com/spanId",
  "logging.googleapis.com/trace_sampled",
  "stack_trace",
  "error",
  "fields_error",
  "format_error",
  "err",
];

/** 実行時の検査に使う予約キーの集合 (ReservedContextKey と同じ内容) */
export const RESERVED_CONTEXT_KEYS: ReadonlySet<string> = new Set(RESERVED_LIST);

const EMPTY: Context = Object.freeze({});

/** runWithContext の範囲ごとの入れ物。setContext / clearContext が values を差し替える */
interface Scope {
  values: Context;
}

const storage = new AsyncLocalStorage<Scope>();

function requireScope(fn: string): Scope {
  const scope = storage.getStore();
  if (scope === undefined) {
    throw new Error(
      `${fn}() must be called inside runWithContext() (Route Handler なら withRequestTrace で囲う)`,
    );
  }
  return scope;
}

function validateKeys(values: Record<string, unknown>): void {
  const reserved = Object.keys(values)
    .filter((k) => RESERVED_CONTEXT_KEYS.has(k))
    .sort();
  if (reserved.length > 0) {
    throw new Error(
      `Context keys conflict with log entry fields: ${JSON.stringify(reserved)}. Choose different key names ` +
        "(trace fields such as logging.googleapis.com/trace are derived automatically from the reserved `trace` key).",
    );
  }
}

/**
 * 動的な値 (利用側の関数の返り値など) を、予約キーを落として ContextFields にする。
 * `typeof value !== "object" || value === null || Array.isArray(value)` なら undefined
 * (投げない)。この判定を散文で言い換えた記述はここ以外に置かない — 受け付ける値の一覧は
 * test/context-types.test.ts が TYPEOF_SPACE の表で検証する。利用側の関数を境界で
 * 受ける側 (withRequestTrace など) が使う。runWithContext / setContext の直接呼び出しは
 * 型で弾き、動的な値は実行時のエラーで知らせる (こちらは投げてよい)。
 */
export function normalizeContextFields(value: unknown): ContextFields | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  let keys: string[];
  try {
    keys = Object.keys(value);
  } catch {
    return undefined; // ownKeys が投げる Proxy など
  }
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (RESERVED_CONTEXT_KEYS.has(key)) continue;
    // getter はキーごとに読む。投げる getter はそのキーだけ落とす (Object.entries だと全部を一度に評価する)
    try {
      out[key] = (value as Record<string, unknown>)[key];
    } catch {
      // このキーだけ落とす
    }
  }
  return out as ContextFields;
}

/** 現在の文脈。何も置かれていなければ空 */
export function getContext(): Context {
  return storage.getStore()?.values ?? EMPTY;
}

/**
 * fn の間だけ文脈に値を足す。fn が返す Promise が終わるまで (await 先も含めて) 有効で、
 * 抜けると元の文脈に戻る。入れ子にでき、内側の値が同じキーを上書きする。
 * fn の戻り値はそのまま返し、Promise を観測しない (then を付けると呼び出し元が握らなかった
 * reject を処理済みにしてしまい、派生を返すと二重に報告されるため)。範囲の中で始めて
 * await し忘れた処理からの setContext は、範囲の終了後は誰にも読まれない (誤用の範囲)。
 *
 * @throws 予約キー (固定キーと同名) を含むとき
 */
export function runWithContext<T>(values: ContextFields, fn: () => T): T {
  validateKeys(values);
  const scope: Scope = { values: Object.freeze({ ...getContext(), ...values }) };
  return storage.run(scope, fn);
}

/**
 * いちばん内側の runWithContext の範囲に値を足す。その範囲が終わるまで (await 先、
 * コールバックの中も含めて) 残り、範囲を抜けると消える。runWithContext の外では使えない。
 *
 * @throws 予約キーを含むとき。runWithContext の外で呼んだとき
 */
export function setContext(values: ContextFields): void {
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
export function clearContext(): void {
  requireScope("clearContext").values = EMPTY;
}

/**
 * 出力に混ぜるフィールドとしての文脈。予約の `trace` と、値が null / undefined のキーを除く。
 */
export function contextFields(context: Context = getContext()): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (key === TRACE_CONTEXT_KEY) continue;
    if (value === null || value === undefined) continue;
    out[key] = value;
  }
  return out;
}
