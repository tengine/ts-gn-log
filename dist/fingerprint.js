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
 * **この 2 つの限界 (孤立サロゲート・入力の大きさ) の正本はこの docstring。** README の
 * 「ERROR のログを同種ごとにまとめる fingerprint」は要約で、詳しい条件はここを見る。
 *
 * 契約の限界 (孤立サロゲート): 孤立サロゲート (対にならないサロゲート。JS 側で文字列を
 * UTF-16 単位に切り詰めた結果 — 例: `"boom 😀".slice(0, 6)` — に現れる) は UTF-8 に
 * エンコードできない。ts 側は Node の既定に従って U+FFFD に置き換えて値を返す (ログの
 * 呼び出しは投げない方針に合わせる)。py-gn-log と値が一致するかは、孤立サロゲートが
 * 正規化と切り詰めの後にも残る位置にあるかで決まる — 切り詰めで落ちる位置にあれば影響せず、
 * 値は一致する。残る位置にあると、py 側は UTF-8 にエンコードできない文字列を扱うことになり、
 * ts と同じ fingerprint が得られるとは限らない。**py 側で何が起きるか (例外になるか、ログの
 * 行が残るか) を前提にしない**こと — 形式・設定・出力先によって変わる。条件の一覧と扱いの
 * 決定は py-gn-log #34 に委ねる (未決)。呼び出す前に ts 側でメッセージを切り詰めるなら、
 * コードポイント単位で行うこと (UTF-16 コード単位で切ると孤立サロゲートを作る)。
 *
 * 入力の大きさ: 置換は入力の全体に走るので、この関数群は入力の大きさに比例したメモリを使う
 * (py-gn-log の fingerprint.py も同じ構造で、3 つの sub を全体にかけてから切り詰める。
 * 上限をどこの責務にするかは py-gn-log #35 で未決)。
 * 落ちるかどうかはヒープの大きさと置換でどれだけ膨らむか次第で、実測ではヒープを 512MB に
 * 制限した環境で 40MB の数値を多く含むメッセージが catch できない fatal OOM になり、既定の
 * ヒープ (約 4GB) では 40MB は通って 250MB 相当で落ちた。**入力の大きさの上限は呼び出し側の
 * 責務**とする — ログの経路での上限は PR 7 の createLogger の errorEvent で実装する。値と挙動の
 * 正本は設計案 §2 の (5) (この PR の時点では未実装)。それまでと、直接呼ぶ
 * 場合は、呼び出し側でメッセージの長さを制限すること。
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
 *
 * @param message 正規化するメッセージ。**大きさの上限は呼び出し側の責務** (置換が全体に走る。
 *   どれだけの大きさで落ちるかはこのモジュールの docstring 「入力の大きさ」が正本)
 * @param maxLength 切り詰めるコードポイント数。undefined なら既定の MAX_MESSAGE_LENGTH。
 *   それ以外は `Math.trunc` に通し、NaN は 0 にする (`Array.prototype.slice` と同じ意味論)。
 *   bigint と symbol は `Math.trunc` が TypeError を投げる (slice も同じ)。この扱いを散文で
 *   言い換えた記述はここ以外に置かない — 値ごとの結果は test/fingerprint.test.ts が
 *   TYPEOF_SPACE の表で検証する
 */
export function normalizeMessage(message, maxLength = MAX_MESSAGE_LENGTH) {
    const normalized = message
        .replace(UUID_PATTERN, UUID_PLACEHOLDER)
        .replace(QUOTED_PATTERN, STR_PLACEHOLDER)
        .replace(NUMBER_PATTERN, NUM_PLACEHOLDER);
    return truncateCodePoints(normalized, maxLength);
}
/**
 * 先頭 maxLength コードポイントに切り詰める (サロゲートペアを分断しない)。
 * 負の maxLength は Python の `s[:negative]` と同じく末尾から削る。
 *
 * 切り詰めの段階で入力を配列に展開しない — `Array.from` に通すと、ここでも入力の大きさに
 * 比例したメモリを使う。UTF-16 コード単位の数はコードポイント数以上なので、まず `s.length` で
 * 切り詰めが要るかを判定し、要るときだけ必要な分を走査する。置換の段階では依然として入力の
 * 全体を走るので、モジュールの docstring の「入力の大きさ」の前提は変わらない。
 */
function truncateCodePoints(s, maxLength) {
    // maxLength の値ごとの扱いは normalizeMessage の @param が正本。ここでは丸めの順序だけ:
    // Math.trunc を先に通す — Number.isNaN は型を見るので、非数値 ('abc' や {}) を先に
    // 判定しても false になり、Math.trunc の NaN が残る。丸めずに走査の終了判定に使うと
    // 切り詰めが効かなくなる (入力全体が返る)
    const truncated = Math.trunc(maxLength);
    const limit = Number.isNaN(truncated) ? 0 : truncated;
    if (limit >= 0 && s.length <= limit)
        return s;
    let keep = limit;
    if (limit < 0) {
        // 末尾から削るには全体のコードポイント数が要る。数え上げも配列を作らずに行う
        let total = 0;
        for (const _ch of s)
            total += 1;
        keep = total + limit;
    }
    if (keep <= 0)
        return "";
    let out = "";
    let count = 0;
    for (const ch of s) {
        if (count >= keep)
            break;
        out += ch;
        count += 1;
    }
    return out;
}
/** 連結の区切り文字 `|` が値に含まれていても区切りと区別できるように escape する */
function escapeComponent(value) {
    return value.replaceAll("\\", "\\\\").replaceAll("|", "\\|");
}
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
export function buildFingerprint(surface, operation, errorType, message) {
    const components = [surface, operation, errorType, normalizeMessage(message)];
    const source = components.map(escapeComponent).join("|");
    return createHash("sha1").update(source, "utf8").digest("hex").slice(0, FINGERPRINT_LENGTH);
}
