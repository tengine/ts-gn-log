import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildFingerprint, MAX_MESSAGE_LENGTH, normalizeMessage } from "../src/fingerprint.js";

interface Golden {
  source: { repo: string; commit: string };
  truncation_unit: string;
  max_message_length: number;
  normalize: Array<{ message: string; expected: string }>;
  normalize_max_length: Array<{ message: string; max_length: number; expected: string }>;
  fingerprint: Array<{
    surface: string;
    operation: string;
    error_type: string;
    message: string;
    expected: string;
  }>;
}

// py-gn-log の Python 実装 (src/gnlog/fingerprint.py) から生成したゴールデンベクタ。
// 正本は py-gn-log 側。再生成の手順は README の「fingerprint」の節
const golden: Golden = JSON.parse(
  readFileSync(new URL("./fixtures/fingerprint-golden.json", import.meta.url), "utf8"),
);

describe("fingerprint のゴールデンベクタ (test/fixtures/fingerprint-golden.json) と一致する", () => {
  it("前提 (切り詰めの長さと単位) が一致する", () => {
    expect(golden.max_message_length).toBe(MAX_MESSAGE_LENGTH);
    expect(golden.truncation_unit).toMatch(/code points/);
  });

  it.each(golden.normalize.map((c) => [c.message.slice(0, 40), c] as const))(
    "normalize %j",
    (_label, c) => {
      expect(normalizeMessage(c.message)).toBe(c.expected);
    },
  );

  it.each(
    golden.normalize_max_length.map(
      (c) => [`${c.message.slice(0, 20)} @ ${c.max_length}`, c] as const,
    ),
  )("normalize (max_length を指定) %j", (_label, c) => {
    expect(normalizeMessage(c.message, c.max_length)).toBe(c.expected);
  });

  it.each(
    golden.fingerprint.map(
      (c) => [`${c.surface}|${c.operation}|${c.error_type}|${c.message.slice(0, 30)}`, c] as const,
    ),
  )("fingerprint %j", (_label, c) => {
    expect(buildFingerprint(c.surface, c.operation, c.error_type, c.message)).toBe(c.expected);
  });
});
