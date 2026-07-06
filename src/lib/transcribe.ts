import path from "node:path";
import { moveIfExists, pathExists } from "./files.js";
import { runCommand, type RunOptions } from "./process.js";
import { startSpinner, warn } from "./ui.js";

export type WhisperBackend = "mlx_whisper" | "whisper";

export type TranscribeAudioOptions = RunOptions & {
  model?: string;
  language?: string;
};

type WhisperArgOptions = {
  model?: string;
  language?: string;
};

const WHISPER_INSTALL_HINT =
  "Install one with: pip install mlx-whisper (Apple Silicon) or pipx install openai-whisper";

export async function detectWhisperBackend(): Promise<WhisperBackend | undefined> {
  for (const backend of ["mlx_whisper", "whisper"] as const) {
    const probe = await runCommand(backend, ["--help"], {
      capture: true,
      allowFailure: true
    }).catch(() => ({ stdout: "", stderr: "", code: 1 }));
    if (probe.code === 0) {
      return backend;
    }
  }
  return undefined;
}

export function buildMlxWhisperArgs(
  audioPath: string,
  outDir: string,
  opts: WhisperArgOptions = {}
): string[] {
  const args = [audioPath, "--output-dir", outDir, "--output-format", "srt"];
  if (opts.model) {
    args.push("--model", opts.model);
  }
  if (opts.language) {
    args.push("--language", opts.language);
  }
  return args;
}

export function buildWhisperArgs(
  audioPath: string,
  outDir: string,
  opts: WhisperArgOptions = {}
): string[] {
  const args = [audioPath, "--output_dir", outDir, "--output_format", "srt"];
  if (opts.model) {
    args.push("--model", opts.model);
  }
  if (opts.language) {
    args.push("--language", opts.language);
  }
  return args;
}

function buildWhisperArgsForBackend(
  backend: WhisperBackend,
  audioPath: string,
  outDir: string,
  opts: WhisperArgOptions = {}
): string[] {
  return backend === "mlx_whisper"
    ? buildMlxWhisperArgs(audioPath, outDir, opts)
    : buildWhisperArgs(audioPath, outDir, opts);
}

export async function transcribeAudio(
  videoFolder: string,
  options: TranscribeAudioOptions
): Promise<void> {
  const audioPath = path.join(videoFolder, "audio.wav");
  const transcriptSrt = path.join(videoFolder, "transcript.srt");
  const transcriptVtt = path.join(videoFolder, "transcript.vtt");
  const argOptions: WhisperArgOptions = {
    model: options.model,
    language: options.language
  };

  if (!options.dryRun && !(await pathExists(audioPath))) {
    throw new Error(`No audio.wav found in ${videoFolder}. Run ytai ingest first to extract audio.`);
  }

  if (options.dryRun) {
    const backend: WhisperBackend = "mlx_whisper";
    const args = buildWhisperArgsForBackend(backend, audioPath, videoFolder, argOptions);
    await runCommand(backend, args, options);
    await runCommand("ffmpeg", ["-y", "-i", transcriptSrt, transcriptVtt], options);
    return;
  }

  const backend = await detectWhisperBackend();
  if (!backend) {
    throw new Error(`No local whisper backend found. ${WHISPER_INSTALL_HINT}.`);
  }
  const args = buildWhisperArgsForBackend(backend, audioPath, videoFolder, argOptions);

  const spinner = startSpinner("Transcribing audio locally...", {
    enabled: !options.verbose && !options.quiet
  });
  try {
    await runCommand(backend, args, options);
    spinner.succeed("Transcribed audio");
  } catch (error) {
    spinner.fail("Transcription failed");
    throw error;
  }

  const producedSrt = path.join(videoFolder, "audio.srt");
  if (!(await moveIfExists(producedSrt, transcriptSrt))) {
    throw new Error(`${backend} finished but did not produce ${producedSrt}.`);
  }
  try {
    const conversion = await runCommand("ffmpeg", ["-y", "-i", transcriptSrt, transcriptVtt], {
      ...options,
      allowFailure: true
    });
    if (conversion.code !== 0) {
      warn("Transcript conversion failed", "keeping transcript.srt");
    }
  } catch {
    warn("Transcript conversion failed", "keeping transcript.srt");
  }
}
