import { describe, expect, it } from "vitest";

import { isCloudRun } from "../../src/google/cloud-run.js";

describe("isCloudRun", () => {
  it("K_SERVICE / CLOUD_RUN_JOB / CLOUD_RUN_WORKER_POOL のいずれかがあれば真", () => {
    expect(isCloudRun({ K_SERVICE: "bff" })).toBe(true);
    expect(isCloudRun({ CLOUD_RUN_JOB: "nightly" })).toBe(true);
    expect(isCloudRun({ CLOUD_RUN_WORKER_POOL: "worker" })).toBe(true);
  });

  it("値が空文字列でも、存在すれば真 (py-gn-log の os.getenv(name) is not None と同じ判定)", () => {
    expect(isCloudRun({ K_SERVICE: "" })).toBe(true);
  });

  it("どれも無ければ偽", () => {
    expect(isCloudRun({})).toBe(false);
    expect(isCloudRun({ GOOGLE_CLOUD_PROJECT: "my-project" })).toBe(false);
  });

  it("引数を省略すると process.env を読む", () => {
    const saved = process.env.K_SERVICE;
    try {
      delete process.env.K_SERVICE;
      expect(isCloudRun()).toBe(false);
      process.env.K_SERVICE = "bff";
      expect(isCloudRun()).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.K_SERVICE;
      else process.env.K_SERVICE = saved;
    }
  });
});

import { CLOUD_LOGGING_LABELS_KEY } from "../../src/google/cloud-logging.js";
import { createLogger, useJsonOutput } from "../../src/google/cloud-run.js";
import { collect } from "../helpers.js";

describe("useJsonOutput (Cloud Run 向け)", () => {
  it("引数 > GNLOG_FORMAT > Cloud Run 上かどうか", () => {
    expect(useJsonOutput(false, { K_SERVICE: "bff" })).toBe(false);
    expect(useJsonOutput(undefined, { K_SERVICE: "bff", GNLOG_FORMAT: "text" })).toBe(false);
    expect(useJsonOutput(undefined, { K_SERVICE: "bff" })).toBe(true);
    expect(useJsonOutput(undefined, {})).toBe(false);
    expect(useJsonOutput(undefined, { GNLOG_FORMAT: "json" })).toBe(true);
  });
});

