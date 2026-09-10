import { describe, expect, it } from "vitest";

import { useJsonOutput } from "../src/output.js";

describe("useJsonOutput", () => {
  it("引数が最優先 (環境変数を読まない)", () => {
    expect(useJsonOutput(true, false, { GNLOG_FORMAT: "text" })).toBe(true);
    expect(useJsonOutput(false, true, { GNLOG_FORMAT: "json" })).toBe(false);
    // 引数があれば不正な環境変数でもエラーにしない (py-gn-log と同じ)
    expect(useJsonOutput(true, false, { GNLOG_FORMAT: "bogus" })).toBe(true);
  });

  it("引数が無ければ GNLOG_FORMAT (大文字小文字・前後の空白を無視)", () => {
    expect(useJsonOutput(undefined, false, { GNLOG_FORMAT: "json" })).toBe(true);
    expect(useJsonOutput(undefined, true, { GNLOG_FORMAT: "text" })).toBe(false);
    expect(useJsonOutput(undefined, false, { GNLOG_FORMAT: " JSON " })).toBe(true);
  });

  it("環境変数も無ければ既定 (boolean か関数)", () => {
    expect(useJsonOutput(undefined, true, {})).toBe(true);
    expect(useJsonOutput(undefined, false, { GNLOG_FORMAT: "" })).toBe(false);
    expect(useJsonOutput(undefined, () => true, {})).toBe(true);
  });

  it("GNLOG_FORMAT が json / text 以外ならエラー", () => {
    expect(() => useJsonOutput(undefined, false, { GNLOG_FORMAT: "yaml" })).toThrow(
      /Invalid value "yaml" for environment variable GNLOG_FORMAT/,
    );
  });
});
