import { describe, expect, it } from "vitest";
import { buildMlxWhisperArgs, buildWhisperArgs } from "../src/lib/transcribe.js";

describe("buildMlxWhisperArgs", () => {
  it("emits dash-style output flags targeting the srt format", () => {
    expect(buildMlxWhisperArgs("/tmp/video/audio.wav", "/tmp/video")).toEqual([
      "/tmp/video/audio.wav",
      "--output-dir",
      "/tmp/video",
      "--output-format",
      "srt"
    ]);
  });

  it("passes model and language through after the output flags", () => {
    expect(
      buildMlxWhisperArgs("/tmp/video/audio.wav", "/tmp/video", {
        model: "mlx-community/whisper-large-v3",
        language: "en"
      })
    ).toEqual([
      "/tmp/video/audio.wav",
      "--output-dir",
      "/tmp/video",
      "--output-format",
      "srt",
      "--model",
      "mlx-community/whisper-large-v3",
      "--language",
      "en"
    ]);
  });

  it("omits --model and --language when neither option is set", () => {
    const args = buildMlxWhisperArgs("/tmp/video/audio.wav", "/tmp/video");
    expect(args).not.toContain("--model");
    expect(args).not.toContain("--language");
  });

  it("passes model alone without adding a language flag", () => {
    expect(buildMlxWhisperArgs("/tmp/video/audio.wav", "/tmp/video", { model: "small" })).toEqual([
      "/tmp/video/audio.wav",
      "--output-dir",
      "/tmp/video",
      "--output-format",
      "srt",
      "--model",
      "small"
    ]);
  });

  it("passes language alone without adding a model flag", () => {
    expect(buildMlxWhisperArgs("/tmp/video/audio.wav", "/tmp/video", { language: "de" })).toEqual([
      "/tmp/video/audio.wav",
      "--output-dir",
      "/tmp/video",
      "--output-format",
      "srt",
      "--language",
      "de"
    ]);
  });
});

describe("buildWhisperArgs", () => {
  it("emits underscore-style output flags targeting the srt format", () => {
    expect(buildWhisperArgs("/tmp/video/audio.wav", "/tmp/video")).toEqual([
      "/tmp/video/audio.wav",
      "--output_dir",
      "/tmp/video",
      "--output_format",
      "srt"
    ]);
  });

  it("passes model and language through after the output flags", () => {
    expect(
      buildWhisperArgs("/tmp/video/audio.wav", "/tmp/video", { model: "large-v3", language: "en" })
    ).toEqual([
      "/tmp/video/audio.wav",
      "--output_dir",
      "/tmp/video",
      "--output_format",
      "srt",
      "--model",
      "large-v3",
      "--language",
      "en"
    ]);
  });

  it("omits --model and --language when neither option is set", () => {
    const args = buildWhisperArgs("/tmp/video/audio.wav", "/tmp/video");
    expect(args).not.toContain("--model");
    expect(args).not.toContain("--language");
  });
});

describe("whisper backend flag divergence", () => {
  it("mlx_whisper uses dashed flags while whisper uses underscored flags", () => {
    const mlx = buildMlxWhisperArgs("audio.wav", "/out");
    const whisper = buildWhisperArgs("audio.wav", "/out");

    expect(mlx).toContain("--output-dir");
    expect(mlx).toContain("--output-format");
    expect(mlx).not.toContain("--output_dir");
    expect(mlx).not.toContain("--output_format");

    expect(whisper).toContain("--output_dir");
    expect(whisper).toContain("--output_format");
    expect(whisper).not.toContain("--output-dir");
    expect(whisper).not.toContain("--output-format");
  });
});
