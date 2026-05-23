import { describe, expect, it } from "vitest";
import { chunkTranscript, formatChunkIndex } from "../src/lib/transcriptChunks.js";

/** Helper: generate a VTT transcript with cues spanning `totalMin` minutes, ~1 cue per minute */
function makeVtt(totalMin: number): string {
  const lines: string[] = ["WEBVTT", ""];
  for (let i = 0; i < totalMin; i++) {
    const m = i.toString().padStart(2, "0");
    const mNext = (i + 1).toString().padStart(2, "0");
    const text = `This is the content for minute ${i + 1}. It discusses important topics. `.repeat(5);
    lines.push(`${m}:00.000 --> ${mNext}:00.000`);
    lines.push(text);
    lines.push("");
  }
  return lines.join("\n");
}

/** Helper: generate an SRT transcript */
function makeSrt(totalMin: number): string {
  const lines: string[] = [];
  for (let i = 0; i < totalMin; i++) {
    const m = i.toString().padStart(2, "0");
    const mNext = (i + 1).toString().padStart(2, "0");
    const text = `SRT content for minute ${i + 1}. `.repeat(5);
    lines.push(`${i + 1}`);
    lines.push(`${m}:00,000 --> ${mNext}:00,000`);
    lines.push(text);
    lines.push("");
  }
  return lines.join("\n");
}

describe("chunkTranscript", () => {
  it("returns empty chunks for empty transcript", () => {
    const result = chunkTranscript("WEBVTT\n\n");
    expect(result.chunks).toEqual([]);
    expect(result.totalSec).toBe(0);
    expect(result.totalChunks).toBe(0);
  });

  it("chunks a short VTT transcript into 1 chunk", () => {
    const vtt = makeVtt(3);
    const result = chunkTranscript(vtt, { chunkSec: 300 });
    expect(result.totalChunks).toBe(1);
    expect(result.totalSec).toBe(180); // 3 min
    expect(result.chunks[0]!.startLabel).toBe("00:00");
    expect(result.chunks[0]!.endLabel).toBe("03:00");
  });

  it("chunks a 15-minute VTT into 3 chunks (300s each)", () => {
    const vtt = makeVtt(15);
    const result = chunkTranscript(vtt, { chunkSec: 300 });
    expect(result.totalChunks).toBe(3);
    expect(result.totalSec).toBe(900);
    expect(result.chunks[0]!.startLabel).toBe("00:00");
    expect(result.chunks[0]!.endLabel).toBe("05:00");
    expect(result.chunks[1]!.startLabel).toBe("05:00");
    expect(result.chunks[1]!.endLabel).toBe("10:00");
    expect(result.chunks[2]!.startLabel).toBe("10:00");
    expect(result.chunks[2]!.endLabel).toBe("15:00");
  });

  it("chunks a 60-minute VTT into 12 chunks", () => {
    const vtt = makeVtt(60);
    const result = chunkTranscript(vtt, { chunkSec: 300 });
    expect(result.totalChunks).toBe(12);
    expect(result.totalSec).toBe(3600);
    // Verify the last chunk covers the end
    expect(result.chunks[11]!.endLabel).toBe("1:00:00");
  });

  it("respects custom chunkSec", () => {
    const vtt = makeVtt(20);
    const result = chunkTranscript(vtt, { chunkSec: 600 }); // 10-min chunks
    expect(result.totalChunks).toBe(2);
  });

  it("respects custom previewChars", () => {
    const vtt = makeVtt(3);
    const result = chunkTranscript(vtt, { previewChars: 50 });
    expect(result.chunks[0]!.textPreview.length).toBeLessThanOrEqual(51); // 50 + "…"
  });

  it("strips HTML/VTT tags from text", () => {
    const vtt = `WEBVTT

00:00.000 --> 00:30.000
<v Speaker>Hello <b>world</b></v>

00:30.000 --> 01:00.000
<i>Italic text</i> here
`;
    const result = chunkTranscript(vtt);
    const text = result.chunks[0]!.textPreview;
    expect(text).not.toContain("<v ");
    expect(text).not.toContain("<b>");
    expect(text).not.toContain("</b>");
    expect(text).not.toContain("<i>");
    expect(text).toContain("Hello world");
    expect(text).toContain("Italic text");
  });

  it("parses SRT format (comma decimal separator)", () => {
    const srt = makeSrt(6);
    const result = chunkTranscript(srt, { chunkSec: 300 });
    expect(result.totalChunks).toBeGreaterThanOrEqual(1);
    expect(result.chunks[0]!.textPreview).toContain("SRT content");
  });

  it("handles HH:MM:SS format in VTT", () => {
    const vtt = `WEBVTT

01:00:00.000 --> 01:05:00.000
Content at hour one

01:05:00.000 --> 01:10:00.000
More content at hour one
`;
    const result = chunkTranscript(vtt, { chunkSec: 600 });
    expect(result.chunks[0]!.startLabel).toBe("1:00:00");
    expect(result.chunks[0]!.endLabel).toBe("1:05:00");
  });

  it("includes CJK characters without issues", () => {
    const vtt = `WEBVTT

00:00.000 --> 01:00.000
這是一個投資分析的影片，我們會討論風險管理和投資標的。

01:00.000 --> 02:00.000
後半段會深入分析市場趨勢和財務指標。
`;
    const result = chunkTranscript(vtt);
    expect(result.chunks[0]!.textPreview).toContain("投資分析");
    expect(result.chunks[0]!.textPreview).toContain("風險管理");
    expect(result.chunks[0]!.textPreview).toContain("財務指標");
  });
});

describe("formatChunkIndex", () => {
  it("returns a helpful message for empty chunks", () => {
    const result = chunkTranscript("WEBVTT\n\n");
    const output = formatChunkIndex(result);
    expect(output).toContain("could not be parsed");
  });

  it("produces structured markdown with chunk headers", () => {
    const vtt = makeVtt(15);
    const result = chunkTranscript(vtt, { chunkSec: 300 });
    const output = formatChunkIndex(result);
    expect(output).toContain("15:00");
    expect(output).toContain("3 chunk");
    expect(output).toContain("### Transcript Chunks");
    expect(output).toContain("#### Chunk 1: 00:00 → 05:00");
    expect(output).toContain("#### Chunk 2: 05:00 → 10:00");
    expect(output).toContain("#### Chunk 3: 10:00 → 15:00");
  });

  it("includes content preview for each chunk", () => {
    const vtt = makeVtt(15);
    const result = chunkTranscript(vtt, { chunkSec: 300 });
    const output = formatChunkIndex(result);
    // Each chunk should have text preview
    expect(output).toContain("minute 1");
    expect(output).toContain("minute 6");
    expect(output).toContain("minute 11");
  });
});
