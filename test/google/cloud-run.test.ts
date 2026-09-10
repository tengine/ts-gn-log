import { describe, expect, it } from "vitest";

import { isCloudRun } from "../../src/google/cloud-run.js";

describe("isCloudRun", () => {
  it("K_SERVICE / CLOUD_RUN_JOB / CLOUD_RUN_WORKER_POOL のいずれかがあれば真", () => {
    expect(isCloudRun({ K_SERVICE: "bff" })).toBe(true);
    expect(isCloudRun({ CLOUD_RUN_JOB: "nightly" })).toBe(true);
    expect(isCloudRun({ CLOUD_RUN_WORKER_POOL: "worker" })).toBe(true);
  });

  it("値が空文字列でも、存在すれば真 (py-gn-log の != None と同じ判定)", () => {
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
