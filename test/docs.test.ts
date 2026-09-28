import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 文書の参照を機械で検査する。
 *
 * レビューの周回で、散文の 1 文が一致を保つべき相手 (別の文書のリンク先・見出しの名前・
 * 外部 Issue の状態) が食い違う指摘が繰り返し出た。人が守る手順を足す形では、条項が
 * 名指さなかった隣で破れ続けたので、機械で守れるものはここで守る。
 *
 * 守れないもの (実装の挙動と散文の一致、両言語の値の一致) は別の検査が持つ —
 * 前者は各 docstring が式を引用する形、後者は test/fixtures/fingerprint-golden.json。
 */

const REPO = new URL("..", import.meta.url);

/**
 * 過去の記録の置き場。当時の検討・計画をその時点のまま残す文書なので、現行の文書との
 * 一致を求めない — 書かれた時点では正しい記述が、現行の文書が変わると食い違って見える。
 *
 * この一覧は他の設定の写しではなく、ここで独立に決める。同じ趣旨の設定を持つ道具は
 * あるが、その設定ファイルは .gitignore 済みで CI には無いので、読みに行くと環境に
 * よって検査の対象が変わる。道具の側の範囲を変えても、ここは追随しない。
 *
 * この除外は、下の検査すべてを対象の文書から外す。除いた文書に何が書かれていても
 * 失敗しないので、除く範囲は狭く保つ
 */
const FROZEN = ["docs/plans/"];

/**
 * 検査する Markdown。git が追跡しているものから集める。ファイル名で列挙すると、
 * 足した文書が検査を受けないまま残る (計画書が 1 件、対象から漏れていた)。
 * 走査の境界を作業ツリーではなく git の追跡に置くのは、tmp/ と docs/review-triages/ の
 * .md が無視されている一時物・作業環境ごとの記録で、検査の対象ではないため
 */
const DOCS = execFileSync("git", ["ls-files", "-z", "*.md"], { cwd: REPO, encoding: "utf8" })
  .split("\0")
  .filter((path) => path !== "" && !FROZEN.some((dir) => path.startsWith(dir)))
  .sort();

/**
 * ディレクトリの下の `.ts` を集める。対象をファイル名で列挙すると、足したファイルが
 * 検査を受けないまま残る (src の 9 ファイルのうち 3 つしか対象になっていなかった)
 */
function tsFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...tsFilesUnder(path));
    else if (entry.name.endsWith(".ts")) found.push(path);
  }
  return found.sort();
}

const SOURCES = [...DOCS, ...tsFilesUnder("src"), ...tsFilesUnder("test")];

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

/**
 * このファイル自身も SOURCES に入るので、探す語を並べた定義がその語に一致する。
 * 定義を下の印で挟み、探すときはその間を除く。ファイルごと対象から外すと、
 * ここに書いた散文とコメントが検査を受けなくなるので、挟む形にする
 */
const SKIP_BEGIN = "検査の定義 (ここから)";
const SKIP_END = "検査の定義 (ここまで)";

function linesToSearch(path: string): { line: string; n: number }[] {
  let skipping = false;
  return read(path)
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => {
      if (line.includes(SKIP_BEGIN)) skipping = true;
      else if (line.includes(SKIP_END)) skipping = false;
      else return !skipping;
      return false;
    });
}

/**
 * GitHub の見出しの slug。記号を先に除いてから空白を - にすると、`+` のように
 * 前後に空白を伴う記号が 1 つの - に縮み、実際の slug (-- になる) と食い違う。
 * GitHub と同じ順序で、記号の除去 → 空白の置換を行う。
 *
 * 除く側を書く。残す側 (日本語で使う文字の範囲) を列挙すると、列挙に入れ忘れた
 * 文字が除かれる — 々 や 〆、U+9FA0 を超える漢字、全角英数が GitHub では残るのに
 * 落ちていた。除く側を書けば、列挙に無い文字は残る方に倒れる。
 * \p{L} は文字、\p{N} は数字、\p{M} は結合文字 (濁点など) で、GitHub はこれらと
 * アンダースコア・ハイフン・空白を残す
 */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, "")
    .replace(/\s/g, "-");
}

