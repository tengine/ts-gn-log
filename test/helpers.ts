import type { Level, Writer } from "../src/index.js";

/** Writer を差し替えて出力を配列に集める */
export function collect(): { lines: Array<{ level: Level; line: string }>; write: Writer } {
  const lines: Array<{ level: Level; line: string }> = [];
  return { lines, write: (level, line) => lines.push({ level, line }) };
}

export const FIXED_TIME = new Date("2026-09-09T01:23:45.678Z");

/**
 * 引数の値の空間。typeof の 8 種で尽くし、object は null・配列・それ以外 (class のインスタンスで
 * 代表) に分けた 11 通り。object の下位 (Date や Map など) を分ける必要が出たら行を足す。
 * 値の分割 (どの値を受け付け、どの値を弾くか) を検証するテストは、この表に期待値を並べて
 * it.each で題を生成する。分類の語 (「オブジェクト以外」「プリミティブ」) を題に手で書かない。
 * function と class instance は列挙可能なプロパティ `a` を持たせ、受け付けられたかどうかを
 * 出力の `a` で判別できるようにしている。
 */
export const TYPEOF_SPACE = {
  undefined: undefined,
  null: null,
  boolean: true,
  number: 1,
  bigint: 1n,
  string: "s",
  symbol: Symbol("s"),
  function: Object.assign(() => 1, { a: 1 }),
  array: ["a"],
  "plain object": { a: 1 },
  "class instance": new (class Point {
    a = 1;
  })(),
} as const;
export type TypeofName = keyof typeof TYPEOF_SPACE;

/**
 * 期待値の表から it.each の行 [名前, 期待, 値] を作る。`Record<TypeofName, E>` なので、
 * TYPEOF_SPACE に値を足すと期待値を書いていないテストが typecheck で落ちる
 */
export function typeofRows<E extends string>(
  expectation: Record<TypeofName, E>,
): Array<[TypeofName, E, unknown]> {
  return (Object.keys(TYPEOF_SPACE) as TypeofName[]).map((n) => [
    n,
    expectation[n],
    TYPEOF_SPACE[n],
  ]);
}
