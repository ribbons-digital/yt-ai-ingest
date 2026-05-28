import { describe, expect, it } from "vitest";
import { buildYtDlpArgs } from "../src/commands/ingest.js";

describe("buildYtDlpArgs", () => {
  it("includes rate-limit flags when --rate-limit is set", () => {
    const args = buildYtDlpArgs("https://example.com", "/tmp/folder", {
      outDir: "/tmp",
      rateLimit: true
    });
    expect(args).toContain("--sleep-requests");
    expect(args).toContain("1");
    expect(args).toContain("--max-sleep-interval");
    expect(args).toContain("5");
    expect(args).toContain("--retries");
    expect(args).toContain("10");
    expect(args).toContain("--fragment-retries");
    expect(args).toContain("10");
  });

  it("does not include rate-limit flags by default", () => {
    const args = buildYtDlpArgs("https://example.com", "/tmp/folder", {
      outDir: "/tmp"
    });
    expect(args).not.toContain("--sleep-requests");
    expect(args).not.toContain("--sleep-interval");
    expect(args).not.toContain("--max-sleep-interval");
  });

  it("includes --cookies-from-browser when set", () => {
    const args = buildYtDlpArgs("https://example.com", "/tmp/folder", {
      outDir: "/tmp",
      cookiesFromBrowser: "chrome"
    });
    expect(args).toContain("--cookies-from-browser");
    expect(args).toContain("chrome");
  });

  it("includes --cookies when path is set", () => {
    const args = buildYtDlpArgs("https://example.com", "/tmp/folder", {
      outDir: "/tmp",
      cookiesPath: "/path/to/cookies.txt"
    });
    expect(args).toContain("--cookies");
    expect(args).toContain("/path/to/cookies.txt");
  });

  it("combines rate-limit and cookies flags", () => {
    const args = buildYtDlpArgs("https://example.com", "/tmp/folder", {
      outDir: "/tmp",
      rateLimit: true,
      cookiesFromBrowser: "safari"
    });
    expect(args).toContain("--cookies-from-browser");
    expect(args).toContain("safari");
    expect(args).toContain("--sleep-requests");
  });

  it("transcript-only mode does not include video format flags", () => {
    const args = buildYtDlpArgs("https://example.com", "/tmp/folder", {
      outDir: "/tmp",
      transcriptOnly: true
    });
    expect(args).toContain("--skip-download");
    expect(args).not.toContain("bv*");
    expect(args).not.toContain("--merge-output-format");
    expect(args).not.toContain("--write-thumbnail");
    expect(args).toContain("--write-info-json");
    expect(args).toContain("--write-subs");
  });

  it("defaults video downloads to the best mp4 stream at or below 1080p", () => {
    const args = buildYtDlpArgs("https://example.com", "/tmp/folder", {
      outDir: "/tmp"
    });
    const formatIndex = args.indexOf("-f");

    expect(formatIndex).toBeGreaterThanOrEqual(0);
    expect(args[formatIndex + 1]).toBe(
      "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/best[height<=1080]/best"
    );
  });

  it("requests newline progress output so downloads can render a progress bar", () => {
    const args = buildYtDlpArgs("https://example.com", "/tmp/folder", {
      outDir: "/tmp"
    });

    expect(args).toContain("--newline");
  });

  it("does not cap transcript-only requests because no video is downloaded", () => {
    const args = buildYtDlpArgs("https://example.com", "/tmp/folder", {
      outDir: "/tmp",
      transcriptOnly: true
    });

    expect(args.join(" ")).not.toContain("height<=1080");
  });

  it("transcript-only mode still supports rate-limit and cookies", () => {
    const args = buildYtDlpArgs("https://example.com", "/tmp/folder", {
      outDir: "/tmp",
      transcriptOnly: true,
      rateLimit: true,
      cookiesFromBrowser: "chrome"
    });
    expect(args).toContain("--skip-download");
    expect(args).toContain("--cookies-from-browser");
    expect(args).toContain("--sleep-requests");
  });
});
