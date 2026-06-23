import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scout } from "../src/commands/scout.js";

describe("scout", () => {
  const originalLog = console.log;
  let logs: string[] = [];

  beforeEach(() => {
    logs = [];
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
  });

  afterEach(() => {
    console.log = originalLog;
  });

  it("derives enhanced temporal paths from the custom scout output directory", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-scout-video-"));
    const outDir = await mkdtemp(path.join(os.tmpdir(), "ytai-scout-out-"));

    await scout(videoFolder, {
      dryRun: true,
      interval: 10,
      columns: 2,
      out: outDir,
      enhanced: true
    });

    const output = logs.join("\n");
    expect(output).toContain(path.join(outDir, "temporal", "block_0001", "frame_0001.jpg"));
    expect(output).toContain(path.join(outDir, "temporal", "block_0001", "strip.jpg"));
    expect(output).not.toContain(path.join(videoFolder, "frames", "scout", "temporal"));
  });
});