describe("文書の相対リンク", () => {
  it.each(DOCS)("%s のリンク先のファイルが実在する", (doc) => {
    const links = [...read(doc).matchAll(/\]\(([^)]+)\)/g)]
      .map((m) => m[1] ?? "")
      .filter((l) => l !== "" && !l.startsWith("http"))
      .map((l) => l.split("#")[0] ?? "")
      .filter((p) => p !== "");
    const missing = links.filter((p) => {
      const base = doc.includes("/") ? `${doc.split("/").slice(0, -1).join("/")}/` : "";
      try {
        // statSync はディレクトリでも成功する。readFileSync だと置き場を案内するリンク
        // (docs/designs/ など) が EISDIR で「実在しない」と報告される
        statSync(new URL(`../${base}${p}`, import.meta.url));
        return false;
      } catch {
        return true;
      }
    });
    expect(missing).toEqual([]);
  });

  it.each(DOCS)("%s のリンクのアンカーが見出しに対応する", (doc) => {
    const text = read(doc);
    const bad: string[] = [];
    // パスの側を 0 文字から拾う。1 文字以上を要求すると、同一文書内へのリンク
    // ([x](#anchor)) がこの検査にも実在の検査にも掛からない
    for (const m of text.matchAll(/\]\(([^)]*)#([^)]+)\)/g)) {
      const path = m[1] ?? "";
      const anchor = m[2] ?? "";
      if (path.startsWith("http")) continue;
      const base = doc.includes("/") ? `${doc.split("/").slice(0, -1).join("/")}/` : "";
      const target = path === "" ? doc : `${base}${path}`;
      const heads = [...read(target).matchAll(/^#+\s+(.+)$/gm)].map((h) => slug(h[1] ?? ""));
      if (!heads.includes(anchor)) bad.push(`${doc} -> ${path}#${anchor}`);
    }
    expect(bad).toEqual([]);
  });
});

describe("外部 Issue の参照", () => {
  // Issue の状態はこのリポジトリの関門では確かめられない。番号だけを書き、状態は書かない。
  // 状態を述べる語は書き手が選ぶので、この一覧が尽くすことはない — 足すときは、
  // 現在の文書がその語で状態を書いていないことも確かめる
  // 検査の定義 (ここから)
  const STATE_WORDS =
    /#\d+\s*(で未決|で提案中|に出す|が合意|で合意|は未決|でクローズ|で完了)|(マージ済み|レビュー中|クローズ済み|対応済み|着手済み)/;
  // 検査の定義 (ここまで)

  it.each(SOURCES)("%s が外部 Issue の状態を述べていない", (path) => {
    const hits = linesToSearch(path)
      .filter(({ line }) => STATE_WORDS.test(line))
      .map(({ line, n }) => `${path}:${n} ${line.trim().slice(0, 60)}`);
    expect(hits).toEqual([]);
  });
});

describe("語彙の規約", () => {
  /**
   * 正本は ~/.claude/CLAUDE.md の「避ける言い回しと言い換えの例」。正本の表は
   * 「この表は例であって、列挙で網羅するものではない」と断っているので、この一覧が
   * 規約を尽くすことはない。逐語で写せる範囲 — 表の行に並記された言い回しと、表が
   * 同義語として名指しているもの — だけを拾う。
   *
   * 「テストで固定する」「同じ型の欠陥」は表にあるが入れない。機械で拾うと通常の
   * 日本語 (「固定」「同じ型」) に一致する範囲が広すぎる
   */
  // 検査の定義 (ここから)
  const BANNED = [
    "黙って",
    "素通り",
    "すり抜け",
    "見逃",
    "に化ける",
    "穴を塞",
    "全緑",
    "赤になる",
    "変異を落と",
    "変異が生き残",
    "規則に抵触",
  ];
  // 検査の定義 (ここまで)

  it.each(SOURCES)("%s が避ける言い回しを使っていない", (path) => {
    const text = linesToSearch(path)
      .map(({ line }) => line)
      .join("\n");
    const hits = BANNED.filter((w) => text.includes(w));
    expect(hits).toEqual([]);
  });
});
