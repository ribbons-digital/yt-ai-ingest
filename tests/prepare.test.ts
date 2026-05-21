import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prepare } from "../src/commands/prepare.js";

describe("prepare", () => {
  it("runs the default dry-run workflow and returns the generated video folder", async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), "ytai-prepare-"));

    const videoFolder = await prepare("https://youtube.example/watch?v=test", {
      dryRun: true,
      outDir,
      scoutInterval: 30,
      scoutColumns: 3
    });

    expect(videoFolder).toBe(
      path.join(outDir, `${new Date().toISOString().slice(0, 10)}_youtube-video_dry-run`)
    );

    const summary = await readFile(path.join(videoFolder, "analysis", "summary-input.md"), "utf8");
    expect(summary).toContain("# YouTube AI Context");
  });

  it("uses the prompted ingest folder for the full workflow", async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), "ytai-prepare-"));
    const promptedFolder = path.join(outDir, "agent-ready-video");

    const videoFolder = await prepare("https://youtube.example/watch?v=test", {
      dryRun: true,
      outDir,
      scoutInterval: 30,
      scoutColumns: 3,
      promptVideoFolder: async () => promptedFolder
    });

    expect(videoFolder).toBe(promptedFolder);
    const summary = await readFile(path.join(promptedFolder, "analysis", "summary-input.md"), "utf8");
    expect(summary).toContain("# YouTube AI Context");
  });
});
