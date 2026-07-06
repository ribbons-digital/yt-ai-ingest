import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IngestStatus } from "../src/commands/ingest.js";
import type * as FilesModule from "../src/lib/files.js";
import type * as IngestModule from "../src/commands/ingest.js";
import type * as TranscribeLibModule from "../src/lib/transcribe.js";
import type * as UiModule from "../src/lib/ui.js";

vi.mock("../src/lib/files.js", async () => {
  const actual = await vi.importActual<typeof FilesModule>("../src/lib/files.js");
  return {
    ...actual,
    pathExists: vi.fn()
  };
});

vi.mock("../src/lib/transcribe.js", async () => {
  const actual = await vi.importActual<typeof TranscribeLibModule>("../src/lib/transcribe.js");
  return {
    ...actual,
    transcribeAudio: vi.fn()
  };
});

vi.mock("../src/commands/ingest.js", async () => {
  const actual = await vi.importActual<typeof IngestModule>("../src/commands/ingest.js");
  return {
    ...actual,
    readIngestStatus: vi.fn(),
    writeIngestStatus: vi.fn()
  };
});

vi.mock("../src/lib/ui.js", async () => {
  const actual = await vi.importActual<typeof UiModule>("../src/lib/ui.js");
  return {
    ...actual,
    skip: vi.fn(),
    success: vi.fn()
  };
});

import { transcribe } from "../src/commands/transcribe.js";
import { readIngestStatus, writeIngestStatus } from "../src/commands/ingest.js";
import { pathExists } from "../src/lib/files.js";
import { transcribeAudio } from "../src/lib/transcribe.js";
import { skip, success } from "../src/lib/ui.js";

const status: IngestStatus = {
  url: "/tmp/video.mp4",
  videoFolder: "/tmp/video-folder",
  timestamp: "2026-01-01T00:00:00.000Z",
  assets: {
    metadata: true,
    description: false,
    transcript: false,
    video: true,
    audio: true,
    thumbnail: true
  },
  warnings: [],
  source: { type: "local", originalPath: "/tmp/video.mp4" }
};

describe("transcribe command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(transcribeAudio).mockResolvedValue(undefined);
    vi.mocked(readIngestStatus).mockResolvedValue(undefined);
  });

  it("skips when a transcript already exists and force is not set", async () => {
    vi.mocked(pathExists).mockImplementation(async (target) => String(target).endsWith("transcript.srt"));

    await transcribe("/tmp/video-folder", {});

    expect(skip).toHaveBeenCalledWith("Transcript already exists", "use --force to transcribe again");
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("transcribes when force is set even if a transcript exists", async () => {
    vi.mocked(pathExists).mockResolvedValue(true);

    await transcribe("/tmp/video-folder", { force: true, whisperModel: "small", language: "en" });

    expect(transcribeAudio).toHaveBeenCalledWith("/tmp/video-folder", {
      dryRun: undefined,
      verbose: undefined,
      quiet: undefined,
      model: "small",
      language: "en"
    });
  });

  it("throws when audio.wav is missing outside dry-run", async () => {
    vi.mocked(pathExists).mockResolvedValue(false);

    await expect(transcribe("/tmp/video-folder", {})).rejects.toThrow(
      "No audio.wav found in /tmp/video-folder"
    );

    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("updates ingest status after successful transcription", async () => {
    vi.mocked(pathExists).mockImplementation(async (target) => String(target).endsWith("audio.wav"));
    vi.mocked(readIngestStatus).mockResolvedValue(structuredClone(status));

    await transcribe("/tmp/video-folder", {});

    expect(writeIngestStatus).toHaveBeenCalledWith(
      "/tmp/video-folder",
      "/tmp/video.mp4",
      { ...status.assets, transcript: true },
      [],
      status.source
    );
    expect(success).toHaveBeenCalledWith("Transcript", path.join("/tmp/video-folder", "transcript.srt"));
  });
});
