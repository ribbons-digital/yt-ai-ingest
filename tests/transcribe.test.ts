import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ProcessModule from "../src/lib/process.js";
import type * as UiModule from "../src/lib/ui.js";

vi.mock("../src/lib/process.js", async () => {
  const actual = await vi.importActual<typeof ProcessModule>("../src/lib/process.js");
  return {
    ...actual,
    runCommand: vi.fn()
  };
});

vi.mock("../src/lib/ui.js", async () => {
  const actual = await vi.importActual<typeof UiModule>("../src/lib/ui.js");
  return {
    ...actual,
    startSpinner: vi.fn(() => ({
      succeed: vi.fn(),
      fail: vi.fn(),
      stop: vi.fn()
    })),
    warn: vi.fn()
  };
});

import { transcribeAudio } from "../src/lib/transcribe.js";
import { runCommand } from "../src/lib/process.js";
import { warn } from "../src/lib/ui.js";

describe("transcribeAudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the SRT transcript when VTT conversion cannot start", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-transcribe-"));
    await writeFile(path.join(videoFolder, "audio.wav"), "audio", "utf8");

    vi.mocked(runCommand).mockImplementation(async (command) => {
      if (command === "mlx_whisper") {
        await writeFile(path.join(videoFolder, "audio.srt"), "transcript", "utf8");
        return { stdout: "", stderr: "", code: 0 };
      }
      if (command === "ffmpeg") {
        throw new Error("spawn ffmpeg ENOENT");
      }
      return { stdout: "", stderr: "", code: 1 };
    });

    await expect(transcribeAudio(videoFolder, { quiet: true })).resolves.toBeUndefined();
    await expect(readFile(path.join(videoFolder, "transcript.srt"), "utf8")).resolves.toBe("transcript");
    expect(warn).toHaveBeenCalledWith("Transcript conversion failed", "keeping transcript.srt");
  });

  it("dry-run previews whisper and ffmpeg commands without probing installed backends", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-transcribe-"));

    vi.mocked(runCommand).mockResolvedValue({ stdout: "", stderr: "", code: 0 });

    await transcribeAudio(videoFolder, {
      dryRun: true,
      model: "small",
      language: "en"
    });

    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(runCommand).toHaveBeenNthCalledWith(
      1,
      "mlx_whisper",
      [
        path.join(videoFolder, "audio.wav"),
        "--output-dir",
        videoFolder,
        "--output-format",
        "srt",
        "--model",
        "small",
        "--language",
        "en"
      ],
      { dryRun: true, model: "small", language: "en" }
    );
    expect(runCommand).toHaveBeenNthCalledWith(
      2,
      "ffmpeg",
      [
        "-y",
        "-i",
        path.join(videoFolder, "transcript.srt"),
        path.join(videoFolder, "transcript.vtt")
      ],
      { dryRun: true, model: "small", language: "en" }
    );
  });

  it("keeps the SRT transcript when VTT conversion exits non-zero", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-transcribe-"));
    await writeFile(path.join(videoFolder, "audio.wav"), "audio", "utf8");

    vi.mocked(runCommand).mockImplementation(async (command, args) => {
      if (command === "mlx_whisper" && args[0] === "--help") {
        return { stdout: "", stderr: "", code: 0 };
      }
      if (command === "mlx_whisper") {
        await writeFile(path.join(videoFolder, "audio.srt"), "transcript", "utf8");
        return { stdout: "", stderr: "", code: 0 };
      }
      if (command === "ffmpeg") {
        return { stdout: "", stderr: "bad conversion", code: 1 };
      }
      return { stdout: "", stderr: "", code: 1 };
    });

    await expect(transcribeAudio(videoFolder, { quiet: true })).resolves.toBeUndefined();
    await expect(readFile(path.join(videoFolder, "transcript.srt"), "utf8")).resolves.toBe("transcript");
    expect(warn).toHaveBeenCalledWith("Transcript conversion failed", "keeping transcript.srt");
  });
});
