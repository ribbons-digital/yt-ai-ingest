import { describe, expect, it } from "vitest";
import { buildScoutTimeline, buildTemporalPlan } from "../src/lib/scoutPlan.js";

describe("buildScoutTimeline", () => {
  it("creates evenly spaced visual moments for short videos", () => {
    expect(
      buildScoutTimeline({
        durationSeconds: 125,
        intervalSeconds: 60
      })
    ).toEqual([
      {
        index: 1,
        timestampSeconds: 0,
        timestamp: "00:00:00",
        frame: "frame_0001.jpg",
        reason: "interval"
      },
      {
        index: 2,
        timestampSeconds: 60,
        timestamp: "00:01:00",
        frame: "frame_0002.jpg",
        reason: "interval"
      },
      {
        index: 3,
        timestampSeconds: 120,
        timestamp: "00:02:00",
        frame: "frame_0003.jpg",
        reason: "interval"
      },
      {
        index: 4,
        timestampSeconds: 124,
        timestamp: "00:02:04",
        frame: "frame_0004.jpg",
        reason: "end"
      }
    ]);
  });

  it("uses the last decodable second for the final end moment", () => {
    expect(
      buildScoutTimeline({
        durationSeconds: 120,
        intervalSeconds: 60
      }).map((moment) => moment.timestampSeconds)
    ).toEqual([0, 60, 119]);
  });

  it("enforces a minimum interval", () => {
    expect(() =>
      buildScoutTimeline({
        durationSeconds: 120,
        intervalSeconds: 0
      })
    ).toThrow(/interval must be greater than 0/);
  });
});

describe("buildTemporalPlan", () => {
  it("builds a centered four-frame block for a normal scout moment", () => {
    const [block] = buildTemporalPlan({
      durationSeconds: 120,
      blockFrameCount: 4,
      moments: [
        {
          index: 1,
          timestampSeconds: 60,
          timestamp: "00:01:00",
          frame: "frame_0001.jpg",
          reason: "interval"
        }
      ]
    });

    expect(block).toMatchObject({
      index: 1,
      centerTimestampSeconds: 60,
      centerTimestamp: "00:01:00",
      startSeconds: 59,
      endSeconds: 62,
      frameTimestamps: [59, 60, 61, 62],
      frameTimestampLabels: ["00:00:59", "00:01:00", "00:01:01", "00:01:02"],
      scoutFrame: "frame_0001.jpg",
      reason: "interval"
    });
  });

  it("shifts start-boundary blocks into the video range", () => {
    const [block] = buildTemporalPlan({
      durationSeconds: 120,
      blockFrameCount: 4,
      moments: [
        {
          index: 1,
          timestampSeconds: 0,
          timestamp: "00:00:00",
          frame: "frame_0001.jpg",
          reason: "interval"
        }
      ]
    });

    expect(block.frameTimestamps).toEqual([0, 1, 2, 3]);
    expect(block.startSeconds).toBe(0);
    expect(block.endSeconds).toBe(3);
  });

  it("shifts end-boundary blocks into the video range", () => {
    const [block] = buildTemporalPlan({
      durationSeconds: 120,
      blockFrameCount: 4,
      moments: [
        {
          index: 1,
          timestampSeconds: 119,
          timestamp: "00:01:59",
          frame: "frame_0001.jpg",
          reason: "end"
        }
      ]
    });

    expect(block.frameTimestamps).toEqual([116, 117, 118, 119]);
    expect(block.startSeconds).toBe(116);
    expect(block.endSeconds).toBe(119);
    expect(block.reason).toBe("end");
  });

  it("uses all available unique timestamps for very short videos", () => {
    const [block] = buildTemporalPlan({
      durationSeconds: 2,
      blockFrameCount: 4,
      moments: [
        {
          index: 1,
          timestampSeconds: 0,
          timestamp: "00:00:00",
          frame: "frame_0001.jpg",
          reason: "interval"
        }
      ]
    });

    expect(block.frameTimestamps).toEqual([0, 1]);
    expect(block.frameTimestampLabels).toEqual(["00:00:00", "00:00:01"]);
  });

  it("returns integer timestamps only", () => {
    const blocks = buildTemporalPlan({
      durationSeconds: 5.9,
      blockFrameCount: 4,
      moments: [
        {
          index: 1,
          timestampSeconds: 2,
          timestamp: "00:00:02",
          frame: "frame_0001.jpg",
          reason: "interval"
        }
      ]
    });

    expect(blocks[0].frameTimestamps.every(Number.isInteger)).toBe(true);
  });

  it("allows overlapping blocks without merging adjacent moments", () => {
    const blocks = buildTemporalPlan({
      durationSeconds: 10,
      blockFrameCount: 4,
      moments: [
        {
          index: 1,
          timestampSeconds: 4,
          timestamp: "00:00:04",
          frame: "frame_0001.jpg",
          reason: "interval"
        },
        {
          index: 2,
          timestampSeconds: 5,
          timestamp: "00:00:05",
          frame: "frame_0002.jpg",
          reason: "interval"
        }
      ]
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[0].frameTimestamps).toEqual([3, 4, 5, 6]);
    expect(blocks[1].frameTimestamps).toEqual([4, 5, 6, 7]);
  });
});
