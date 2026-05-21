import { describe, expect, it } from "vitest";
import { buildScoutTimeline } from "../src/lib/scoutPlan.js";

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
