import { describe, expect, it } from "vitest";
import {
  formatSeconds,
  parseRange,
  parseTimestamp,
  rangeAround
} from "../src/lib/timestamps.js";

describe("parseTimestamp", () => {
  it("parses seconds, minute-second, and hour-minute-second values", () => {
    expect(parseTimestamp("42")).toBe(42);
    expect(parseTimestamp("03:20")).toBe(200);
    expect(parseTimestamp("5:10")).toBe(310);
    expect(parseTimestamp("01:02:03")).toBe(3723);
    expect(parseTimestamp("00:05:20")).toBe(320);
  });

  it("rejects malformed timestamps", () => {
    expect(() => parseTimestamp("")).toThrow(/Timestamp is required/);
    expect(() => parseTimestamp("1:99")).toThrow(/must be between 0 and 59/);
    expect(() => parseTimestamp("1:2:3:4")).toThrow(/Expected SS, MM:SS, or HH:MM:SS/);
    expect(() => parseTimestamp("abc")).toThrow(/numeric/);
  });
});

describe("parseRange", () => {
  it("parses a timestamp range into seconds", () => {
    expect(parseRange("00:05:20-00:05:40")).toEqual({
      start: 320,
      end: 340,
      input: "00:05:20-00:05:40"
    });
    expect(parseRange("5:20-5:40")).toEqual({
      start: 320,
      end: 340,
      input: "5:20-5:40"
    });
  });

  it("rejects backwards or zero-length ranges", () => {
    expect(() => parseRange("00:10-00:10")).toThrow(/after start/);
    expect(() => parseRange("00:11-00:10")).toThrow(/after start/);
  });
});

describe("formatSeconds", () => {
  it("normalizes seconds for ffmpeg-compatible timestamps", () => {
    expect(formatSeconds(0)).toBe("00:00:00");
    expect(formatSeconds(200)).toBe("00:03:20");
    expect(formatSeconds(3723)).toBe("01:02:03");
  });
});

describe("rangeAround", () => {
  it("creates a clamped range around a timestamp", () => {
    expect(rangeAround("00:00:05", 20)).toEqual({
      start: 0,
      end: 25,
      input: "00:00:00-00:00:25"
    });
  });
});
