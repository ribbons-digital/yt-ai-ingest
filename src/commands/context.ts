import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { listFilesRecursive, pathExists } from "../lib/files.js";

type ContextOptions = {
  verbose?: boolean;
};

export async function summarize(videoFolder: string, options: ContextOptions = {}): Promise<void> {
  const context = await buildContext(videoFolder, undefined, options);
  const outPath = path.join(videoFolder, "analysis", "summary-input.md");
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, context, "utf8");
  console.log(`Summary context written: ${outPath}`);
  console.log("No AI provider is wired yet. Send this file to an AI model when ready.");
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
  console.log(`Question context written: ${outPath}`);
  console.log("No AI provider is wired yet. Send this file to an AI model when ready.");
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
  const transcript =
    (await readOptional(path.join(videoFolder, "transcript.srt"))) ??
    (await readOptional(path.join(videoFolder, "transcript.vtt")));
  const manifests = (await listFilesRecursive(videoFolder)).filter((file) =>
    file.endsWith("frames_manifest.json")
  );

  if (options.verbose) {
    console.error(`Loaded metadata: ${Boolean(metadata)}`);
    console.error(`Loaded description: ${Boolean(description)}`);
    console.error(`Loaded transcript: ${Boolean(transcript)}`);
    console.error(`Found frame manifests: ${manifests.length}`);
  }

  return [
    "# YouTube AI Context",
    "",
    question ? `## Question\n\n${question}\n` : "## Task\n\nSummarize this video using timestamps where possible.\n",
    "## Instructions",
    "",
    "- Use the transcript and metadata as primary evidence.",
    "- Cite timestamps when they appear in the transcript or frame manifests.",
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
    "## Transcript Excerpt",
    "",
    transcript ? fenced("", excerpt(transcript, 16000)) : "_No transcript.srt or transcript.vtt found._",
    "",
    "## Frame Manifests",
    "",
    manifests.length > 0
      ? manifests.map((manifest) => `- ${path.relative(videoFolder, manifest)}`).join("\n")
      : "_No frames_manifest.json files found._",
    ""
  ].join("\n");
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
