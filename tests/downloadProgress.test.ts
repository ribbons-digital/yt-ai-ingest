import { describe, expect, it } from "vitest";
import { parseYtDlpDownloadProgress } from "../src/commands/ingest.js";

describe("parseYtDlpDownloadProgress", () => {
  it("extracts percentage progress from yt-dlp download output", () => {
    expect(
      parseYtDlpDownloadProgress("[download]  38.8% of  855.50MiB at  Unknown B/s")
    ).toBe(38.8);
  });

  it("rounds complete downloads to 100 percent", () => {
    expect(parseYtDlpDownloadProgress("[download] 100% of  855.50MiB in 00:00:14")).toBe(100);
  });

  it("ignores non-progress download lines", () => {
    expect(parseYtDlpDownloadProgress("[download] Destination: source.mp4")).toBeUndefined();
  });
});
