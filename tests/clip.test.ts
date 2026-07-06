import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as DependenciesModule from "../src/lib/dependencies.js";
import type * as FilesModule from "../src/lib/files.js";
import type * as ProcessModule from "../src/lib/process.js";

vi.mock("../src/lib/dependencies.js", async () => {
  const actual = await vi.importActual<typeof DependenciesModule>("../src/lib/dependencies.js");
  return {
    ...actual,
    ensureDependencies: vi.fn()
  };
});

vi.mock("../src/lib/files.js", async () => {
  const actual = await vi.importActual<typeof FilesModule>("../src/lib/files.js");
  return {
    ...actual,
    ensureDir: vi.fn(),
    pathExists: vi.fn()
  };
});

vi.mock("../src/lib/process.js", async () => {
  const actual = await vi.importActual<typeof ProcessModule>("../src/lib/process.js");
  return {
    ...actual,
    runCommand: vi.fn()
  };
});

import { clip } from "../src/commands/clip.js";
import { ensureDir, pathExists } from "../src/lib/files.js";
import { runCommand } from "../src/lib/process.js";

describe("clip local files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runCommand).mockResolvedValue({ stdout: "", stderr: "", code: 0 });
  });

  it("throws when the local video file is missing", async () => {
    vi.mocked(pathExists).mockResolvedValue(false);

    await expect(
      clip("/tmp/missing.mp4", { from: "03:20", to: "05:10", outDir: "/tmp/clips" })
    ).rejects.toThrow("Local video file not found: /tmp/missing.mp4");

    expect(runCommand).not.toHaveBeenCalled();
  });

  it("builds the output filename from the slugged stem and clip range", async () => {
    vi.mocked(pathExists).mockResolvedValue(true);

    await clip("/tmp/My Talk!.mp4", { from: "03:20", to: "05:10", outDir: "/tmp/clips" });

    expect(ensureDir).toHaveBeenCalledWith("/tmp/clips");
    expect(runCommand).toHaveBeenCalledWith(
      "ffmpeg",
      [
        "-y",
        "-ss",
        "00:03:20",
        "-to",
        "00:05:10",
        "-i",
        path.resolve("/tmp/My Talk!.mp4"),
        "-c",
        "copy",
        path.join("/tmp/clips", "my-talk_clip_200-310.mp4")
      ],
      { from: "03:20", to: "05:10", outDir: "/tmp/clips" }
    );
  });

  it("uses the re-encode ffmpeg arguments with --force-keyframes", async () => {
    vi.mocked(pathExists).mockResolvedValue(true);

    await clip("/tmp/My Talk!.mp4", {
      from: "03:20",
      to: "05:10",
      outDir: "/tmp/clips",
      forceKeyframes: true
    });

    expect(runCommand).toHaveBeenCalledWith(
      "ffmpeg",
      [
        "-y",
        "-i",
        path.resolve("/tmp/My Talk!.mp4"),
        "-ss",
        "00:03:20",
        "-to",
        "00:05:10",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        path.join("/tmp/clips", "my-talk_clip_200-310.mp4")
      ],
      { from: "03:20", to: "05:10", outDir: "/tmp/clips", forceKeyframes: true }
    );
  });
});
