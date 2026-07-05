import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ingestStatusPath,
  readIngestStatus,
  type IngestStatus
} from "../src/commands/ingest.js";

describe("ingest-status", () => {
  it("produces correct path", () => {
    const statusPath = ingestStatusPath("/tmp/video-folder");
    expect(statusPath).toBe("/tmp/video-folder/ingest-status.json");
  });

  it("reads status file when it exists", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-status-"));
    const status: IngestStatus = {
      url: "https://youtube.example/watch?v=test",
      videoFolder,
      timestamp: new Date().toISOString(),
      assets: {
        metadata: true,
        description: true,
        transcript: true,
        video: false,
        audio: false,
        thumbnail: false
      },
      warnings: ["yt-dlp exited with code 1 but partial assets found (metadata, subtitles)"],
      source: { type: "youtube", url: "https://youtube.example/watch?v=test" }
    };
    await writeFile(ingestStatusPath(videoFolder), JSON.stringify(status, null, 2), "utf8");

    const read = await readIngestStatus(videoFolder);
    expect(read).toBeDefined();
    expect(read?.url).toBe("https://youtube.example/watch?v=test");
    expect(read?.assets.video).toBe(false);
    expect(read?.assets.metadata).toBe(true);
    expect(read?.warnings).toHaveLength(1);
  });

  it("returns undefined when status file does not exist", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-status-"));
    const read = await readIngestStatus(videoFolder);
    expect(read).toBeUndefined();
  });

  it("status file is valid JSON with expected fields", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-status-"));
    const raw: IngestStatus = {
      url: "https://youtube.example/watch?v=abc123",
      videoFolder,
      timestamp: "2026-05-22T12:00:00.000Z",
      assets: {
        metadata: true,
        description: true,
        transcript: false,
        video: true,
        audio: true,
        thumbnail: true
      },
      warnings: [],
      source: { type: "youtube", url: "https://youtube.example/watch?v=abc123" }
    };

    await writeFile(ingestStatusPath(videoFolder), JSON.stringify(raw, null, 2), "utf8");

    const fileContent = await readFile(ingestStatusPath(videoFolder), "utf8");
    const parsed = JSON.parse(fileContent);

    expect(parsed).toHaveProperty("url");
    expect(parsed).toHaveProperty("videoFolder");
    expect(parsed).toHaveProperty("timestamp");
    expect(parsed).toHaveProperty("assets");
    expect(parsed).toHaveProperty("warnings");
    expect(parsed.assets.video).toBe(true);
    expect(parsed.assets.transcript).toBe(false);
  });
});
