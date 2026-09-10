/**
 * ERROR 以上のログを同種ごとにまとめる (dedup する) ための fingerprint (py-gn-log の gnlog.fingerprint と対)
 *
 * Cloud Error Reporting は severity=ERROR かつ stack_trace のあるログを自動でグループ化するが、
 * 例外を伴わない ERROR や、メッセージに可変部 (ID、件数、引用文字列) が多いエラーは
 * グループ化に頼れない。このモジュールは、メッセージの可変部を置き換えて正規化し、
 * 分類と組み合わせた短いハッシュを作る。
 *
 * 正規化とハッシュの規則は py-gn-log と値を揃えるための契約 (設計案 §2 の 3 番目)。
 * 正本は py-gn-log の README「fingerprint の規則 (他言語の実装との契約)」と
 * src/gnlog/fingerprint.py。規則を変えるときは両方をあわせて変える。
 *
 * 規則:
 *   1. UUID (8-4-4-4-12 の 16 進数、大文字小文字を問わない) を `<uuid>` に置き換える
 *   2. 引用文字列 (改行を含まない) を `<str>` に置き換える。二重引用符で囲まれたもの、または
 *      単一引用符で囲まれたもののうち開き引用符の直前が ASCII の英数字・下線でないもの
 *      (can't のようなアポストロフィは引用符とみなさない。閉じ引用符の直後は問わない)
 *   3. 数値を `<num>` に置き換える。ASCII の数字の並びで、3 桁ごとのカンマ区切り・小数部・
 *      指数部を含めて 1 つの数値とし、前後は ASCII の単語境界で区切る
 *   4. 先頭 300 文字に切り詰める。単位は Unicode のコードポイント (py-gn-log #26 の案 1。
 *      Python の len() / スライスと同じ。JavaScript の .length / .slice() は UTF-16 コード単位
 *      なので使わない)
 *   5. surface / operation / error_type / 正規化したメッセージのそれぞれについて `\` を `\\` に、
 *      `|` を `\|` に escape してから `|` で連結し、UTF-8 の SHA-1 の 16 進表現の先頭 16 文字を
 *      fingerprint とする
 */

import { createHash } from "node:crypto";

/** 正規化後のメッセージの最大長 (コードポイント数) */
export const MAX_MESSAGE_LENGTH = 300;

/** fingerprint の長さ (SHA-1 の 16 進表現の先頭から取る文字数) */
export const FINGERPRINT_LENGTH = 16;

export const UUID_PLACEHOLDER = "<uuid>";
export const STR_PLACEHOLDER = "<str>";
export const NUM_PLACEHOLDER = "<num>";

// 置き換えの規則。適用順が結果に影響するため、この順序を変えないこと
// (UUID は数値を含むため先に置き換える。引用文字列の中の数値も <str> にまとめる)。
// 正規表現は py-gn-log の fingerprint.py と同じ意味になるように書く。`\b` と `\d` は
// JavaScript では ASCII の意味 (Python 側は re.ASCII で揃えている)。
const UUID_PATTERN = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
// 単一引用符は、開き引用符の直前が英数字・下線でないときだけ引用文字列の開始とみなす
// (can't / won't のようなアポストロフィを引用符と誤認しないため)。閉じ引用符側は制限しない
// ('bob's のような所有格を引用文字列として扱えるようにするため)
const QUOTED_PATTERN = /"[^"\n]*"|(?<![0-9A-Za-z_])'[^'\n]*'/g;
// 数値は桁区切りのカンマ・小数部・指数部を含めて 1 つにまとめる
const NUMBER_PATTERN = /\b\d+(?:,\d{3})*(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g;

/**
 * メッセージの可変部を置き換えて正規化する。UUID を `<uuid>`、引用文字列を `<str>`、
 * 数値を `<num>` に置き換え、先頭 maxLength コードポイントに切り詰める。
 *
 * @example
 * normalizeMessage('order 123 for "alice" not found') // => 'order <num> for <str> not found'
 */
export function normalizeMessage(message: string, maxLength: number = MAX_MESSAGE_LENGTH): string {
  const normalized = message
    .replace(UUID_PATTERN, UUID_PLACEHOLDER)
    .replace(QUOTED_PATTERN, STR_PLACEHOLDER)
    .replace(NUMBER_PATTERN, NUM_PLACEHOLDER);
  return truncateCodePoints(normalized, maxLength);
}

/** 先頭 maxLength コードポイントに切り詰める (サロゲートペアを分断しない) */
function truncateCodePoints(s: string, maxLength: number): string {
  const chars = Array.from(s);
  return chars.length <= maxLength ? s : chars.slice(0, maxLength).join("");
}

/** 連結の区切り文字 `|` が値に含まれていても区切りと区別できるように escape する */
function escapeComponent(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("|", "\\|");
}

/**
 * 同種のエラーで同じ値になる短いハッシュを作る。
 *
 * @param surface サービスやコンポーネントの名前 (例: "worker")。無ければ空文字
 * @param operation 操作名 (例: "orders.create")
 * @param errorType エラーの分類 (例: "validation", "infra")
 * @param message ログメッセージ。normalizeMessage で正規化してから使う
 * @returns `surface|operation|error_type|正規化したメッセージ` (各要素は `\` と `|` を escape 済み)
 *   の UTF-8 SHA-1 の 16 進表現の先頭 16 文字
 */
export function buildFingerprint(
  surface: string,
  operation: string,
  errorType: string,
  message: string,
): string {
  const components = [surface, operation, errorType, normalizeMessage(message)];
  const source = components.map(escapeComponent).join("|");
  return createHash("sha1").update(source, "utf8").digest("hex").slice(0, FINGERPRINT_LENGTH);
}
