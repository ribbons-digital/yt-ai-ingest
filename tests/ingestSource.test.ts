import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  classifySourceInput,
  ingestStatusPath,
  readIngestStatus,
  resumeIngest,
  type IngestedAssets
} from "../src/commands/ingest.js";

const partialAssets: IngestedAssets = {
  metadata: true,
  description: true,
  transcript: true,
  video: false,
  audio: false,
  thumbnail: false
};

async function writeLegacyStatus(videoFolder: string, warnings: string[] = []): Promise<void> {
  // Status files written before local ingest existed have no source field.
  const legacyStatus = {
    url: "https://youtube.example/watch?v=test",
    videoFolder,
    timestamp: "2026-05-22T12:00:00.000Z",
    assets: partialAssets,
    warnings
  };
  await writeFile(ingestStatusPath(videoFolder), JSON.stringify(legacyStatus, null, 2), "utf8");
}

describe("classifySourceInput", () => {
  it("classifies https URLs as url", () => {
    expect(classifySourceInput("https://youtube.com/watch?v=abc123")).toBe("url");
  });

  it("classifies http URLs as url", () => {
    expect(classifySourceInput("http://example.com/video")).toBe("url");
  });

  it("classifies uppercase scheme variants as url", () => {
    expect(classifySourceInput("HTTPS://EXAMPLE.COM/VIDEO")).toBe("url");
    expect(classifySourceInput("HtTp://example.com/video")).toBe("url");
  });

  it("trims surrounding whitespace before classifying", () => {
    expect(classifySourceInput("  https://example.com/video  ")).toBe("url");
  });

  it("classifies relative and absolute paths as local", () => {
    expect(classifySourceInput("./videos/talk.mp4")).toBe("local");
    expect(classifySourceInput("/Users/me/Movies/talk.mp4")).toBe("local");
  });

  it("classifies home-relative paths as local", () => {
    expect(classifySourceInput("~/Movies/talk.mp4")).toBe("local");
  });

  it("classifies file names containing colons as local", () => {
    expect(classifySourceInput("lecture 01: intro.mp4")).toBe("local");
    expect(classifySourceInput("C:\\videos\\talk.mp4")).toBe("local");
  });

  it("classifies non-http schemes as local", () => {
    expect(classifySourceInput("ftp://example.com/talk.mp4")).toBe("local");
  });
});

describe("readIngestStatus source back-compat", () => {
  it("defaults a missing source field to youtube with the stored url", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-source-compat-"));
    await writeLegacyStatus(videoFolder);

    const status = await readIngestStatus(videoFolder);
    expect(status).toBeDefined();
    expect(status?.source).toEqual({
      type: "youtube",
      url: "https://youtube.example/watch?v=test"
    });
  });

  it("preserves an explicit local source verbatim", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-source-compat-"));
    const source = { type: "local" as const, originalPath: "/Users/me/Movies/talk.mp4" };
    await writeFile(
      ingestStatusPath(videoFolder),
      JSON.stringify(
        {
          url: "local:talk.mp4",
          videoFolder,
          timestamp: "2026-05-22T12:00:00.000Z",
          assets: partialAssets,
          warnings: [],
          source
        },
        null,
        2
      ),
      "utf8"
    );

    const status = await readIngestStatus(videoFolder);
    expect(status?.source).toEqual(source);
  });
});

describe("resume dispatch by source type", () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  let logs: string[] = [];

  beforeEach(() => {
    logs = [];
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    console.warn = (...args: unknown[]) => logs.push(args.join(" "));
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
  });

  it("resumes a legacy status without source through the yt-dlp path", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-resume-compat-"));
    await writeLegacyStatus(videoFolder, ["previous warning"]);

    const result = await resumeIngest(videoFolder, {
      dryRun: true,
      quiet: true,
      outDir: videoFolder
    });

    const output = logs.join("\n");
    expect(output).toContain("yt-dlp");
    expect(output).toContain("https://youtube.example/watch?v=test");
    expect(result.videoFolder).toBe(videoFolder);
    expect(result.warnings).toEqual(["previous warning"]);
  });

  it("resumes a local-source status without invoking yt-dlp", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-resume-local-"));
    await writeFile(
      ingestStatusPath(videoFolder),
      JSON.stringify(
        {
          url: "local:talk.mp4",
          videoFolder,
          timestamp: "2026-05-22T12:00:00.000Z",
          assets: partialAssets,
          warnings: [],
          source: { type: "local" }
        },
        null,
        2
      ),
      "utf8"
    );

    const result = await resumeIngest(videoFolder, {
      dryRun: true,
      quiet: true,
      outDir: videoFolder
    });

    expect(logs.join("\n")).not.toContain("yt-dlp");
    expect(result.warnings).toEqual([
      "Source video is missing from the folder and no original path is recorded."
    ]);
    expect(result.assets.video).toBe(false);
  });
});
