import { describe, expect, it } from "vitest";
import { getDependencyVersionArgs } from "../src/lib/dependencies.js";

describe("getDependencyVersionArgs", () => {
  it("uses the ffmpeg-supported version flag for ffmpeg tools", () => {
    expect(getDependencyVersionArgs("ffmpeg")).toEqual(["-version"]);
    expect(getDependencyVersionArgs("ffprobe")).toEqual(["-version"]);
  });

  it("uses --version for other CLI tools", () => {
    expect(getDependencyVersionArgs("yt-dlp")).toEqual(["--version"]);
  });
});
