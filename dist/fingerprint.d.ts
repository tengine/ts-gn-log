/**
 * ERROR 以上のログを同種ごとにまとめる (dedup する) ための fingerprint (py-gn-log の gnlog.fingerprint と対)
 *
 * Cloud Error Reporting は severity=ERROR かつ stack_trace のあるログを自動でグループ化するが、
 * 例外を伴わない ERROR や、メッセージに可変部 (ID、件数、引用文字列) が多いエラーは
 * グループ化に頼れない。このモジュールは、メッセージの可変部を置き換えて正規化し、
 * 分類と組み合わせた短いハッシュを作る。
 *
 * 正規化とハッシュの規則そのものは、py-gn-log と値を揃えるための契約として設計案 §2 の
 * 3 番目が正本。
 *
 * 利用者に向けた挙動・制限・注意 (単一引用符の制限、両言語で値が一致しない条件である
 * 孤立サロゲート、入力の大きさについての注意) と、py-gn-log 側の正本、規則を変えるときの
 * 手順は、README の「ERROR のログを同種ごとにまとめる fingerprint」を参照。
 */
/** 正規化後のメッセージの最大長 (コードポイント数) */
export declare const MAX_MESSAGE_LENGTH = 300;
/** fingerprint の長さ (SHA-1 の 16 進表現の先頭から取る文字数) */
export declare const FINGERPRINT_LENGTH = 16;
export declare const UUID_PLACEHOLDER = "<uuid>";
export declare const STR_PLACEHOLDER = "<str>";
export declare const NUM_PLACEHOLDER = "<num>";
/**
 * メッセージの可変部を置き換えて正規化する。UUID を `<uuid>`、引用文字列を `<str>`、
 * 数値を `<num>` に置き換え、先頭 maxLength コードポイントに切り詰める。
 *
 * @example
 * normalizeMessage('order 123 for "alice" not found') // => 'order <num> for <str> not found'
 *
 * @param message 正規化するメッセージ。**大きさの上限は呼び出し側の責務**
 *   (README の「ERROR のログを同種ごとにまとめる fingerprint」を参照)
 * @param maxLength 切り詰めるコードポイント数。undefined なら既定の MAX_MESSAGE_LENGTH。
 *   それ以外は `Math.trunc` に通し、NaN は 0 にする (`Array.prototype.slice` と同じ意味論)。
 *   bigint と symbol は `Math.trunc` が TypeError を投げる (slice も同じ)。この扱いを散文で
 *   言い換えた記述はここ以外に置かない — 値ごとの結果は test/fingerprint.test.ts が
 *   TYPEOF_SPACE の表で検証する
 */
export declare function normalizeMessage(message: string, maxLength?: number): string;
/**
 * 同種のエラーで同じ値になる短いハッシュを作る。
 *
 * @param surface サービスやコンポーネントの名前 (例: "worker")。無ければ空文字
 * @param operation 操作名 (例: "orders.create")
 * @param errorType エラーの分類 (例: "validation", "infra")
 * @param message ログメッセージ。normalizeMessage で正規化してから使う。**大きさの上限は
 *   呼び出し側の責務** (README の「ERROR のログを同種ごとにまとめる fingerprint」を参照)
 * @returns `surface|operation|error_type|正規化したメッセージ` (各要素は `\` と `|` を escape 済み)
 *   の UTF-8 SHA-1 の 16 進表現の先頭 16 文字
 */
export declare function buildFingerprint(surface: string, operation: string, errorType: string, message: string): string;
