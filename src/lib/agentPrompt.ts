import type { IngestedAssets } from "../commands/ingest.js";
import path from "node:path";

export function preparedFolderAgentPrompt(videoFolder: string): string {
  return [
    "Please analyze this ytai video folder and produce a detailed, evidence-based summary.",
    "",
    "Start with analysis/summary-input.md. Then inspect analysis/visual-context.md,",
    "frames/scout/contact_sheet.jpg, and any relevant individual images in",
    "frames/scout/. Use transcript.srt or transcript.vtt for timestamped evidence.",
    "Pay special attention to visual material such as charts, slides, diagrams,",
    "screenshots, UI demos, and text shown on screen.",
    "",
    "When summarizing, combine transcript evidence with visual evidence. Cite",
    "timestamps where possible. If a visual frame changes or clarifies the transcript,",
    "mention that explicitly.",
    "",
    `Video folder: ${videoFolder}`
  ].join("\n");
}

export function degradedFolderAgentPrompt(
  videoFolder: string,
  assets: IngestedAssets
): string {
  const lines = [
    "Please analyze this ytai video folder and produce a summary based on the available evidence.",
    ""
  ];

  if (assets.transcript) {
    lines.push(
      "Start with analysis/summary-input.md which contains the transcript and metadata."
    );
  } else if (assets.description || assets.metadata) {
    lines.push(
      "Start with analysis/summary-input.md which contains description and metadata. No transcript is available."
    );
  } else {
    lines.push("Limited context available. Start with analysis/summary-input.md.");
  }

  lines.push("");

  if (!assets.video) {
    lines.push(
      "⚠️ No video was downloaded (likely due to rate limiting). Visual evidence such as charts, slides, diagrams, and on-screen text is NOT available."
    );
    lines.push(
      "Do not claim to have seen any visuals. Base your analysis solely on the text sources provided."
    );
  }

  if (!assets.transcript) {
    lines.push("⚠️ No transcript is available. Timestamps cannot be cited.");
  }

  lines.push("");
  lines.push(`Video folder: ${videoFolder}`);

  return lines.join("\n");
}

export function ingestedFolderAgentPrompt(videoFolder: string): string {
  return [
    "For the best AI-agent summary, first create visual and summary context:",
    "",
    `ytai scout ${quotePath(videoFolder)}`,
    `ytai summarize ${quotePath(videoFolder)}`,
    "",
    "Then ask the agent to analyze the whole folder, starting with",
    "analysis/summary-input.md and then inspecting analysis/visual-context.md,",
    "frames/scout/contact_sheet.jpg, frames/scout/, and transcript.srt or transcript.vtt.",
    "",
    `Video folder: ${videoFolder}`
  ].join("\n");
}

function quotePath(value: string): string {
  const normalized = path.normalize(value);
  return /\s/.test(normalized) ? JSON.stringify(normalized) : normalized;
}
