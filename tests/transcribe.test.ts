import { mkdtemp, writeFile, readFile } from "node:fs/promises";
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
});
