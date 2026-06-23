import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { summarize } from "../src/commands/context.js";

describe("summarize", () => {
  it("includes scout visual context when it exists", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-context-"));
    await mkdir(path.join(videoFolder, "analysis"), { recursive: true });
    await writeFile(path.join(videoFolder, "metadata.info.json"), '{"title":"Demo"}', "utf8");
    await writeFile(path.join(videoFolder, "transcript.srt"), "00:00:01 demo transcript", "utf8");
    await writeFile(
      path.join(videoFolder, "analysis", "visual-context.md"),
      "# Visual Scout Context\n\n- 00:00:00 frames/scout/frame_0001.jpg\n",
      "utf8"
    );
    await writeFile(
      path.join(videoFolder, "analysis", "scout-manifest.json"),
      '{"moments":[]}',
      "utf8"
    );

    await summarize(videoFolder);

    const output = await readFile(path.join(videoFolder, "analysis", "summary-input.md"), "utf8");
    expect(output).toContain("## Visual Context");
    expect(output).toContain("frames/scout/frame_0001.jpg");
    expect(output).toContain("## Scout Manifests");
    expect(output).toContain("analysis/scout-manifest.json");
  });

  it("includes source provenance with all assets available", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-context-"));
    await mkdir(path.join(videoFolder, "analysis"), { recursive: true });
    await writeFile(path.join(videoFolder, "metadata.info.json"), '{"title":"Demo"}', "utf8");
    await writeFile(path.join(videoFolder, "transcript.srt"), "00:00:01 demo transcript", "utf8");
    await writeFile(path.join(videoFolder, "description.txt"), "A demo video", "utf8");
    await writeFile(
      path.join(videoFolder, "analysis", "visual-context.md"),
      "# Visual Scout Context\n",
      "utf8"
    );

    await summarize(videoFolder);

    const output = await readFile(path.join(videoFolder, "analysis", "summary-input.md"), "utf8");
    expect(output).toContain("## Source Provenance");
    expect(output).toContain("✅ **Transcript**");
    expect(output).toContain("✅ **Description**");
    expect(output).toContain("✅ **Metadata**");
    expect(output).toContain("✅ **Visual scout**");
    expect(output).not.toContain("Enhanced temporal scout");
  });

  it("includes enhanced temporal context when it exists", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-context-"));
    await mkdir(path.join(videoFolder, "analysis"), { recursive: true });
    await writeFile(path.join(videoFolder, "metadata.info.json"), '{"title":"Demo"}', "utf8");
    await writeFile(path.join(videoFolder, "transcript.srt"), "00:00:01 demo transcript", "utf8");
    await writeFile(
      path.join(videoFolder, "analysis", "temporal-context.md"),
      "# Enhanced Temporal Scout Context\n\n- 00:00:01: frames/scout/temporal/block_0001/strip.jpg\n",
      "utf8"
    );
    await writeFile(
      path.join(videoFolder, "analysis", "temporal-manifest.json"),
      '{"blocks":[]}',
      "utf8"
    );

    await summarize(videoFolder);

    const output = await readFile(path.join(videoFolder, "analysis", "summary-input.md"), "utf8");
    expect(output).toContain("✅ **Enhanced temporal scout**");
    expect(output).toContain("## Temporal Context");
    expect(output).toContain("frames/scout/temporal/block_0001/strip.jpg");
    expect(output).toContain("## Temporal Manifests");
    expect(output).toContain("analysis/temporal-manifest.json");
  });

  it("warns in provenance when transcript is missing", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-context-"));
    await mkdir(path.join(videoFolder, "analysis"), { recursive: true });
    await writeFile(path.join(videoFolder, "metadata.info.json"), '{"title":"Demo"}', "utf8");
    await writeFile(path.join(videoFolder, "description.txt"), "A demo video", "utf8");

    await summarize(videoFolder);

    const output = await readFile(path.join(videoFolder, "analysis", "summary-input.md"), "utf8");
    expect(output).toContain("❌ **Transcript**");
    expect(output).toContain("Transcript missing");
    expect(output).toContain("Summary is based on description and metadata only");
  });

  it("uses chunked transcript for long VTT files", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-context-"));
    await mkdir(path.join(videoFolder, "analysis"), { recursive: true });
    await writeFile(path.join(videoFolder, "metadata.info.json"), '{"title":"Long Video"}', "utf8");

    // Create a 30-minute VTT transcript (> 16K chars, triggers chunking)
    const vttLines = ["WEBVTT", ""];
    for (let i = 0; i < 30; i++) {
      const m = i.toString().padStart(2, "0");
      const mNext = (i + 1).toString().padStart(2, "0");
      const text = `This is the transcript content for minute ${i + 1}. `.repeat(20);
      vttLines.push(`${m}:00.000 --> ${mNext}:00.000`);
      vttLines.push(text);
      vttLines.push("");
    }
    await writeFile(path.join(videoFolder, "transcript.vtt"), vttLines.join("\n"), "utf8");

    await summarize(videoFolder);

    const output = await readFile(path.join(videoFolder, "analysis", "summary-input.md"), "utf8");
    expect(output).toContain("## Transcript");
    expect(output).toContain("### Transcript Chunks");
    expect(output).toContain("#### Chunk 1:");
    // Should cover the full duration, not just the beginning
    expect(output).toContain("spans **30:00**");
    expect(output).toContain("across **6 chunk(s)**");
    // Verify the last chunk is included (proves we cover the full video)
    expect(output).toContain("Chunk 6: 25:00 → 30:00");
  });

  it("includes full raw transcript for short files (under 16K)", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-context-"));
    await mkdir(path.join(videoFolder, "analysis"), { recursive: true });
    await writeFile(
      path.join(videoFolder, "transcript.srt"),
      "1\n00:00:01,000 --> 00:00:05,000\nShort transcript only.\n",
      "utf8"
    );

    await summarize(videoFolder);

    const output = await readFile(path.join(videoFolder, "analysis", "summary-input.md"), "utf8");
    expect(output).toContain("Short transcript only.");
    // Should NOT have chunk headers for short transcripts
    expect(output).not.toContain("### Transcript Chunks");
  });
});
