import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { listFilesRecursive, pathExists } from "../lib/files.js";
import { chunkTranscript, formatChunkIndex } from "../lib/transcriptChunks.js";
import { info, success } from "../lib/ui.js";

type ContextOptions = {
  verbose?: boolean;
  quiet?: boolean;
};

/**
 * Maximum characters for the full summary-input.md transcript section.
 * When the full transcript fits, we include the chunked index covering
 * the entire duration. When it exceeds this, we still chunk but cap total output.
 */
const TRANSCRIPT_SECTION_BUDGET = 80000;

export async function summarize(videoFolder: string, options: ContextOptions = {}): Promise<void> {
  const context = await buildContext(videoFolder, undefined, options);
  const outPath = path.join(videoFolder, "analysis", "summary-input.md");
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, context, "utf8");
  if (!options.quiet) {
    success("Summary context written", outPath);
    info("No AI provider is wired yet. Send this file to an AI model when ready.");
  }
}

export async function ask(
  videoFolder: string,
  question: string,
  options: ContextOptions = {}
): Promise<void> {
  const context = await buildContext(videoFolder, question, options);
  const outPath = path.join(videoFolder, "analysis", "question-input.md");
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, context, "utf8");
  if (!options.quiet) {
    success("Question context written", outPath);
    info("No AI provider is wired yet. Send this file to an AI model when ready.");
  }
}

async function buildContext(
  videoFolder: string,
  question: string | undefined,
  options: ContextOptions
): Promise<string> {
  if (!(await pathExists(videoFolder))) {
    throw new Error(`Video folder does not exist: ${videoFolder}`);
  }

  const metadata = await readOptional(path.join(videoFolder, "metadata.info.json"));
  const description = await readOptional(path.join(videoFolder, "description.txt"));
  const transcriptRaw =
    (await readOptional(path.join(videoFolder, "transcript.srt"))) ??
    (await readOptional(path.join(videoFolder, "transcript.vtt")));
  const visualContext = await readOptional(path.join(videoFolder, "analysis", "visual-context.md"));
  const manifests = (await listFilesRecursive(videoFolder)).filter((file) =>
    file.endsWith("frames_manifest.json")
  );
  const scoutManifests = (await listFilesRecursive(videoFolder)).filter((file) =>
    file.endsWith("scout-manifest.json")
  );

  if (options.verbose) {
    console.error(`Loaded metadata: ${Boolean(metadata)}`);
    console.error(`Loaded description: ${Boolean(description)}`);
    console.error(`Loaded transcript: ${Boolean(transcriptRaw)} (${transcriptRaw?.length ?? 0} chars)`);
    console.error(`Loaded visual context: ${Boolean(visualContext)}`);
    console.error(`Found frame manifests: ${manifests.length}`);
    console.error(`Found scout manifests: ${scoutManifests.length}`);
  }

  const provenance = buildProvenance({
    metadata: Boolean(metadata),
    description: Boolean(description),
    transcript: Boolean(transcriptRaw),
    visualContext: Boolean(visualContext),
    scoutManifests: scoutManifests.length
  });

  const transcriptSection = transcriptRaw
    ? buildTranscriptSection(transcriptRaw)
    : "_No transcript.srt or transcript.vtt found._";

  return [
    "# YouTube AI Context",
    "",
    "## Source Provenance",
    "",
    provenance,
    "",
    question ? `## Question\n\n${question}\n` : "## Task\n\nSummarize this video using timestamps where possible.\n",
    "## Instructions",
    "",
    "- Use the transcript, metadata, and visual context as primary evidence.",
    "- Cite timestamps when they appear in the transcript, frame manifests, or scout manifests.",
    "- If evidence is missing, say what local asset should be generated next.",
    "",
    "## Metadata",
    "",
    metadata ? fenced("json", metadata) : "_No metadata.info.json found._",
    "",
    "## Description",
    "",
    description ?? "_No description.txt found._",
    "",
    "## Transcript",
    "",
    transcriptSection,
    "",
    "## Visual Context",
    "",
    visualContext ? visualContext.trim() : "_No analysis/visual-context.md found._",
    "",
    "## Frame Manifests",
    "",
    manifests.length > 0
      ? manifests.map((manifest) => `- ${path.relative(videoFolder, manifest)}`).join("\n")
      : "_No frames_manifest.json files found._",
    "",
    "## Scout Manifests",
    "",
    scoutManifests.length > 0
      ? scoutManifests.map((manifest) => `- ${path.relative(videoFolder, manifest)}`).join("\n")
      : "_No scout-manifest.json files found._",
    ""
  ].join("\n");
}

