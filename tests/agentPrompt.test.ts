import { describe, expect, it } from "vitest";
import { ingestedFolderAgentPrompt, preparedFolderAgentPrompt } from "../src/lib/agentPrompt.js";

describe("preparedFolderAgentPrompt", () => {
  it("points agents at the summary prompt and visual scout artifacts", () => {
    const prompt = preparedFolderAgentPrompt("/tmp/video-folder");

    expect(prompt).toContain("analysis/summary-input.md");
    expect(prompt).toContain("analysis/visual-context.md");
    expect(prompt).toContain("frames/scout/contact_sheet.jpg");
    expect(prompt).toContain("transcript.srt or transcript.vtt");
    expect(prompt).toContain("Video folder: /tmp/video-folder");
  });
});

describe("ingestedFolderAgentPrompt", () => {
  it("tells users to create scout and summary context before agent analysis", () => {
    const prompt = ingestedFolderAgentPrompt("/tmp/video folder");

    expect(prompt).toContain('ytai scout "/tmp/video folder"');
    expect(prompt).toContain('ytai summarize "/tmp/video folder"');
    expect(prompt).toContain("frames/scout/contact_sheet.jpg");
    expect(prompt).toContain("Video folder: /tmp/video folder");
  });
});
