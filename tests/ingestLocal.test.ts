import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/dependencies.js", () => ({
  ensureDependencies: vi.fn()
}));

vi.mock("../src/lib/process.js", async () => {
  const actual = await vi.importActual("../src/lib/process.js") as typeof import("../src/lib/process.js");
  return {
    ...actual,
    runCommand: vi.fn()
  };
});

import { detectFinalAssets, ingestLocal, matchSidecarSubtitle } from "../src/commands/ingestLocal.js";
import { runCommand } from "../src/lib/process.js";

describe("matchSidecarSubtitle", () => {
  it("prefers an exact-stem .srt over an exact-stem .vtt", () => {
    expect(matchSidecarSubtitle("video", ["video.vtt", "video.srt"])).toBe("video.srt");
  });

  it("prefers an exact-stem .srt over a language-tagged .srt", () => {
    expect(matchSidecarSubtitle("video", ["video.en.srt", "video.srt"])).toBe("video.srt");
  });

  it("matches a language-tagged sidecar when it is the only candidate", () => {
    expect(matchSidecarSubtitle("video", ["video.en.srt"])).toBe("video.en.srt");
  });

  it("prefers a language-tagged .srt over an exact-stem .vtt", () => {
    expect(matchSidecarSubtitle("video", ["video.vtt", "video.en.srt"])).toBe("video.en.srt");
  });

  it("ignores unrelated files entirely", () => {
    expect(
      matchSidecarSubtitle("video", [
        "other.srt",
        "video.txt",
        "video.mp4",
        "videos.srt",
        "video.backup.en.srt"
      ])
    ).toBeUndefined();
  });

  it("picks the matching sidecar out of unrelated noise", () => {
    expect(matchSidecarSubtitle("video", ["other.srt", "video.mp4", "video.vtt"])).toBe(
      "video.vtt"
    );
  });

  it("breaks equal-score ties by candidate name regardless of input order", () => {
    expect(matchSidecarSubtitle("video", ["video.zh.srt", "video.en.srt"])).toBe("video.en.srt");
    expect(matchSidecarSubtitle("video", ["video.en.srt", "video.zh.srt"])).toBe("video.en.srt");
  });

  it("returns undefined for an empty candidate list", () => {
    expect(matchSidecarSubtitle("video", [])).toBeUndefined();
  });

  it("matches case-insensitively while preserving the original candidate name", () => {
    expect(matchSidecarSubtitle("My Talk", ["My Talk.SRT"])).toBe("My Talk.SRT");
  });
});

describe("ingestLocal", () => {
  it("does not delete the source when importing in place with --link", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-local-in-place-"));
    const source = path.join(videoFolder, "source.mp4");
    await writeFile(source, "video", "utf8");

    vi.mocked(runCommand).mockResolvedValue({
      stdout: JSON.stringify({
        format: { duration: "12" },
        streams: [{ codec_type: "video", width: 1920, height: 1080 }]
      }),
      stderr: "",
      code: 0
    });

    const result = await ingestLocal(source, {
      dryRun: false,
      outDir: path.dirname(videoFolder),
      promptVideoFolder: async () => videoFolder,
      link: true,
      quiet: true
    });

    expect(result.videoFolder).toBe(videoFolder);
    expect(await readFile(source, "utf8")).toBe("video");
  });
});

describe("detectFinalAssets", () => {
  async function makeVideoFolder(files: string[] = []): Promise<string> {
    const folder = await mkdtemp(path.join(os.tmpdir(), "ytai-detect-assets-"));
    for (const name of files) {
      await writeFile(path.join(folder, name), "", "utf8");
    }
    return folder;
  }

  const allFalse = {
    metadata: false,
    description: false,
    transcript: false,
    video: false,
    audio: false,
    thumbnail: false
  };

  it("reports every asset missing for an empty folder", async () => {
    const folder = await makeVideoFolder();
    expect(await detectFinalAssets(folder)).toEqual(allFalse);
  });

  it.each([
    ["metadata.info.json", "metadata"],
    ["description.txt", "description"],
    ["transcript.srt", "transcript"],
    ["transcript.vtt", "transcript"],
    ["source.mp4", "video"],
    ["source.mov", "video"],
    ["source.mkv", "video"],
    ["source.webm", "video"],
    ["audio.wav", "audio"],
    ["thumbnail.jpg", "thumbnail"]
  ])("flips only the %s flag to true via %s", async (fileName, assetKey) => {
    const folder = await makeVideoFolder([fileName]);
    expect(await detectFinalAssets(folder)).toEqual({ ...allFalse, [assetKey]: true });
  });

  it("does not treat an unsupported container as the source video", async () => {
    const folder = await makeVideoFolder(["source.avi"]);
    expect(await detectFinalAssets(folder)).toEqual(allFalse);
  });

  it("ignores files that merely resemble the expected names", async () => {
    const folder = await makeVideoFolder(["video.mp4", "metadata.json", "transcript.txt"]);
    expect(await detectFinalAssets(folder)).toEqual(allFalse);
  });

  it("reports every asset present for a fully ingested folder", async () => {
    const folder = await makeVideoFolder([
      "metadata.info.json",
      "description.txt",
      "transcript.srt",
      "source.mov",
      "audio.wav",
      "thumbnail.jpg"
    ]);
    expect(await detectFinalAssets(folder)).toEqual({
      metadata: true,
      description: true,
      transcript: true,
      video: true,
      audio: true,
      thumbnail: true
    });
  });
});
