import { mkdtemp, writeFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/process.js", async () => {
  const actual = await vi.importActual("../src/lib/process.js") as typeof import("../src/lib/process.js");
  return {
    ...actual,
    runCommand: vi.fn()
  };
});

vi.mock("../src/lib/ui.js", async () => {
  const actual = await vi.importActual("../src/lib/ui.js") as typeof import("../src/lib/ui.js");
  return {
    ...actual,
    warn: vi.fn()
  };
});

import { normalizeArtifacts } from "../src/commands/ingest.js";
import { runCommand } from "../src/lib/process.js";
import { warn } from "../src/lib/ui.js";

describe("normalizeArtifacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes info json, description, vtt, and audio from existing files", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-normalize-"));
    await writeFile(path.join(videoFolder, "source.info.json"), "{}", "utf8");
    await writeFile(path.join(videoFolder, "source.description"), "desc", "utf8");
    await writeFile(path.join(videoFolder, "source.en.vtt"), "WEBVTT", "utf8");
    await writeFile(path.join(videoFolder, "source.mp4"), "", "utf8");

    const mockRunCommand = vi.mocked(runCommand);
    mockRunCommand.mockResolvedValue({ stdout: "", stderr: "", code: 0 });

    await normalizeArtifacts(videoFolder, { dryRun: false, verbose: false });

    const names = await readdir(videoFolder);
    expect(names).toContain("metadata.info.json");
    expect(names).toContain("description.txt");
    expect(names).toContain("transcript.vtt");

    // Verify ffmpeg was called for VTT→SRT and audio extraction
    expect(mockRunCommand).toHaveBeenCalledWith(
      "ffmpeg",
      expect.arrayContaining([expect.stringContaining("transcript.vtt"), expect.stringContaining("transcript.srt")]),
      expect.anything()
    );
    expect(mockRunCommand).toHaveBeenCalledWith(
      "ffmpeg",
      expect.arrayContaining([expect.stringContaining("source.mp4"), expect.stringContaining("audio.wav")]),
      expect.anything()
    );
  });

  it("moves source.jpg directly to thumbnail.jpg without calling ffmpeg", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-normalize-"));
    await writeFile(path.join(videoFolder, "source.info.json"), "{}", "utf8");
    await writeFile(path.join(videoFolder, "source.description"), "desc", "utf8");
    await writeFile(path.join(videoFolder, "source.en.vtt"), "WEBVTT", "utf8");
    await writeFile(path.join(videoFolder, "source.mp4"), "", "utf8");
    await writeFile(path.join(videoFolder, "source.jpg"), "fake-jpg", "utf8");

    vi.mocked(runCommand).mockResolvedValue({ stdout: "", stderr: "", code: 0 });

    await normalizeArtifacts(videoFolder, { dryRun: false, verbose: false });

    const names = await readdir(videoFolder);
    expect(names).toContain("thumbnail.jpg");
    expect(names).not.toContain("source.jpg");
  });

  it("converts source.webp to thumbnail.jpg via ffmpeg", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-normalize-"));
    await writeFile(path.join(videoFolder, "source.info.json"), "{}", "utf8");
    await writeFile(path.join(videoFolder, "source.description"), "desc", "utf8");
    await writeFile(path.join(videoFolder, "source.en.vtt"), "WEBVTT", "utf8");
    await writeFile(path.join(videoFolder, "source.mp4"), "", "utf8");
    await writeFile(path.join(videoFolder, "source.webp"), "fake-webp", "utf8");

    const mockRunCommand = vi.mocked(runCommand);
    mockRunCommand.mockResolvedValue({ stdout: "", stderr: "", code: 0 });

    await normalizeArtifacts(videoFolder, { dryRun: false, verbose: false });

    expect(mockRunCommand).toHaveBeenCalledWith(
      "ffmpeg",
      expect.arrayContaining([expect.stringContaining("source.webp"), expect.stringContaining("thumbnail.jpg")]),
      expect.anything()
    );
  });

  it("warns but does not fail when thumbnail conversion fails", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-normalize-"));
    await writeFile(path.join(videoFolder, "source.info.json"), "{}", "utf8");
    await writeFile(path.join(videoFolder, "source.description"), "desc", "utf8");
    await writeFile(path.join(videoFolder, "source.en.vtt"), "WEBVTT", "utf8");
    await writeFile(path.join(videoFolder, "source.mp4"), "", "utf8");
    await writeFile(path.join(videoFolder, "source.webp"), "fake-webp", "utf8");

    const mockRunCommand = vi.mocked(runCommand);
    mockRunCommand.mockImplementation(async (cmd, args) => {
      if (cmd === "ffmpeg" && args.some((a) => a.includes("thumbnail"))) {
        throw new Error("ffmpeg conversion failed");
      }
      return { stdout: "", stderr: "", code: 0 };
    });

    await normalizeArtifacts(videoFolder, { dryRun: false, verbose: false });

    expect(warn).toHaveBeenCalledWith("Thumbnail conversion failed", "source.webp");

    const names = await readdir(videoFolder);
    expect(names).toContain("thumbnail.webp");
    expect(names).not.toContain("source.webp");
  });

  it("keeps transcript.vtt when transcript conversion cannot start", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-normalize-"));
    await writeFile(path.join(videoFolder, "source.en.vtt"), "WEBVTT", "utf8");

    vi.mocked(runCommand).mockRejectedValue(new Error("spawn ffmpeg ENOENT"));

    const assets = await normalizeArtifacts(videoFolder, { dryRun: false, verbose: false });

    const names = await readdir(videoFolder);
    expect(assets.transcript).toBe(true);
    expect(names).toContain("transcript.vtt");
    expect(warn).toHaveBeenCalledWith("Transcript conversion failed", "keeping transcript.vtt");
  });

  it("still normalizes everything when no thumbnail is present", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-normalize-"));
    await writeFile(path.join(videoFolder, "source.info.json"), "{}", "utf8");
    await writeFile(path.join(videoFolder, "source.description"), "desc", "utf8");
    await writeFile(path.join(videoFolder, "source.en.vtt"), "WEBVTT", "utf8");
    await writeFile(path.join(videoFolder, "source.mp4"), "", "utf8");

    vi.mocked(runCommand).mockResolvedValue({ stdout: "", stderr: "", code: 0 });

    await normalizeArtifacts(videoFolder, { dryRun: false, verbose: false });

    const names = await readdir(videoFolder);
    expect(names).toContain("metadata.info.json");
    expect(names).not.toContain("thumbnail.jpg");
  });
});
