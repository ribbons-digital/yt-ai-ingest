import { describe, expect, it } from "vitest";
import {
  classifyYtDlpError,
  formatPartialDownloadWarning
} from "../src/commands/ingest.js";

describe("classifyYtDlpError", () => {
  it("classifies HTTP 429 rate limit", () => {
    const info = classifyYtDlpError("HTTP Error 429: Too Many Requests", 1);
    expect(info.category).toBe("rate_limit");
    expect(info.message).toContain("429");
    expect(info.suggestion).toContain("--cookies-from-browser");
    expect(info.suggestion).toContain("--rate-limit");
  });

  it("classifies video unavailable / 404", () => {
    const info = classifyYtDlpError("ERROR: Video unavailable", 1);
    expect(info.category).toBe("video_unavailable");
    expect(info.message).toContain("unavailable");
  });

  it("classifies age restriction", () => {
    const info = classifyYtDlpError("ERROR: Sign in to confirm your age", 1);
    expect(info.category).toBe("age_restricted");
    expect(info.suggestion).toContain("--cookies-from-browser");
  });

  it("classifies geo-block", () => {
    const info = classifyYtDlpError("ERROR: This video is not available in your country", 1);
    expect(info.category).toBe("geo_blocked");
    expect(info.suggestion).toContain("--proxy");
  });

  it("classifies no formats found", () => {
    const info = classifyYtDlpError("ERROR: No video formats found", 1);
    expect(info.category).toBe("no_formats");
    expect(info.suggestion).toContain("--transcript-only");
  });

  it("classifies network timeout", () => {
    const info = classifyYtDlpError("ERROR: Connection reset by peer", 1);
    expect(info.category).toBe("network_error");
    expect(info.suggestion).toContain("--rate-limit");
  });

  it("classifies HTTP 403 forbidden media downloads", () => {
    const info = classifyYtDlpError("ERROR: unable to download video data: HTTP Error 403: Forbidden", 1);
    expect(info.category).toBe("forbidden");
    expect(info.message).toContain("403");
    expect(info.suggestion).toContain("browser cookies");
  });

  it("classifies unknown errors with exit code", () => {
    const info = classifyYtDlpError("Some weird error", 42);
    expect(info.category).toBe("unknown");
    expect(info.message).toContain("42");
    expect(info.suggestion).toContain("retry");
  });
});

describe("formatPartialDownloadWarning", () => {
  it("includes the classified error and cookie-specific retry guidance", () => {
    const warning = formatPartialDownloadWarning({
      exitCode: 1,
      partialAssetsLabel: "metadata, subtitles",
      stderr: "ERROR: unable to download video data: HTTP Error 403: Forbidden",
      cookiesFromBrowser: "chrome"
    });

    expect(warning).toContain("partial assets found (metadata, subtitles)");
    expect(warning).toContain("Media request forbidden (HTTP 403)");
    expect(warning).toContain("Retry without --cookies-from-browser chrome");
  });
});
