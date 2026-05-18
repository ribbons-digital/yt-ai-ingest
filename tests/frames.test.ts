import { describe, expect, it } from "vitest";
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
