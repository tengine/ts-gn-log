import { readFileSync } from "node:fs";
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

const DOCS = ["README.md", "CLAUDE.md", "docs/designs/0001-ts-gn-log-design.md"] as const;
const SOURCES = [...DOCS, "src/fingerprint.ts", "src/context.ts", "src/level.ts"] as const;

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

/**
 * GitHub の見出しの slug。記号を先に除いてから空白を - にすると、`+` のように
 * 前後に空白を伴う記号が 1 つの - に縮み、実際の slug (-- になる) と食い違う。
 * GitHub と同じ順序で、記号の除去 → 空白の置換を行う
 */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s\-ぁ-んァ-ヶ一-龠ー]/g, "")
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
        readFileSync(new URL(`../${base}${p}`, import.meta.url));
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
    for (const m of text.matchAll(/\]\(([^)]+)#([^)]+)\)/g)) {
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
  // Issue の状態はこのリポジトリの関門では確かめられない。番号だけを書き、状態は書かない
  const STATE_WORDS = /#\d+\s*(で未決|で提案中|に出す|が合意|で合意|は未決|でクローズ|で完了)/;

  it.each(SOURCES)("%s が外部 Issue の状態を述べていない", (path) => {
    const hits = read(path)
      .split("\n")
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => STATE_WORDS.test(line))
      .map(({ line, n }) => `${path}:${n} ${line.trim().slice(0, 60)}`);
    expect(hits).toEqual([]);
  });
});

describe("語彙の規約", () => {
  // 正本は ~/.claude/CLAUDE.md の「避ける言い回しと言い換えの例」。
  // 表にあるもののうち、機械で拾える字面だけを検査する
  const BANNED = ["黙って", "素通り", "に化ける", "穴を塞", "全緑", "変異を落と", "規則に抵触"];

  it.each(SOURCES)("%s が避ける言い回しを使っていない", (path) => {
    const text = read(path);
    const hits = BANNED.filter((w) => text.includes(w));
    expect(hits).toEqual([]);
  });
});
