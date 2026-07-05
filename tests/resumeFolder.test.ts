import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
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

import { resolveResumeIngestFolder } from "../src/commands/ingest.js";
import { runCommand } from "../src/lib/process.js";

async function writeYoutubeStatusFolder(outDir: string, folderName: string, url: string): Promise<string> {
  const videoFolder = path.join(outDir, folderName);
  await mkdir(videoFolder);
  await writeFile(
    path.join(videoFolder, "ingest-status.json"),
    JSON.stringify({
      url,
      videoFolder,
      timestamp: "2026-01-01T00:00:00.000Z",
      assets: {
        metadata: true,
        description: true,
        transcript: true,
        video: false,
        audio: false,
        thumbnail: false
      },
      warnings: [],
      source: { type: "youtube", url }
    }),
    "utf8"
  );
  return videoFolder;
}

describe("resolveResumeIngestFolder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("finds an existing YouTube ingest using real metadata instead of dry-run placeholders", async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), "ytai-resume-folder-"));
    const url = "https://youtube.example/watch?v=abc123";
    const existingFolder = await writeYoutubeStatusFolder(outDir, "2026-01-01_real-title_abc123", url);

    vi.mocked(runCommand).mockResolvedValue({
      stdout: JSON.stringify({ id: "abc123", title: "Real Title", webpage_url: url }),
      stderr: "",
      code: 0
    });

    await expect(
      resolveResumeIngestFolder(url, {
        dryRun: true,
        outDir,
        quiet: true
      })
    ).resolves.toBe(existingFolder);
  });

  it("falls back to the metadata id suffix when the stored URL differs", async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), "ytai-resume-folder-"));
    const url = "https://youtu.be/abc123";
    const existingFolder = await writeYoutubeStatusFolder(
      outDir,
      "2026-01-01_real-title_abc123",
      "https://www.youtube.com/watch?v=abc123"
    );

    vi.mocked(runCommand).mockResolvedValue({
      stdout: JSON.stringify({ id: "abc123", title: "Real Title", webpage_url: url }),
      stderr: "",
      code: 0
    });

    await expect(
      resolveResumeIngestFolder(url, {
        dryRun: true,
        outDir,
        quiet: true
      })
    ).resolves.toBe(existingFolder);
  });
});
