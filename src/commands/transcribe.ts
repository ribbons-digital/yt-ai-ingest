import path from "node:path";
import { pathExists } from "../lib/files.js";
import type { RunOptions } from "../lib/process.js";
import { transcribeAudio } from "../lib/transcribe.js";
import { skip, success } from "../lib/ui.js";
import { readIngestStatus, writeIngestStatus } from "./ingest.js";

export type TranscribeOptions = RunOptions & {
  force?: boolean;
  whisperModel?: string;
  language?: string;
};

export async function transcribe(videoFolder: string, options: TranscribeOptions): Promise<void> {
  const hasSrt = await pathExists(path.join(videoFolder, "transcript.srt"));
  const hasVtt = await pathExists(path.join(videoFolder, "transcript.vtt"));
  if ((hasSrt || hasVtt) && !options.force) {
    skip("Transcript already exists", "use --force to transcribe again");
    return;
  }

  if (!options.dryRun && !(await pathExists(path.join(videoFolder, "audio.wav")))) {
    throw new Error(
      `No audio.wav found in ${videoFolder}. Run ytai ingest <source> first to extract audio.`
    );
  }

  await transcribeAudio(videoFolder, {
    dryRun: options.dryRun,
    verbose: options.verbose,
    quiet: options.quiet,
    model: options.whisperModel,
    language: options.language
  });

  if (options.dryRun) {
    return;
  }

  const status = await readIngestStatus(videoFolder);
  if (status) {
    status.assets.transcript = true;
    await writeIngestStatus(videoFolder, status.url, status.assets, status.warnings, status.source);
  }

  if (!options.quiet) {
    success("Transcript", path.join(videoFolder, "transcript.srt"));
  }
}
