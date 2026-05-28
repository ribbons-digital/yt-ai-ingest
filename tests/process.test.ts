import { describe, expect, it } from "vitest";
import { resolveRunStdio, runCommand } from "../src/lib/process.js";

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

  it("notifies stdout chunks when output is piped", async () => {
    const chunks: string[] = [];

    await runCommand("node", ["-e", "process.stdout.write('[download] 12.3%')"], {
      onStdoutChunk: (chunk) => chunks.push(chunk)
    });

    expect(chunks.join("")).toContain("[download] 12.3%");
  });
});
