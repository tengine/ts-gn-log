import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildFingerprint, normalizeMessage } from "../src/fingerprint.js";

const sha1 = (s: string) => createHash("sha1").update(s, "utf8").digest("hex").slice(0, 16);

describe("normalizeMessage (py-gn-log の test_fingerprint.py と同じ事例)", () => {
  it.each([
    ["order 123 not found", "order <num> not found"],
    ["ratio 0.75 exceeded", "ratio <num> exceeded"],
    ['user "alice" missing', "user <str> missing"],
    ["user 'bob' missing", "user <str> missing"],
    ["id 3f2504e0-4f89-11d3-9a0c-0305e82c3301 gone", "id <uuid> gone"],
    ["id 3F2504E0-4F89-11D3-9A0C-0305E82C3301 gone", "id <uuid> gone"],
    ['code "E123"', "code <str>"],
    ["table t1 locked", "table t1 locked"],
    ["no variable parts", "no variable parts"],
    ["can't connect to database, won't retry", "can't connect to database, won't retry"],
    ["user 'bob' can't login", "user <str> can't login"],
    ["it's 'quoted'.", "it's <str>."],
    ["user 'bob's account is locked", "user <str>s account is locked"],
    ["count 1,234 rows", "count <num> rows"],
    ["count 9,876,543 rows", "count <num> rows"],
    ["timeout after 1.5e10 ns", "timeout after <num> ns"],
    ["tolerance 2E-3 exceeded", "tolerance <num> exceeded"],
  ])("%j → %j", (message, expected) => {
    expect(normalizeMessage(message)).toBe(expected);
  });

  it("先頭 300 文字に切り詰める", () => {
    expect(normalizeMessage("x".repeat(500))).toHaveLength(300);
  });

  it("置き換えを行ってから切り詰める", () => {
    expect(normalizeMessage(`${"a".repeat(298)} 12345`)).toBe(`${"a".repeat(298)} <`);
  });

  it("maxLength を指定できる", () => {
    expect(normalizeMessage("abcdef", 3)).toBe("abc");
    expect(normalizeMessage("abcdef", 0)).toBe("");
    expect(normalizeMessage("", 0)).toBe("");
    expect(normalizeMessage("abc", 10)).toBe("abc");
  });

  it("負の maxLength は末尾から削る (Python の s[:negative] と同じ)", () => {
    expect(normalizeMessage("abcdef", -2)).toBe("abcd");
    expect(normalizeMessage("abcdef", -1)).toBe("abcde");
    expect(normalizeMessage("a😀b😀c", -2)).toBe("a😀b");
    expect(normalizeMessage("ab", -5)).toBe("");
  });

  it("非整数の maxLength は Array.prototype.slice と同じく整数に丸める (NaN は 0)", () => {
    for (const n of [2.5, -2.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(normalizeMessage("abcdef", n)).toBe(Array.from("abcdef").slice(0, n).join(""));
    }
    expect(normalizeMessage("abcdef", 2.5)).toBe("ab");
    expect(normalizeMessage("abcdef", Number.NaN)).toBe("");
  });

  it("巨大なメッセージ (10MB) でも配列に展開せず切り詰める", () => {
    const big = "x".repeat(10 * 1024 * 1024);
    expect(Array.from(normalizeMessage(big))).toHaveLength(300);
  });

  it("切り詰めの単位はコードポイント (BMP 外の文字を分断しない。py-gn-log #26 の案 1)", () => {
    const msg = `${"x".repeat(100)}${"😀".repeat(150)}`; // Python では 250 文字、UTF-16 では 400 コード単位
    expect(normalizeMessage(msg)).toBe(msg);
    const cut = normalizeMessage(`${"x".repeat(299)}${"😀".repeat(5)}`);
    expect(Array.from(cut)).toHaveLength(300);
    expect(cut.endsWith("😀")).toBe(true);
  });
});

describe("buildFingerprint (py-gn-log の test_fingerprint.py と同じ事例)", () => {
  it("可変部だけが違うメッセージは同じ fingerprint", () => {
    expect(buildFingerprint("worker", "orders.create", "validation", "order 1 missing")).toBe(
      buildFingerprint("worker", "orders.create", "validation", "order 2 missing"),
    );
    expect(buildFingerprint("w", "op", "validation", "rejected 1,234 rows")).toBe(
      buildFingerprint("w", "op", "validation", "rejected 9,876,543 rows"),
    );
  });

  it("アポストロフィを含む別種のメッセージは違う fingerprint", () => {
    expect(buildFingerprint("w", "op", "infra", "can't connect to database, won't retry")).not.toBe(
      buildFingerprint("w", "op", "infra", "can't parse payload, won't retry"),
    );
  });

  it("surface / operation / error_type / メッセージのいずれかが違えば値が変わる", () => {
    const base = buildFingerprint("worker", "orders.create", "validation", "order missing");
    expect(buildFingerprint("other", "orders.create", "validation", "order missing")).not.toBe(
      base,
    );
    expect(buildFingerprint("worker", "other", "validation", "order missing")).not.toBe(base);
    expect(buildFingerprint("worker", "orders.create", "other", "order missing")).not.toBe(base);
    expect(buildFingerprint("worker", "orders.create", "validation", "other message")).not.toBe(
      base,
    );
  });

  it("値に区切り文字 | が含まれていても別の組み合わせと同じ値にならない", () => {
    expect(buildFingerprint("worker|orders", "create", "validation", "boom")).not.toBe(
      buildFingerprint("worker", "orders|create", "validation", "boom"),
    );
  });

  it("規則どおり \\ と | を escape してから連結する", () => {
    expect(buildFingerprint("worker|orders", "create", "validation", "a\\b")).toBe(
      sha1("worker\\|orders|create|validation|a\\\\b"),
    );
  });

  it("連結文字列の UTF-8 SHA-1 の先頭 16 文字", () => {
    expect(buildFingerprint("worker", "orders.create", "validation", "order 1 missing")).toBe(
      sha1("worker|orders.create|validation|order <num> missing"),
    );
  });

  it("他言語の実装と値を揃えるための参照値 (py-gn-log と同じ)", () => {
    expect(
      buildFingerprint(
        "worker",
        "orders.create",
        "validation",
        'order 123 for "alice" not found (id=3f2504e0-4f89-11d3-9a0c-0305e82c3301)',
      ),
    ).toBe("fc2673ac3981f22c");
  });
});
