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
 *      (can't のようなアポストロフィは引用符とみなさない。閉じ引用符の直後は問わないので
 *      'bob's のような所有格も引用文字列として扱う)。
 *      限界: 単一引用符は引用の区切りとアポストロフィを同じ文字で兼ねるため、アポストロフィで
 *      始まる語 ('cause, '90s) や対になっていない単一引用符があると、そこから次の単一引用符
 *      までが `<str>` になる (別種のエラーが同じ fingerprint にまとまる)。厳密さが必要な
 *      メッセージでは二重引用符を使うこと
 *   3. 数値を `<num>` に置き換える。ASCII の数字の並びで、3 桁ごとのカンマ区切り・小数部・
 *      指数部を含めて 1 つの数値とし、前後は ASCII の単語境界で区切る
 *   4. 先頭 300 文字に切り詰める。単位は Unicode のコードポイント (py-gn-log #26 の案 1。
 *      Python の len() / スライスと同じ。JavaScript の .length / .slice() は UTF-16 コード単位
 *      なので使わない)
 *   5. surface / operation / error_type / 正規化したメッセージのそれぞれについて `\` を `\\` に、
 *      `|` を `\|` に escape してから `|` で連結し、UTF-8 の SHA-1 の 16 進表現の先頭 16 文字を
 *      fingerprint とする
 *
 * 契約の限界 (孤立サロゲート): JS 側で文字列を UTF-16 単位に切り詰めた結果 (例:
 * `"boom 😀".slice(0, 6)`) のように、対にならないサロゲートを含むメッセージでは両言語の値が
 * 揃わない。ts 側は Node の既定に従って U+FFFD に置き換えて値を返す (ログの呼び出しは投げない
 * 方針に合わせる) が、py 側は build_fingerprint が UnicodeEncodeError を投げる。それが
 * Formatter の中で起きるため、error_event を有効にしていると **その ERROR のログ行そのものが
 * 失われる** (error_event 無しなら同じメッセージが出力されるので、fingerprint の機能が行を
 * 落としている)。どちらに揃えるかは py-gn-log 側で決める (未決。py 側の行の欠落は
 * py-gn-log に報告する)。
 *
 * 入力の大きさ: 置換は入力の全体に走るので、この関数群は入力の大きさに比例したメモリを使う。
 * 数十 MB のメッセージでは Node のヒープを使い切り、catch できない fatal OOM でプロセスが
 * 落ちる (py-gn-log も同じ性質で、Python では MemoryError になる)。**入力の大きさの上限は
 * 呼び出し側の責務**とする — ログの経路では createLogger の errorEvent が上限を超えた
 * メッセージに fingerprint を付けない。直接呼ぶ場合は、呼び出し側でメッセージの長さを
 * 制限すること。
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
 * @param message 正規化するメッセージ。**大きさの上限は呼び出し側の責務** (置換が全体に走るので、
 *   数十 MB では fatal OOM でプロセスが落ちる)
 * @param maxLength 切り詰めるコードポイント数。非整数は `Array.prototype.slice` と同じく
 *   整数に丸める (NaN は 0)
 */
export declare function normalizeMessage(message: string, maxLength?: number): string;
/**
 * 同種のエラーで同じ値になる短いハッシュを作る。
 *
 * @param surface サービスやコンポーネントの名前 (例: "worker")。無ければ空文字
 * @param operation 操作名 (例: "orders.create")
 * @param errorType エラーの分類 (例: "validation", "infra")
 * @param message ログメッセージ。normalizeMessage で正規化してから使う。**大きさの上限は
 *   呼び出し側の責務** (上の「入力の大きさ」を参照)
 * @returns `surface|operation|error_type|正規化したメッセージ` (各要素は `\` と `|` を escape 済み)
 *   の UTF-8 SHA-1 の 16 進表現の先頭 16 文字
 */
export declare function buildFingerprint(surface: string, operation: string, errorType: string, message: string): string;
