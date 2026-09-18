import { describe, expect, it } from "vitest";

import * as index from "../src/index.js";

describe("ts-gn-log の入口", () => {
  it("google/ を読み込まず、共通部だけを再輸出する (今はまだ空)", () => {
    expect(Object.keys(index)).toEqual([]);
  });
});
