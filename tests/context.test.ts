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
});
