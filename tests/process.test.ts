import { describe, expect, it } from "vitest";
import { resolveRunStdio } from "../src/lib/process.js";

describe("resolveRunStdio", () => {
  it("captures external command output by default", () => {
    expect(resolveRunStdio({})).toBe("pipe");
  });

  it("inherits external command output in verbose mode", () => {
    expect(resolveRunStdio({ verbose: true })).toBe("inherit");
  });

  it("captures output when requested even in verbose mode", () => {
    expect(resolveRunStdio({ verbose: true, capture: true })).toBe("pipe");
  });
});