/**
 * Build the transcript section. If the transcript is short enough, include it
 * as a raw excerpt. Otherwise, parse it into timestamped chunks covering the
 * full video duration.
 */
function buildTranscriptSection(transcriptRaw: string): string {
  if (transcriptRaw.length <= 16000) {
    return fenced("", transcriptRaw);
  }

  const chunked = chunkTranscript(transcriptRaw, {
    chunkSec: 300,
    previewChars: 3000
  });

  if (chunked.chunks.length === 0) {
    return fenced("", excerpt(transcriptRaw, 16000));
  }

  const formatted = formatChunkIndex(chunked);
  if (formatted.length <= TRANSCRIPT_SECTION_BUDGET) {
    return formatted;
  }

  // If even chunked output exceeds budget, reduce preview size per chunk
  const budgetPerChunk = Math.floor(
    (TRANSCRIPT_SECTION_BUDGET - 500) / chunked.chunks.length
  );
  const reduced = chunkTranscript(transcriptRaw, {
    chunkSec: 300,
    previewChars: Math.max(200, budgetPerChunk)
  });
  return formatChunkIndex(reduced);
}

type ProvenanceInputs = {
  metadata: boolean;
  description: boolean;
  transcript: boolean;
  visualContext: boolean;
  scoutManifests: number;
};

function buildProvenance(inputs: ProvenanceInputs): string {
  const rows: string[] = [];

  if (inputs.transcript) {
    rows.push("- ✅ **Transcript** — available (transcript.vtt / transcript.srt)");
  } else {
    rows.push("- ❌ **Transcript** — not available");
  }

  if (inputs.description) {
    rows.push("- ✅ **Description** — available (description.txt)");
  } else {
    rows.push("- ❌ **Description** — not available");
  }

  if (inputs.metadata) {
    rows.push("- ✅ **Metadata** — available (metadata.info.json)");
  } else {
    rows.push("- ❌ **Metadata** — not available");
  }

  if (inputs.visualContext || inputs.scoutManifests > 0) {
    rows.push("- ✅ **Visual scout** — available (contact sheet + frame samples)");
  } else {
    rows.push("- ❌ **Visual scout** — not available (no video downloaded or scout not run)");
  }

  rows.push("");

  if (!inputs.transcript && !inputs.description && !inputs.metadata) {
    rows.push(
      "⚠️ **Critical limitation**: No text sources available. Summary would be entirely speculative. Generate at least description and metadata first."
    );
  } else if (!inputs.transcript && (inputs.description || inputs.metadata)) {
    rows.push(
      "⚠️ **Transcript missing**: Summary is based on description and metadata only. No timestamped quotes or detailed dialogue are available."
    );
  }

  if (!inputs.visualContext && inputs.scoutManifests === 0) {
    rows.push(
      "⚠️ **No visual evidence**: Cannot verify on-screen charts, slides, diagrams, or UI demos. Any claims about visuals are inferred from text only."
    );
  }

  return rows.join("\n");
}

async function readOptional(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function excerpt(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n\n[Transcript truncated for local context file.]`;
}

function fenced(language: string, value: string): string {
  return `\`\`\`${language}\n${value.trim()}\n\`\`\``;
}
