import { createHash } from "node:crypto";
import { copyFile, link as hardlink, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { ingestedFolderAgentPrompt } from "../lib/agentPrompt.js";
import { ensureDependencies } from "../lib/dependencies.js";
import {
  copyIfExists,
  ensureDir,
  findFirstFile,
  pathExists,
  safeSlug,
  writeJson
} from "../lib/files.js";
import { getVideoDurationSeconds } from "../lib/media.js";
import { runCommand } from "../lib/process.js";
import { block, section, startSpinner, success, warn } from "../lib/ui.js";
import {
  assertUsableAssets,
  resolveVideoFolder,
  runPostIngestTranscription,
  writeIngestStatus,
  type IngestedAssets,
  type IngestOptions,
  type IngestResult,
  type IngestStatus
} from "./ingest.js";

const DIRECT_CONTAINER_EXTS: Record<string, true> = { mp4: true, mov: true, mkv: true, webm: true };
const SOURCE_VIDEO_PATTERN = /^source\.(mp4|mkv|webm|mov)$/i;

type LocalVideoMetadata = {
  id: string;
  title: string;
  duration?: number;
  width?: number;
  height?: number;
  ext: string;
  ffprobe?: unknown;
};

type FfprobeOutput = {
  format?: { duration?: string };
  streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
};

export async function ingestLocal(filePath: string, options: IngestOptions): Promise<IngestResult> {
  warnIgnoredRemoteOptions(options);

  const absolutePath = path.resolve(filePath);
  if (!options.dryRun) {
    await assertLocalVideoFile(absolutePath);
    await ensureDependencies(["ffmpeg", "ffprobe"], options.verbose);
  }

  const metadata = await probeLocalMetadata(absolutePath, options);
  const folderName = [
    new Date().toISOString().slice(0, 10),
    safeSlug(metadata.title),
    safeSlug(metadata.id)
  ].join("_");
  const videoFolder = await resolveVideoFolder(path.join(options.outDir, folderName), options);

  await ensureDir(path.join(videoFolder, "frames"));
  await ensureDir(path.join(videoFolder, "clips"));
  await ensureDir(path.join(videoFolder, "analysis"));

  const warnings: string[] = [];

  if (!options.dryRun) {
    await writeJson(path.join(videoFolder, "metadata.info.json"), {
      id: metadata.id,
      title: metadata.title,
      duration: metadata.duration,
      width: metadata.width,
      height: metadata.height,
      ext: metadata.ext,
      source: "local",
      original_path: absolutePath,
      ffprobe: metadata.ffprobe
    });
  }

  const sourceFile = await importSourceVideo(absolutePath, videoFolder, metadata.ext, options);
  await importSidecarSubtitles(absolutePath, videoFolder, options);
  await extractLocalAudio(sourceFile, videoFolder, options);
  await extractLocalThumbnail(sourceFile, videoFolder, metadata.duration, options);

  if (options.dryRun) {
    return dryRunLocalIngestResult(videoFolder, options, warnings);
  }

  const assets = await detectFinalAssets(videoFolder);
  await runPostIngestTranscription(videoFolder, assets, options, warnings);
  await writeIngestStatus(videoFolder, absolutePath, assets, warnings, {
    type: "local",
    originalPath: absolutePath
  });
  assertUsableAssets(assets);
  printLocalIngestSummary(videoFolder, assets, options);

  return { videoFolder, assets, warnings };
}

export async function resumeLocalIngest(
  videoFolder: string,
  status: IngestStatus,
  options: IngestOptions
): Promise<IngestResult> {
  if (!options.dryRun) {
    await ensureDependencies(["ffmpeg", "ffprobe"], options.verbose);
  }

  const warnings: string[] = [...status.warnings];
  let sourceFile = await findFirstFile(videoFolder, (name) => SOURCE_VIDEO_PATTERN.test(name));

  if (!sourceFile) {
    const originalPath = status.source.originalPath;
    if (originalPath && (await pathExists(originalPath))) {
      const ext = path.extname(originalPath).slice(1).toLowerCase();
      sourceFile = await importSourceVideo(originalPath, videoFolder, ext, options);
    } else {
      const warning = originalPath
        ? `Source video is missing from the folder and the original file no longer exists at ${originalPath}.`
        : "Source video is missing from the folder and no original path is recorded.";
      warn("Cannot restore source video", warning);
      warnings.push(warning);
    }
  }

  if (sourceFile) {
    if (!(await pathExists(path.join(videoFolder, "audio.wav")))) {
      await extractLocalAudio(sourceFile, videoFolder, options);
    }
    if (!(await pathExists(path.join(videoFolder, "thumbnail.jpg")))) {
      const duration = options.dryRun
        ? undefined
        : await getVideoDurationSeconds(sourceFile, options);
      await extractLocalThumbnail(sourceFile, videoFolder, duration, options);
    }
  }

  await fillTranscriptConversions(videoFolder, options);

  const assets = await detectFinalAssets(videoFolder);
  if (options.dryRun) {
    return { videoFolder, assets, warnings };
  }

  await runPostIngestTranscription(videoFolder, assets, options, warnings);
  await writeIngestStatus(videoFolder, status.url, assets, warnings, status.source);
  printLocalIngestSummary(videoFolder, assets, options);

  return { videoFolder, assets, warnings };
}

export async function detectFinalAssets(videoFolder: string): Promise<IngestedAssets> {
  const [metadata, description, transcriptSrt, transcriptVtt, sourceVideo, audio, thumbnail] =
    await Promise.all([
      pathExists(path.join(videoFolder, "metadata.info.json")),
      pathExists(path.join(videoFolder, "description.txt")),
      pathExists(path.join(videoFolder, "transcript.srt")),
      pathExists(path.join(videoFolder, "transcript.vtt")),
      findFirstFile(videoFolder, (name) => SOURCE_VIDEO_PATTERN.test(name)),
      pathExists(path.join(videoFolder, "audio.wav")),
      pathExists(path.join(videoFolder, "thumbnail.jpg"))
    ]);

  return {
    metadata,
    description,
    transcript: transcriptSrt || transcriptVtt,
    video: sourceVideo !== undefined,
    audio,
    thumbnail
  };
}

export function matchSidecarSubtitle(stem: string, candidates: string[]): string | undefined {
  const scored = candidates
    .map((name) => ({ name, score: sidecarScore(stem, name) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return scored[0]?.name;
}

function sidecarScore(stem: string, name: string): number {
  const lower = name.toLowerCase();
  const prefix = `${stem.toLowerCase()}.`;
  if (!lower.startsWith(prefix)) {
    return 0;
  }

  const rest = lower.slice(prefix.length);
  const match = /^(?:([a-z0-9_-]+)\.)?(srt|vtt)$/.exec(rest);
  if (!match) {
    return 0;
  }

  const [, languageTag, ext] = match;
  // Prefer .srt over .vtt, and an exact stem match over a language-tagged one.
  let score = ext === "srt" ? 40 : 20;
  if (!languageTag) {
    score += 10;
  }
  return score;
}

async function assertLocalVideoFile(absolutePath: string): Promise<void> {
  let info;
  try {
    info = await stat(absolutePath);
  } catch {
    throw new Error(
      `Local video file not found: ${absolutePath}. If you meant a remote video, URLs must start with http:// or https://.`
    );
  }
  if (!info.isFile()) {
    throw new Error(`Expected a video file but found a directory: ${absolutePath}.`);
  }
}

async function probeLocalMetadata(
  absolutePath: string,
  options: IngestOptions
): Promise<LocalVideoMetadata> {
  const stem = path.basename(absolutePath, path.extname(absolutePath));
  const ext = path.extname(absolutePath).slice(1).toLowerCase();
  const probeArgs = ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", absolutePath];

  if (options.dryRun) {
    await runCommand("ffprobe", probeArgs, options);
    let id = "dry-run";
    try {
      const info = await stat(absolutePath);
      id = localVideoId(absolutePath, info.size);
    } catch {
      // Keep the dry-run placeholder id when the file cannot be read.
    }
    return { id, title: stem, ext };
  }

  const spinner = startSpinner("Probing video metadata...", {
    enabled: !options.verbose && (!options.quiet || options.showProgress === true)
  });
  try {
    const info = await stat(absolutePath);
    const result = await runCommand("ffprobe", probeArgs, {
      capture: true,
      verbose: options.verbose
    });
    const probe = JSON.parse(result.stdout) as FfprobeOutput;
    const videoStream = probe.streams?.find((stream) => stream.codec_type === "video");
    const duration = Number.parseFloat(probe.format?.duration ?? "");
    spinner.succeed("Probed video metadata");
    return {
      id: localVideoId(absolutePath, info.size),
      title: stem,
      duration: Number.isFinite(duration) ? duration : undefined,
      width: videoStream?.width,
      height: videoStream?.height,
      ext,
      ffprobe: probe
    };
  } catch (error) {
    spinner.fail("Could not probe video metadata");
    throw error;
  }
}

function localVideoId(absolutePath: string, sizeBytes: number): string {
  return createHash("sha256").update(`${absolutePath}:${sizeBytes}`).digest("hex").slice(0, 10);
}

async function importSourceVideo(
  absolutePath: string,
  videoFolder: string,
  ext: string,
  options: IngestOptions
): Promise<string> {
  if (DIRECT_CONTAINER_EXTS[ext]) {
    const destination = path.join(videoFolder, `source.${ext}`);
    if (options.dryRun) {
      console.log(`Would ${options.link ? "hardlink" : "copy"} ${absolutePath} -> ${destination}`);
      return destination;
    }

    const spinner = startSpinner("Importing local video...", {
      enabled: !options.verbose && (!options.quiet || options.showProgress === true)
    });
    try {
      if (path.resolve(absolutePath) === path.resolve(destination)) {
        spinner.succeed("Local video already in target folder");
        return destination;
      }

      let linked = false;
      if (options.link) {
        try {
          await rm(destination, { force: true });
          await hardlink(absolutePath, destination);
          linked = true;
        } catch {
          // Hardlinks fail across devices or unsupported filesystems; fall back to copying.
        }
      }
      if (!linked) {
        await copyFile(absolutePath, destination);
      }
      spinner.succeed(linked ? "Hardlinked local video" : "Copied local video");
      return destination;
    } catch (error) {
      spinner.fail("Could not import local video");
      throw error;
    }
  }

  const destination = path.join(videoFolder, "source.mp4");
  const spinner = startSpinner("Remuxing local video to mp4...", {
    enabled: !options.dryRun && !options.verbose && (!options.quiet || options.showProgress === true)
  });
  const remux = await runCommand("ffmpeg", ["-y", "-i", absolutePath, "-c", "copy", destination], {
    ...options,
    allowFailure: true
  });
  if (!options.dryRun && remux.code !== 0) {
    spinner.fail("Remux failed");
    throw new Error(
      `Could not remux ${path.basename(absolutePath)} into an mp4 container (ffmpeg exited with code ${remux.code}). Convert the file to mp4 first, for example: ffmpeg -i input${ext ? `.${ext}` : ""} -c:v libx264 -c:a aac output.mp4`
    );
  }
  spinner.succeed("Remuxed local video to mp4");
  return destination;
}

async function importSidecarSubtitles(
  absolutePath: string,
  videoFolder: string,
  options: IngestOptions
): Promise<void> {
  const sourceDir = path.dirname(absolutePath);
  const stem = path.basename(absolutePath, path.extname(absolutePath));
  const candidates = await readdir(sourceDir).catch(() => [] as string[]);
  const match = matchSidecarSubtitle(stem, candidates);
  if (!match) {
    return;
  }

  const matchPath = path.join(sourceDir, match);
  const isSrt = match.toLowerCase().endsWith(".srt");
  const primary = path.join(videoFolder, isSrt ? "transcript.srt" : "transcript.vtt");
  const converted = path.join(videoFolder, isSrt ? "transcript.vtt" : "transcript.srt");

  if (options.dryRun) {
    console.log(`Would copy ${matchPath} -> ${primary}`);
    await runCommand("ffmpeg", ["-y", "-i", primary, converted], options);
    return;
  }

  await copyIfExists(matchPath, primary);
  const conversion = await runCommand("ffmpeg", ["-y", "-i", primary, converted], {
    ...options,
    allowFailure: true
  });
  if (conversion.code !== 0) {
    warn("Subtitle conversion failed", path.basename(converted));
  }
}

async function extractLocalAudio(
  sourceFile: string,
  videoFolder: string,
  options: IngestOptions
): Promise<void> {
  const result = await runCommand(
    "ffmpeg",
    ["-y", "-i", sourceFile, "-vn", "-ac", "1", "-ar", "16000", path.join(videoFolder, "audio.wav")],
    { ...options, allowFailure: true }
  );
  if (!options.dryRun && result.code !== 0) {
    warn("Audio extraction failed", path.basename(sourceFile));
  }
}

async function extractLocalThumbnail(
  sourceFile: string,
  videoFolder: string,
  durationSeconds: number | undefined,
  options: IngestOptions
): Promise<void> {
  const result = await runCommand(
    "ffmpeg",
    [
      "-y",
      "-ss",
      thumbnailSeekSeconds(durationSeconds),
      "-i",
      sourceFile,
      "-frames:v",
      "1",
      path.join(videoFolder, "thumbnail.jpg")
    ],
    { ...options, allowFailure: true }
  );
  if (!options.dryRun && result.code !== 0) {
    warn("Thumbnail extraction failed", path.basename(sourceFile));
  }
}

function thumbnailSeekSeconds(durationSeconds: number | undefined): string {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return "1";
  }
  const seek = Math.min(durationSeconds * 0.1, 60);
  return String(Math.round(seek * 100) / 100);
}

async function fillTranscriptConversions(videoFolder: string, options: IngestOptions): Promise<void> {
  const srt = path.join(videoFolder, "transcript.srt");
  const vtt = path.join(videoFolder, "transcript.vtt");
  const hasSrt = await pathExists(srt);
  const hasVtt = await pathExists(vtt);
  if (hasSrt === hasVtt) {
    return;
  }

  const [from, to] = hasSrt ? [srt, vtt] : [vtt, srt];
  const result = await runCommand("ffmpeg", ["-y", "-i", from, to], {
    ...options,
    allowFailure: true
  });
  if (!options.dryRun && result.code !== 0) {
    warn("Subtitle conversion failed", path.basename(to));
  }
}

function warnIgnoredRemoteOptions(options: IngestOptions): void {
  const ignored = [
    options.transcriptOnly ? "--transcript-only" : "",
    options.rateLimit ? "--rate-limit" : "",
    options.cookiesFromBrowser ? "--cookies-from-browser" : "",
    options.cookiesPath ? "--cookies" : ""
  ].filter(Boolean);
  if (ignored.length > 0) {
    warn("Ignored for local files", ignored.join(", "));
  }
}

function dryRunLocalIngestResult(
  videoFolder: string,
  options: IngestOptions,
  warnings: string[]
): IngestResult {
  if (!options.quiet) {
    console.log(`Would ingest local video into ${videoFolder}`);
  }
  return {
    videoFolder,
    assets: {
      metadata: true,
      description: false,
      transcript: false,
      video: true,
      audio: true,
      thumbnail: true
    },
    warnings
  };
}

function printLocalIngestSummary(
  videoFolder: string,
  assets: IngestedAssets,
  options: IngestOptions
): void {
  if (options.quiet) {
    return;
  }
  success("Ingested assets", videoFolder);
  if (!assets.video) {
    warn("No video available - scout step will be skipped");
  }
  section("Agent Prompt");
  block(ingestedFolderAgentPrompt(videoFolder));
}
