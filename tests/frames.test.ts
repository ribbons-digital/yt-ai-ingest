import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { frames } from "../src/commands/frames.js";
import { chooseFrameExtractionMode } from "../src/lib/frameMode.js";

describe("chooseFrameExtractionMode", () => {
  it("uses seek for one range in auto mode", () => {
    expect(
      chooseFrameExtractionMode({
        requestedMode: "auto",
        durationSeconds: 600,
        ranges: [{ start: 10, end: 20, input: "00:10-00:20" }]
      })
    ).toBe("seek");
  });

  it("uses select when ranges are close together", () => {
    expect(
      chooseFrameExtractionMode({
        requestedMode: "auto",
        durationSeconds: 900,
        ranges: [
          { start: 100, end: 110, input: "01:40-01:50" },
          { start: 140, end: 150, input: "02:20-02:30" }
        ]
      })
    ).toBe("select");
  });

  it("uses seek for far-apart ranges in a long video", () => {
    expect(
      chooseFrameExtractionMode({
        requestedMode: "auto",
        durationSeconds: 7200,
        ranges: [
          { start: 100, end: 120, input: "01:40-02:00" },
          { start: 5000, end: 5020, input: "01:23:20-01:23:40" }
        ]
      })
    ).toBe("seek");
  });

  it("honors explicit modes", () => {
    expect(
      chooseFrameExtractionMode({
        requestedMode: "select",
        durationSeconds: 7200,
        ranges: [{ start: 100, end: 120, input: "01:40-02:00" }]
      })
    ).toBe("select");
  });
});

describe("frames", () => {
  it("plans select-mode extraction in dry-run mode", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-frames-"));
    await writeFile(path.join(videoFolder, "source.mp4"), "", "utf8");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      await frames(videoFolder, {
        dryRun: true,
        quiet: true,
        around: "00:10",
        window: 5,
        fps: 1,
        ranges: [],
        mode: "select"
      });
      expect(log.mock.calls.some(([line]) => String(line).includes("ffmpeg"))).toBe(true);
      expect(log.mock.calls.some(([line]) => String(line).includes("select="))).toBe(true);
    } finally {
      log.mockRestore();
    }
  });

  it("requires at least one timestamp or range", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-frames-"));
    await writeFile(path.join(videoFolder, "source.mp4"), "", "utf8");

    await expect(
      frames(videoFolder, {
        dryRun: true,
        quiet: true,
        window: 5,
        fps: 1,
        ranges: [],
        mode: "seek"
      })
    ).rejects.toThrow("Provide --around TIMESTAMP or at least one --range START-END.");
  });
});
