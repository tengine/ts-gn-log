import { describe, expect, it } from "vitest";

import * as index from "../src/index.js";

describe("ts-gn-log の入口", () => {
  it("共通部 (level / output) を再輸出し、google/ のものは含まない", () => {
    const keys = Object.keys(index).sort();
    expect(keys).toContain("parseLevel");
    expect(keys).toContain("runWithContext");
    expect(keys).toContain("parseTraceparent");
    expect(keys).not.toContain("parseCloudTraceContext");
    expect(keys).toContain("createCoreLogger");
    expect(keys).toContain("useJsonOutput");
    expect(keys).not.toContain("isCloudRun");
    expect(keys).not.toContain("jsonFormat");
  });
});
