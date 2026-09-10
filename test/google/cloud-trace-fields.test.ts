import { describe, expect, it } from "vitest";

import { createLogger } from "../../src/google/cloud-run.js";
import {
  logFields,
  SPAN_ID_KEY,
  TRACE_KEY,
  TRACE_SAMPLED_KEY,
  traceFromHeaders,
} from "../../src/google/cloud-trace.js";
import { runWithTrace } from "../../src/trace.js";
import { collect } from "../helpers.js";

const TID = "4bf92f3577b34da6a3ce929d0e0e4736";
const SID = "00f067aa0ba902b7";

function makeLogger(env: Record<string, string>, projectId?: string) {
  const out = collect();
  const opts: Parameters<typeof createLogger>[0] = {
    name: "bff",
    env: { K_SERVICE: "x", ...env },
    write: out.write,
  };
  if (projectId !== undefined) opts.projectId = projectId;
  const log = createLogger(opts);
  return { log, last: () => JSON.parse(out.lines.at(-1)?.line ?? "null") };
}

describe("logFields", () => {
  it("projectId があれば trace / spanId / trace_sampled (分かるものだけ)", () => {
    expect(logFields({ traceId: TID, spanId: SID, sampled: true }, "p")).toEqual({
      [TRACE_KEY]: `projects/p/traces/${TID}`,
      [SPAN_ID_KEY]: SID,
      [TRACE_SAMPLED_KEY]: true,
    });
    expect(logFields({ traceId: TID }, "p")).toEqual({ [TRACE_KEY]: `projects/p/traces/${TID}` });
  });

  it("projectId が無ければ空 (既定値を持たない)", () => {
    expect(logFields({ traceId: TID, spanId: SID, sampled: true }, undefined)).toEqual({});
    expect(logFields({ traceId: TID }, "")).toEqual({});
  });
});

describe("文脈の trace が Cloud Logging の特殊フィールドになる (設計案 §2.2)", () => {
  it("X-Cloud-Trace-Context から取った trace で期待する trace id が出る", () => {
    const { log, last } = makeLogger({ GOOGLE_CLOUD_PROJECT: "my-project" });
    const trace = traceFromHeaders(new Headers({ "X-Cloud-Trace-Context": `${TID}/1;o=1` }));
    runWithTrace(trace, undefined, () => log.info("m"));
    expect(last()).toMatchObject({
      [TRACE_KEY]: `projects/my-project/traces/${TID}`,
      [SPAN_ID_KEY]: "0000000000000001",
      [TRACE_SAMPLED_KEY]: true,
    });
    expect(last()).not.toHaveProperty("trace");
  });

  it("traceparent だけでも同じ trace id が出る", () => {
    const { log, last } = makeLogger({ GOOGLE_CLOUD_PROJECT: "my-project" });
    const trace = traceFromHeaders(new Headers({ traceparent: `00-${TID}-${SID}-00` }));
    runWithTrace(trace, undefined, () => log.info("m"));
    expect(last()).toMatchObject({
      [TRACE_KEY]: `projects/my-project/traces/${TID}`,
      [SPAN_ID_KEY]: SID,
      [TRACE_SAMPLED_KEY]: false,
    });
  });

  it("文脈に trace が無ければ trace のフィールドは付かない", () => {
    const { log, last } = makeLogger({ GOOGLE_CLOUD_PROJECT: "my-project" });
    log.info("m");
    expect(last()).not.toHaveProperty(TRACE_KEY);
  });
});

describe("projectId は引数 > GOOGLE_CLOUD_PROJECT > 付けない", () => {
  const trace = { traceId: TID, spanId: SID, sampled: true };

  it("引数も環境変数も未指定なら、文脈に trace があっても付かない", () => {
    const { log, last } = makeLogger({});
    runWithTrace(trace, undefined, () => log.info("m"));
    expect(last()).not.toHaveProperty(TRACE_KEY);
    expect(last()).not.toHaveProperty(SPAN_ID_KEY);
  });

  it("環境変数だけが設定されていれば付く", () => {
    const { log, last } = makeLogger({ GOOGLE_CLOUD_PROJECT: "env-project" });
    runWithTrace(trace, undefined, () => log.info("m"));
    expect(last()[TRACE_KEY]).toBe(`projects/env-project/traces/${TID}`);
  });

  it("引数が環境変数より優先する", () => {
    const { log, last } = makeLogger({ GOOGLE_CLOUD_PROJECT: "env-project" }, "arg-project");
    runWithTrace(trace, undefined, () => log.info("m"));
    expect(last()[TRACE_KEY]).toBe(`projects/arg-project/traces/${TID}`);
  });

  it("text 形式では trace のフィールドは出ない (Cloud Logging 向けのみ)", () => {
    const out = collect();
    const log = createLogger({ name: "bff", env: { GOOGLE_CLOUD_PROJECT: "p" }, write: out.write });
    runWithTrace(trace, undefined, () => log.info("m"));
    expect(out.lines[0]?.line).toMatch(/INFO {5}bff {2}m$/);
  });
});