describe("createLogger", () => {
  it("Cloud Run 相当の環境変数があれば JSON 行 (設計案 §2.1 のキー)", () => {
    const out = collect();
    const log = createLogger({
      name: "bff",
      labels: { service: "frontend" },
      env: { K_SERVICE: "bff" },
      write: out.write,
    });
    log.info("task accepted", { site: "site-a" });
    const entry = JSON.parse(out.lines[0]?.line ?? "null");
    expect(entry).toMatchObject({
      severity: "INFO",
      message: "task accepted",
      name: "bff",
      site: "site-a",
      [CLOUD_LOGGING_LABELS_KEY]: { service: "frontend" },
    });
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("Cloud Run 外は text 形式", () => {
    const out = collect();
    const log = createLogger({ name: "bff", env: {}, write: out.write });
    log.info("hello");
    expect(out.lines[0]?.line).toMatch(/^\d{4}-.*Z INFO {5}bff {2}hello$/);
  });

  it("json 引数と GNLOG_FORMAT で形式を強制できる", () => {
    const out = collect();
    createLogger({ name: "bff", env: {}, json: true, write: out.write }).info("a");
    createLogger({ name: "bff", env: { GNLOG_FORMAT: "json" }, write: out.write }).info("b");
    createLogger({
      name: "bff",
      env: { K_SERVICE: "x", GNLOG_FORMAT: "text" },
      write: out.write,
    }).info("c");
    expect(out.lines.map((l) => l.line.startsWith("{"))).toEqual([true, true, false]);
  });

  it("GNLOG_FORMAT が不正なら createLogger がエラーを投げる", () => {
    expect(() => createLogger({ name: "bff", env: { GNLOG_FORMAT: "yaml" } })).toThrow(
      /GNLOG_FORMAT/,
    );
  });

  it("level は引数 > LOG_LEVEL > INFO", () => {
    const out = collect();
    createLogger({ name: "bff", env: { LOG_LEVEL: "DEBUG" }, write: out.write }).debug("shown");
    createLogger({ name: "bff", env: {}, write: out.write }).debug("hidden");
    createLogger({
      name: "bff",
      env: { LOG_LEVEL: "DEBUG" },
      level: "ERROR",
      write: out.write,
    }).info("hidden");
    expect(out.lines.map((l) => l.line.endsWith("shown"))).toEqual([true]);
  });

  it("level に未知の値が来ても INFO に倒し、ログが全部消えることはない (LOG_LEVEL と同じ)", () => {
    const out = collect();
    // JS からの利用や JSON.parse した設定値を模して、型検査をすり抜けた値を渡す
    const bogus = "TRACE" as unknown as "INFO";
    const log = createLogger({ name: "bff", env: {}, level: bogus, json: true, write: out.write });
    log.debug("hidden");
    log.critical("shown");
    expect(out.lines.map((l) => JSON.parse(l.line).message)).toEqual(["shown"]);
    expect(log.level).toBe("INFO");
  });

  it("level に null / 数値 / 配列が来ても投げず、INFO に倒す (undefined は指定なしとして環境変数を見る)", () => {
    for (const bogus of [null, 20, ["ERROR"], { level: "ERROR" }]) {
      const out = collect();
      const log = createLogger({
        name: "bff",
        env: {},
        level: bogus as unknown as "INFO",
        json: true,
        write: out.write,
      });
      expect(log.level).toBe("INFO");
      log.critical("shown");
      expect(out.lines).toHaveLength(1);
    }
  });

  it("fields に null / 配列 / プリミティブ (文字列 / 数値) が来ても投げず、無視する", () => {
    for (const bogus of [null, ["a"], "str", 1]) {
      const out = collect();
      const log = createLogger({
        name: "bff",
        env: { K_SERVICE: "x" },
        fields: bogus as unknown as Record<string, unknown>,
        write: out.write,
      });
      log.info("m");
      const entry = JSON.parse(out.lines[0]?.line ?? "null");
      expect(Object.keys(entry).sort()).toEqual([
        "logging.googleapis.com/labels",
        "message",
        "name",
        "severity",
        "timestamp",
      ]);
    }
  });

  it("labels に null / 配列 / プリミティブ (文字列 / 数値) が来ても投げず、無視する", () => {
    for (const bogus of [null, ["a"], "str", 1]) {
      const out = collect();
      const log = createLogger({
        name: "bff",
        env: { K_SERVICE: "x" },
        labels: bogus as unknown as Record<string, string>,
        write: out.write,
      });
      log.info("m");
      expect(JSON.parse(out.lines[0]?.line ?? "null")[CLOUD_LOGGING_LABELS_KEY]).toEqual({});
    }
  });

  it("labels の値は文字列にする (Cloud Logging の labels は文字列の map)", () => {
    const out = collect();
    const log = createLogger({
      name: "bff",
      env: { K_SERVICE: "x" },
      labels: { n: 1, b: true } as unknown as Record<string, string>,
      write: out.write,
    });
    log.info("m");
    expect(JSON.parse(out.lines[0]?.line ?? "null")[CLOUD_LOGGING_LABELS_KEY]).toEqual({
      n: "1",
      b: "true",
    });
  });

  it("fields は全行に付き、child でさらに重ねられる", () => {
    const out = collect();
    const log = createLogger({
      name: "bff",
      env: { K_SERVICE: "x" },
      fields: { app: "a" },
      write: out.write,
    });
    log.child({ site: "s" }).warn("w");
    expect(JSON.parse(out.lines[0]?.line ?? "null")).toMatchObject({
      app: "a",
      site: "s",
      severity: "WARNING",
    });
  });
});
