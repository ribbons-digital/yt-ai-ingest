import { describe, expect, it } from "vitest";
import {
  degradedFolderAgentPrompt,
  ingestedFolderAgentPrompt,
  preparedFolderAgentPrompt
} from "../src/lib/agentPrompt.js";

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

describe("degradedFolderAgentPrompt", () => {
  it("warns about missing video and visual context", () => {
    const prompt = degradedFolderAgentPrompt("/tmp/video-folder", {
      metadata: true,
      description: true,
      transcript: true,
      video: false,
      audio: false,
      thumbnail: false
    });

    expect(prompt).toContain("No video was downloaded");
    expect(prompt).toContain("Do not claim to have seen any visuals");
    expect(prompt).toContain("Video folder: /tmp/video-folder");
  });

  it("warns about missing transcript when no transcript exists", () => {
    const prompt = degradedFolderAgentPrompt("/tmp/video-folder", {
      metadata: true,
      description: true,
      transcript: false,
      video: false,
      audio: false,
      thumbnail: false
    });

    expect(prompt).toContain("No transcript is available");
    expect(prompt).toContain("description and metadata");
  });
});
