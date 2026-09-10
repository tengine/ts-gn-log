import { describe, expect, it } from "vitest";

import { isEnabled, levelFromEnv, levelValue, parseLevel } from "../src/level.js";

describe("parseLevel", () => {
  it("大文字・小文字を問わず 5 つのレベルを読む", () => {
    expect(parseLevel("DEBUG")).toBe("DEBUG");
    expect(parseLevel("info")).toBe("INFO");
    expect(parseLevel("Warning")).toBe("WARNING");
    expect(parseLevel("error")).toBe("ERROR");
    expect(parseLevel("CRITICAL")).toBe("CRITICAL");
  });

  it("WARN は WARNING の別名 (py-gn-log と同じ)", () => {
    expect(parseLevel("WARN")).toBe("WARNING");
    expect(parseLevel("warn")).toBe("WARNING");
  });

  it("未知の値は既定に倒し、エラーにしない (py-gn-log の level.parse と同じ)", () => {
    expect(parseLevel("verbose")).toBe("INFO");
    expect(parseLevel("verbose", "ERROR")).toBe("ERROR");
    expect(parseLevel("")).toBe("INFO");
  });

  it("前後の空白は無視する", () => {
    expect(parseLevel(" debug ")).toBe("DEBUG");
  });
});

describe("levelFromEnv", () => {
  it("LOG_LEVEL を読む。未設定・空・未知の値は INFO", () => {
    expect(levelFromEnv({ LOG_LEVEL: "DEBUG" })).toBe("DEBUG");
    expect(levelFromEnv({ LOG_LEVEL: "warn" })).toBe("WARNING");
    expect(levelFromEnv({})).toBe("INFO");
    expect(levelFromEnv({ LOG_LEVEL: "" })).toBe("INFO");
    expect(levelFromEnv({ LOG_LEVEL: "verbose" })).toBe("INFO");
  });
});

describe("levelValue / isEnabled", () => {
  it("数値は Python の logging と同じ", () => {
    expect(levelValue("DEBUG")).toBe(10);
    expect(levelValue("INFO")).toBe(20);
    expect(levelValue("WARNING")).toBe(30);
    expect(levelValue("ERROR")).toBe(40);
    expect(levelValue("CRITICAL")).toBe(50);
  });

  it("threshold 以上のレベルだけ有効", () => {
    expect(isEnabled("INFO", "INFO")).toBe(true);
    expect(isEnabled("DEBUG", "INFO")).toBe(false);
    expect(isEnabled("CRITICAL", "ERROR")).toBe(true);
    expect(isEnabled("WARNING", "ERROR")).toBe(false);
  });
});
