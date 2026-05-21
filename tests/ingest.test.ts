import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ingest } from "../src/commands/ingest.js";

describe("ingest", () => {
  it("returns the generated video folder path", async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), "ytai-ingest-"));

    const videoFolder = await ingest("https://youtube.example/watch?v=test", {
      dryRun: true,
      outDir
    });

    expect(videoFolder).toBe(
      path.join(outDir, `${new Date().toISOString().slice(0, 10)}_youtube-video_dry-run`)
    );
  });

  it("uses a prompted video folder path when one is provided", async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), "ytai-ingest-"));
    const promptedFolder = path.join(outDir, "custom-video-folder");

    const videoFolder = await ingest("https://youtube.example/watch?v=test", {
      dryRun: true,
      outDir,
      promptVideoFolder: async (defaultFolder) => {
        expect(defaultFolder).toBe(
          path.join(outDir, `${new Date().toISOString().slice(0, 10)}_youtube-video_dry-run`)
        );
        return promptedFolder;
      }
    });

    expect(videoFolder).toBe(promptedFolder);
  });

  it("keeps the generated folder path when the prompt is left blank", async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), "ytai-ingest-"));
    const defaultFolder = path.join(
      outDir,
      `${new Date().toISOString().slice(0, 10)}_youtube-video_dry-run`
    );

    const videoFolder = await ingest("https://youtube.example/watch?v=test", {
      dryRun: true,
      outDir,
      promptVideoFolder: async () => "   "
    });

    expect(videoFolder).toBe(defaultFolder);
  });

  it("expands a prompted home-relative folder path", async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), "ytai-ingest-"));
    const promptedFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-home-expanded-"));
    const homeRelativePrompt = `~/../../${path.relative("/", promptedFolder)}`;

    const videoFolder = await ingest("https://youtube.example/watch?v=test", {
      dryRun: true,
      outDir,
      promptVideoFolder: async () => homeRelativePrompt
    });

    expect(videoFolder).toBe(promptedFolder);
  });
});
