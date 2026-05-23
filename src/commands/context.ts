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

  const assets = await loadContextAssets(videoFolder);
  logLoadedAssets(assets, options);
  return renderContext(videoFolder, question, assets);
}

type ContextAssets = {
  metadata?: string;
  description?: string;
  transcriptRaw?: string;
  visualContext?: string;
  manifests: string[];
  scoutManifests: string[];
};

async function loadContextAssets(videoFolder: string): Promise<ContextAssets> {
  const allFiles = await listFilesRecursive(videoFolder);
  return {
    metadata: await readOptional(path.join(videoFolder, "metadata.info.json")),
    description: await readOptional(path.join(videoFolder, "description.txt")),
    transcriptRaw: await readTranscript(videoFolder),
    visualContext: await readOptional(path.join(videoFolder, "analysis", "visual-context.md")),
    manifests: allFiles.filter((file) => file.endsWith("frames_manifest.json")),
    scoutManifests: allFiles.filter((file) => file.endsWith("scout-manifest.json"))
  };
}

async function readTranscript(videoFolder: string): Promise<string | undefined> {
  return (
    (await readOptional(path.join(videoFolder, "transcript.srt"))) ??
    (await readOptional(path.join(videoFolder, "transcript.vtt")))
  );
}

function logLoadedAssets(assets: ContextAssets, options: ContextOptions): void {
  if (!options.verbose) {
    return;
  }
  console.error(`Loaded metadata: ${Boolean(assets.metadata)}`);
  console.error(`Loaded description: ${Boolean(assets.description)}`);
  console.error(
    `Loaded transcript: ${Boolean(assets.transcriptRaw)} (${assets.transcriptRaw?.length ?? 0} chars)`
  );
  console.error(`Loaded visual context: ${Boolean(assets.visualContext)}`);
  console.error(`Found frame manifests: ${assets.manifests.length}`);
  console.error(`Found scout manifests: ${assets.scoutManifests.length}`);
}

function renderContext(
  videoFolder: string,
  question: string | undefined,
  assets: ContextAssets
): string {
  return [
    "# YouTube AI Context",
    "",
    "## Source Provenance",
    "",
    buildProvenance({
      metadata: Boolean(assets.metadata),
      description: Boolean(assets.description),
      transcript: Boolean(assets.transcriptRaw),
      visualContext: Boolean(assets.visualContext),
      scoutManifests: assets.scoutManifests.length
    }),
    "",
    renderTaskSection(question),
    "## Instructions",
    "",
    "- Use the transcript, metadata, and visual context as primary evidence.",
    "- Cite timestamps when they appear in the transcript, frame manifests, or scout manifests.",
    "- If evidence is missing, say what local asset should be generated next.",
    "",
    "## Metadata",
    "",
    renderMetadata(assets.metadata),
    "",
    "## Description",
    "",
    assets.description ?? "_No description.txt found._",
    "",
    "## Transcript",
    "",
    renderTranscript(assets.transcriptRaw),
    "",
    "## Visual Context",
    "",
    assets.visualContext ? assets.visualContext.trim() : "_No analysis/visual-context.md found._",
    "",
    "## Frame Manifests",
    "",
    renderManifestList(videoFolder, assets.manifests, "_No frames_manifest.json files found._"),
    "",
    "## Scout Manifests",
    "",
    renderManifestList(videoFolder, assets.scoutManifests, "_No scout-manifest.json files found._"),
    ""
  ].join("\n");
}

function renderTaskSection(question: string | undefined): string {
  return question
    ? `## Question\n\n${question}\n`
    : "## Task\n\nSummarize this video using timestamps where possible.\n";
}

function renderMetadata(metadata: string | undefined): string {
  return metadata ? fenced("json", metadata) : "_No metadata.info.json found._";
}

function renderTranscript(transcriptRaw: string | undefined): string {
  return transcriptRaw ? buildTranscriptSection(transcriptRaw) : "_No transcript.srt or transcript.vtt found._";
}

function renderManifestList(videoFolder: string, manifests: string[], fallback: string): string {
  return manifests.length > 0
    ? manifests.map((manifest) => `- ${path.relative(videoFolder, manifest)}`).join("\n")
    : fallback;
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
  return [
    ...buildAvailabilityRows(inputs),
    "",
    ...buildLimitationWarnings(inputs)
  ].join("\n");
}

function buildAvailabilityRows(inputs: ProvenanceInputs): string[] {
  return [
    availabilityRow(
      inputs.transcript,
      "Transcript",
      "available (transcript.vtt / transcript.srt)",
      "not available"
    ),
    availabilityRow(inputs.description, "Description", "available (description.txt)", "not available"),
    availabilityRow(inputs.metadata, "Metadata", "available (metadata.info.json)", "not available"),
    availabilityRow(
      inputs.visualContext || inputs.scoutManifests > 0,
      "Visual scout",
      "available (contact sheet + frame samples)",
      "not available (no video downloaded or scout not run)"
    )
  ];
}

function availabilityRow(
  available: boolean,
  label: string,
  availableText: string,
  unavailableText: string
): string {
  return `- ${available ? "✅" : "❌"} **${label}** — ${available ? availableText : unavailableText}`;
}

function buildLimitationWarnings(inputs: ProvenanceInputs): string[] {
  const warnings: string[] = [];
  const hasTextSource = inputs.transcript || inputs.description || inputs.metadata;

  if (!hasTextSource) {
    warnings.push(
      "⚠️ **Critical limitation**: No text sources available. Summary would be entirely speculative. Generate at least description and metadata first."
    );
  } else if (!inputs.transcript) {
    warnings.push(
      "⚠️ **Transcript missing**: Summary is based on description and metadata only. No timestamped quotes or detailed dialogue are available."
    );
  }

  if (!inputs.visualContext && inputs.scoutManifests === 0) {
    warnings.push(
      "⚠️ **No visual evidence**: Cannot verify on-screen charts, slides, diagrams, or UI demos. Any claims about visuals are inferred from text only."
    );
  }

  return warnings;
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
