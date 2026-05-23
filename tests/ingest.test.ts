import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ingest } from "../src/commands/ingest.js";

describe("ingest", () => {
  const originalLog = console.log;
  let logs: string[] = [];

  beforeEach(() => {
    logs = [];
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
  });

  afterEach(() => {
    console.log = originalLog;
  });
  it("returns the generated video folder path", async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), "ytai-ingest-"));

    const result = await ingest("https://youtube.example/watch?v=test", {
      dryRun: true,
      outDir
    });

    expect(result.videoFolder).toBe(
      path.join(outDir, `${new Date().toISOString().slice(0, 10)}_youtube-video_dry-run`)
    );
    expect(result.assets.metadata).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("uses a prompted video folder path when one is provided", async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), "ytai-ingest-"));
    const promptedFolder = path.join(outDir, "custom-video-folder");

    const result = await ingest("https://youtube.example/watch?v=test", {
      dryRun: true,
      outDir,
      promptVideoFolder: async (defaultFolder) => {
        expect(defaultFolder).toBe(
          path.join(outDir, `${new Date().toISOString().slice(0, 10)}_youtube-video_dry-run`)
        );
        return promptedFolder;
      }
    });

    expect(result.videoFolder).toBe(promptedFolder);
  });

  it("keeps the generated folder path when the prompt is left blank", async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), "ytai-ingest-"));
    const defaultFolder = path.join(
      outDir,
      `${new Date().toISOString().slice(0, 10)}_youtube-video_dry-run`
    );

    const result = await ingest("https://youtube.example/watch?v=test", {
      dryRun: true,
      outDir,
      promptVideoFolder: async () => "   "
    });

    expect(result.videoFolder).toBe(defaultFolder);
  });

  it("expands a prompted home-relative folder path", async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), "ytai-ingest-"));
    const promptedFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-home-expanded-"));
    const homeRelativePrompt = `~/../../${path.relative("/", promptedFolder)}`;

    const result = await ingest("https://youtube.example/watch?v=test", {
      dryRun: true,
      outDir,
      promptVideoFolder: async () => homeRelativePrompt
    });

    expect(result.videoFolder).toBe(promptedFolder);
  });

  it("dry-run yt-dlp command no longer includes --convert-thumbnails", async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), "ytai-ingest-"));

    await ingest("https://youtube.example/watch?v=test", {
      dryRun: true,
      outDir
    });

    const downloadCommand = logs.find(
      (log) => log.startsWith("yt-dlp") && log.includes("source.%(ext)s")
    );
    expect(downloadCommand).toBeDefined();
    expect(downloadCommand).not.toContain("--convert-thumbnails");
  });

  it("returns asset map indicating what was produced", async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), "ytai-ingest-"));

    const result = await ingest("https://youtube.example/watch?v=test", {
      dryRun: true,
      outDir
    });

    expect(result.assets).toEqual({
      metadata: true,
      description: true,
      transcript: true,
      video: true,
      audio: true,
      thumbnail: true
    });
    expect(result.warnings).toEqual([]);
  });

  it("dry-run with --transcript-only uses --skip-download and no video format flags", async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), "ytai-ingest-"));

    const result = await ingest("https://youtube.example/watch?v=test", {
      dryRun: true,
      outDir,
      transcriptOnly: true
    });

    expect(result.videoFolder).toBeDefined();

    const downloadCommand = logs.find(
      (log) => log.startsWith("yt-dlp") && log.includes("source.%(ext)s")
    );
    expect(downloadCommand).toBeDefined();
    expect(downloadCommand).toContain("--skip-download");
    expect(downloadCommand).not.toContain("bv*");
    expect(downloadCommand).not.toContain("--merge-output-format");
    expect(downloadCommand).not.toContain("--write-thumbnail");
  });

  it("dry-run with --rate-limit includes sleep and retry flags", async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), "ytai-ingest-"));

    await ingest("https://youtube.example/watch?v=test", {
      dryRun: true,
      outDir,
      rateLimit: true
    });

    const downloadCommand = logs.find(
      (log) => log.startsWith("yt-dlp") && log.includes("source.%(ext)s")
    );
    expect(downloadCommand).toBeDefined();
    expect(downloadCommand).toContain("--sleep-requests");
    expect(downloadCommand).toContain("--max-sleep-interval");
    expect(downloadCommand).toContain("--retries");
    expect(downloadCommand).toContain("--fragment-retries");
  });

  it("dry-run with --cookies-from-browser includes cookie flag", async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), "ytai-ingest-"));

    await ingest("https://youtube.example/watch?v=test", {
      dryRun: true,
      outDir,
      cookiesFromBrowser: "chrome"
    });

    const downloadCommand = logs.find(
      (log) => log.startsWith("yt-dlp") && log.includes("source.%(ext)s")
    );
    expect(downloadCommand).toBeDefined();
    expect(downloadCommand).toContain("--cookies-from-browser");
    expect(downloadCommand).toContain("chrome");
  });

  it("dry-run with --cookies includes the path", async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), "ytai-ingest-"));

    await ingest("https://youtube.example/watch?v=test", {
      dryRun: true,
      outDir,
      cookiesPath: "/path/to/cookies.txt"
    });

    const downloadCommand = logs.find(
      (log) => log.startsWith("yt-dlp") && log.includes("source.%(ext)s")
    );
    expect(downloadCommand).toBeDefined();
    expect(downloadCommand).toContain("--cookies");
    expect(downloadCommand).toContain("/path/to/cookies.txt");
  });
});
