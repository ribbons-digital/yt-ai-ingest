import { input as promptInput } from "@inquirer/prompts";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { ensureDependencies } from "../lib/dependencies.js";
import {
  copyIfExists,
  ensureDir,
  findFirstFile,
  moveIfExists,
  pathExists,
  safeSlug,
  writeJson
} from "../lib/files.js";
import { findSourceVideo } from "../lib/media.js";
import { ingestedFolderAgentPrompt } from "../lib/agentPrompt.js";
import { runCommand, type RunOptions, type RunResult } from "../lib/process.js";
import { transcribeAudio } from "../lib/transcribe.js";
import { ingestLocal, resumeLocalIngest } from "./ingestLocal.js";
import { block, createDownloadProgressBar, section, startSpinner, success, warn } from "../lib/ui.js";

export type IngestedAssets = {
  metadata: boolean;
  description: boolean;
  transcript: boolean;
  video: boolean;
  audio: boolean;
  thumbnail: boolean;
};

export type IngestResult = {
  videoFolder: string;
  assets: IngestedAssets;
  warnings: string[];
};

export type IngestOptions = RunOptions & {
  outDir: string;
  showProgress?: boolean;
  promptVideoFolder?: (defaultFolder: string) => Promise<string | undefined>;
  transcriptOnly?: boolean;
  rateLimit?: boolean;
  cookiesFromBrowser?: string;
  cookiesPath?: string;
  link?: boolean;
  transcribe?: boolean;
  whisperModel?: string;
  language?: string;
};

export type IngestSource = { type: "youtube" | "local"; url?: string; originalPath?: string };

export type IngestStatus = {
  url: string;
  videoFolder: string;
  timestamp: string;
  assets: IngestedAssets;
  warnings: string[];
  source: IngestSource;
};

export function classifySourceInput(input: string): "url" | "local" {
  return /^https?:\/\//i.test(input.trim()) ? "url" : "local";
}

type YtDlpMetadata = {
  id?: string;
  title?: string;
  webpage_url?: string;
};

const DEFAULT_VIDEO_FORMAT =
  "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/best[height<=1080]/best";

type YtDlpErrorCategory =
  | "rate_limit"
  | "forbidden"
  | "video_unavailable"
  | "age_restricted"
  | "geo_blocked"
  | "no_formats"
  | "network_error"
  | "unknown";

export type YtDlpErrorInfo = {
  category: YtDlpErrorCategory;
  message: string;
  suggestion: string;
};

export function classifyYtDlpError(stderr: string, exitCode: number): YtDlpErrorInfo {
  const lower = stderr.toLowerCase();

  if (stderr.includes("HTTP Error 429") || stderr.includes("Too Many Requests") || stderr.includes("http error 429")) {
    return {
      category: "rate_limit",
      message: "YouTube rate limit (HTTP 429)",
      suggestion: "Try --cookies-from-browser chrome to authenticate with YouTube, or --rate-limit to slow requests"
    };
  }
  if (stderr.includes("HTTP Error 403") || stderr.includes("403 Forbidden") || stderr.includes("http error 403")) {
    return {
      category: "forbidden",
      message: "Media request forbidden (HTTP 403)",
      suggestion: "If this is a public video and you used browser cookies, retry without browser cookies. Otherwise retry later or with a fresh logged-in browser session"
    };
  }
  if (stderr.includes("Video unavailable") || stderr.includes("HTTP Error 404") || stderr.includes("http error 404")) {
    return {
      category: "video_unavailable",
      message: "Video not found or unavailable",
      suggestion: "Check the URL and whether the video is private or deleted"
    };
  }
  if (lower.includes("age") || lower.includes("sign in to confirm")) {
    return {
      category: "age_restricted",
      message: "Age-restricted video",
      suggestion: "Try --cookies-from-browser chrome with a logged-in YouTube account"
    };
  }
  if (lower.includes("blocked") || lower.includes("not available in your country") || lower.includes("geo")) {
    return {
      category: "geo_blocked",
      message: "Video is geo-blocked in your region",
      suggestion: "Try --proxy with a supported proxy or VPN"
    };
  }
  if (lower.includes("no video formats found")) {
    return {
      category: "no_formats",
      message: "No downloadable video formats found",
      suggestion: "Try --transcript-only to at least fetch the transcript and metadata"
    };
  }
  if (lower.includes("timeout") || lower.includes("connection") || lower.includes("reset by peer")) {
    return {
      category: "network_error",
      message: "Network error during download",
      suggestion: "Check your internet connection and try again, or use --rate-limit to add delays"
    };
  }
  return {
    category: "unknown",
    message: `yt-dlp exited with code ${exitCode}`,
    suggestion: "Check the URL and your network connection, or retry later"
  };
}

export function ingestStatusPath(videoFolder: string): string {
  return path.join(videoFolder, "ingest-status.json");
}

export function buildYtDlpArgs(url: string, videoFolder: string, options: IngestOptions): string[] {
  const args: string[] = [
    "--no-playlist"
  ];

  // Rate-limiting flags
  if (options.rateLimit) {
    args.push(
      "--sleep-requests", "1",
      "--sleep-interval", "1",
      "--max-sleep-interval", "5",
      "--retries", "10",
      "--fragment-retries", "10"
    );
  }

  // Cookies
  if (options.cookiesFromBrowser) {
    args.push("--cookies-from-browser", options.cookiesFromBrowser);
  }
  if (options.cookiesPath) {
    args.push("--cookies", options.cookiesPath);
  }

  if (options.transcriptOnly) {
    args.push(
      "--skip-download",
      "--write-info-json",
      "--write-description",
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs", "en.*",
      "--sub-format", "vtt/best",
      "-o", path.join(videoFolder, "source.%(ext)s"),
      url
    );
  } else {
    args.push(
      "--write-thumbnail",
      "--write-info-json",
      "--write-description",
      "--newline",
      "-f", DEFAULT_VIDEO_FORMAT,
      "--merge-output-format", "mp4",
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs", "en.*",
      "--sub-format", "vtt/best",
      "-o", path.join(videoFolder, "source.%(ext)s"),
      url
    );
  }

  return args;
}

export function parseYtDlpDownloadProgress(line: string): number | undefined {
  const match = /^\[download\]\s+(\d+(?:\.\d+)?)%/.exec(line.trim());
  if (!match) {
    return undefined;
  }
  return Number(match[1]);
}

export function formatPartialDownloadWarning({
  exitCode,
  partialAssetsLabel,
  stderr,
  cookiesFromBrowser,
  cookiesPath
}: {
  exitCode: number;
  partialAssetsLabel: string;
  stderr: string;
  cookiesFromBrowser?: string;
  cookiesPath?: string;
}): string {
  const errorInfo = classifyYtDlpError(stderr, exitCode);
  const retry = retrySuggestionForPartialFailure(errorInfo, {
    cookiesFromBrowser,
    cookiesPath
  });
  return [
    `yt-dlp exited with code ${exitCode} but partial assets found (${partialAssetsLabel}) — continuing.`,
    `Cause: ${errorInfo.message}.`,
    `Suggested next step: ${retry}`
  ].join(" ");
}

export async function ingest(url: string, options: IngestOptions): Promise<IngestResult> {
  if (classifySourceInput(url) === "local") {
    return await ingestLocal(url, options);
  }

  await ensureIngestDependencies(options);

  const videoFolder = await prepareVideoFolder(url, options);
  const downloadResult = await runYtDlpDownload(url, videoFolder, options, {
    start: options.transcriptOnly
      ? "Downloading transcript and metadata..."
      : "Downloading video assets...",
    success: options.transcriptOnly
      ? "Downloaded transcript and metadata"
      : "Downloaded video assets",
    failure: "Download failed"
  });

  const warnings: string[] = [];
  await handleDownloadFailure(downloadResult, videoFolder, options, warnings);

  if (options.dryRun) {
    return dryRunIngestResult(videoFolder, options, warnings);
  }

  const assets = await normalizeWithSpinner(videoFolder, options, "Normalizing downloaded assets...");
  await runPostIngestTranscription(videoFolder, assets, options, warnings);
  await writeIngestStatus(videoFolder, url, assets, warnings, { type: "youtube", url });
  assertUsableAssets(assets);
  printIngestSummary(videoFolder, assets, options);

  return { videoFolder, assets, warnings };
}

export async function runPostIngestTranscription(
  videoFolder: string,
  assets: IngestedAssets,
  options: IngestOptions,
  warnings: string[]
): Promise<void> {
  if (!options.transcribe || options.dryRun || assets.transcript || !assets.audio) {
    return;
  }
  try {
    await transcribeAudio(videoFolder, {
      verbose: options.verbose,
      quiet: options.quiet,
      model: options.whisperModel,
      language: options.language
    });
    assets.transcript = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const warning = `Transcription failed: ${message} Retry later with: ytai transcribe ${videoFolder}`;
    warn("Transcription failed", message);
    warnings.push(warning);
  }
}

async function ensureIngestDependencies(options: IngestOptions): Promise<void> {
  if (options.dryRun) {
    return;
  }
  await ensureDependencies(["yt-dlp"], options.verbose);
  if (!options.transcriptOnly) {
    await ensureDependencies(["ffmpeg"], options.verbose);
  }
}

async function prepareVideoFolder(url: string, options: IngestOptions): Promise<string> {
  const metadata = await readVideoMetadataWithSpinner(url, options);
  const defaultVideoFolder = path.join(options.outDir, folderNameForMetadata(metadata));
  const videoFolder = await resolveVideoFolder(defaultVideoFolder, options);

  await ensureDir(path.join(videoFolder, "frames"));
  await ensureDir(path.join(videoFolder, "clips"));
  await ensureDir(path.join(videoFolder, "analysis"));

  return videoFolder;
}

async function readVideoMetadataWithSpinner(
  url: string,
  options: IngestOptions
): Promise<YtDlpMetadata> {
  const spinner = startSpinner("Reading video metadata...", {
    enabled: shouldShowProgress(options)
  });
  try {
    const metadata = await readVideoMetadata(url, options);
    spinner.succeed("Read video metadata");
    return metadata;
  } catch (error) {
    spinner.fail("Could not read video metadata");
    throw error;
  }
}

function folderNameForMetadata(metadata: YtDlpMetadata): string {
  return [
    new Date().toISOString().slice(0, 10),
    safeSlug(metadata.title ?? "youtube-video"),
    safeSlug(metadata.id ?? "unknown")
  ].join("_");
}

type YtDlpDownloadLabels = {
  start: string;
  success: string;
  failure: string;
};

async function runYtDlpDownload(
  url: string,
  videoFolder: string,
  options: IngestOptions,
  labels: YtDlpDownloadLabels
): Promise<RunResult> {
  const spinner = startSpinner(labels.start, {
    enabled: shouldShowProgress(options)
  });
  const progressBar = createDownloadProgressBar(labels.start, {
    enabled: shouldShowProgress(options)
  });
  try {
    let lastProgress = -1;
    let progressStarted = false;
    const handleProgressChunk = (chunk: string) => {
      for (const line of chunk.split(/\r|\n/)) {
        const progress = parseYtDlpDownloadProgress(line);
        if (progress === undefined || progress === lastProgress) {
          continue;
        }
        lastProgress = progress;
        if (!progressStarted) {
          spinner.stop();
          progressBar.start(progress);
          progressStarted = true;
          continue;
        }
        progressBar.update(progress);
      }
    };
    const result = await runCommand("yt-dlp", buildYtDlpArgs(url, videoFolder, options), {
      ...options,
      allowFailure: true,
      onStdoutChunk: handleProgressChunk,
      onStderrChunk: handleProgressChunk
    });
    if (progressStarted) {
      progressBar.stop();
      success(labels.success);
    } else {
      spinner.succeed(labels.success);
    }
    return result;
  } catch (error) {
    progressBar.stop();
    spinner.fail(labels.failure);
    throw error;
  }
}

async function handleDownloadFailure(
  downloadResult: RunResult,
  videoFolder: string,
  options: IngestOptions,
  warnings: string[]
): Promise<void> {
  if (downloadResult.code === 0) {
    return;
  }

  const partialAssets = await detectPartialYtDlpAssets(videoFolder, options);
  if (partialAssets.hasSomeAssets) {
    const warning = formatPartialDownloadWarning({
      exitCode: downloadResult.code,
      partialAssetsLabel: partialAssets.label,
      stderr: downloadResult.stderr,
      cookiesFromBrowser: options.cookiesFromBrowser,
      cookiesPath: options.cookiesPath
    });
    warn("Partial download", warning);
    warnings.push(warning);
    return;
  }

  const errorInfo = classifyYtDlpError(downloadResult.stderr, downloadResult.code);
  const suggestion = options.transcriptOnly
    ? ""
    : ` Try --transcript-only to fetch only text assets. ${errorInfo.suggestion}`;
  throw new Error(`${errorInfo.message}.${suggestion}`);
}

async function detectPartialYtDlpAssets(
  videoFolder: string,
  options: IngestOptions
): Promise<{ hasSomeAssets: boolean; label: string }> {
  const hasInfoJson = await pathExists(path.join(videoFolder, "source.info.json"));
  const hasVtt =
    (await findFirstFile(videoFolder, (name) => /^source\..*\.vtt$/i.test(name))) !== undefined;
  const hasSourceVideo =
    (await findFirstFile(videoFolder, (name) => /^source\.(mp4|mkv|webm|mov)$/i.test(name))) !==
    undefined;
  const hasSomeAssets = options.transcriptOnly
    ? hasInfoJson || hasVtt
    : hasInfoJson || hasSourceVideo || hasVtt;
  const label = [hasInfoJson ? "metadata" : "", hasSourceVideo ? "video" : "", hasVtt ? "subtitles" : ""]
    .filter(Boolean)
    .join(", ");

  return { hasSomeAssets, label };
}

function dryRunIngestResult(
  videoFolder: string,
  options: IngestOptions,
  warnings: string[]
): IngestResult {
  if (!options.quiet) {
    console.log(`Would normalize artifacts in ${videoFolder}`);
  }
  return {
    videoFolder,
    assets: {
      metadata: true,
      description: true,
      transcript: true,
      video: !options.transcriptOnly,
      audio: !options.transcriptOnly,
      thumbnail: !options.transcriptOnly
    },
    warnings
  };
}

async function normalizeWithSpinner(
  videoFolder: string,
  options: IngestOptions,
  label: string
): Promise<IngestedAssets> {
  const spinner = startSpinner(label, {
    enabled: shouldShowProgress(options)
  });
  const assets = await normalizeArtifacts(videoFolder, options);
  spinner.succeed(label === "Normalizing downloaded assets..." ? "Normalized downloaded assets" : "Normalization complete");
  return assets;
}

export function assertUsableAssets(assets: IngestedAssets): void {
  const canSummarize = assets.metadata || assets.description || assets.transcript;
  if (!canSummarize && !assets.video) {
    throw new Error("No usable assets were produced by yt-dlp (no video, transcript, or metadata).");
  }
}

function printIngestSummary(
  videoFolder: string,
  assets: IngestedAssets,
  options: IngestOptions
): void {
  if (options.quiet) {
    return;
  }
  success(options.transcriptOnly ? "Transcript and metadata" : "Ingested assets", videoFolder);
  if (options.transcriptOnly) {
    warn("Transcript-only mode — no video downloaded");
  }
  if (!assets.video) {
    warn("No video available — scout step will be skipped");
  }
  section("Agent Prompt");
  block(ingestedFolderAgentPrompt(videoFolder));
}

export async function writeIngestStatus(
  videoFolder: string,
  url: string,
  assets: IngestedAssets,
  warnings: string[],
  source: IngestSource
): Promise<void> {
  const status: IngestStatus = {
    url,
    videoFolder,
    timestamp: new Date().toISOString(),
    assets,
    warnings,
    source
  };
  await writeJson(ingestStatusPath(videoFolder), status);
}

export async function readIngestStatus(videoFolder: string): Promise<IngestStatus | undefined> {
  const filePath = ingestStatusPath(videoFolder);
  if (!(await pathExists(filePath))) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as IngestStatus;
    // Status files written before local ingest existed have no source field.
    return { ...parsed, source: parsed.source ?? { type: "youtube", url: parsed.url } };
  } catch {
    return undefined;
  }
}

export async function resumeIngest(videoFolder: string, options: IngestOptions): Promise<IngestResult> {
  const status = await requireIngestStatus(videoFolder);
  printResumeSummary(videoFolder, status.assets, options);

  if (status.source.type === "local") {
    return await resumeLocalIngest(videoFolder, status, options);
  }

  const warnings: string[] = [...status.warnings];
  await ensureResumeDependencies(options);

  const downloadResult = await runYtDlpDownload(status.url, videoFolder, options, {
    start: "Resuming download...",
    success: "Resume download complete",
    failure: "Resume download failed"
  });
  handleResumeDownloadWarning(downloadResult, options, warnings);

  if (options.dryRun) {
    return dryRunResumeResult(videoFolder, warnings);
  }

  const assets = await normalizeWithSpinner(videoFolder, options, "Normalizing resumed assets...");
  await runPostIngestTranscription(videoFolder, assets, options, warnings);
  await writeIngestStatus(videoFolder, status.url, assets, warnings, status.source);

  return { videoFolder, assets, warnings };
}

async function requireIngestStatus(videoFolder: string): Promise<IngestStatus> {
  const status = await readIngestStatus(videoFolder);
  if (!status) {
    throw new Error(`No ingest-status.json found in ${videoFolder}. Cannot resume.`);
  }
  return status;
}

function printResumeSummary(
  videoFolder: string,
  previousAssets: IngestedAssets,
  options: IngestOptions
): void {
  if (options.quiet) {
    return;
  }

  success("Resuming ingest", videoFolder);
  const missing = missingAssetNames(previousAssets);
  if (missing.length > 0) {
    warn("Missing assets", missing.join(", "));
  } else {
    warn("All assets already present", "nothing to resume");
  }
}

function missingAssetNames(assets: IngestedAssets): string[] {
  return [
    assets.metadata ? "" : "metadata",
    assets.description ? "" : "description",
    assets.transcript ? "" : "transcript",
    assets.video ? "" : "video"
  ].filter(Boolean);
}

async function ensureResumeDependencies(options: IngestOptions): Promise<void> {
  if (!options.dryRun) {
    await ensureDependencies(["yt-dlp"], options.verbose);
  }
}

function handleResumeDownloadWarning(
  downloadResult: RunResult,
  options: IngestOptions,
  warnings: string[]
): void {
  if (downloadResult.code === 0) {
    return;
  }
  const errorInfo = classifyYtDlpError(downloadResult.stderr, downloadResult.code);
  const retry = retrySuggestionForPartialFailure(errorInfo, {
    cookiesFromBrowser: options.cookiesFromBrowser,
    cookiesPath: options.cookiesPath
  });
  warnings.push(
    `yt-dlp exited with code ${downloadResult.code} during resume. Cause: ${errorInfo.message}. Suggested next step: ${retry}`
  );
  warn("Resume download warning", errorInfo.message);
}

function dryRunResumeResult(videoFolder: string, warnings: string[]): IngestResult {
  return {
    videoFolder,
    assets: {
      metadata: true,
      description: true,
      transcript: true,
      video: true,
      audio: true,
      thumbnail: true
    },
    warnings
  };
}

function shouldShowProgress(options: IngestOptions): boolean {
  return !options.dryRun && !options.verbose && (!options.quiet || options.showProgress === true);
}

function retrySuggestionForPartialFailure(
  errorInfo: YtDlpErrorInfo,
  options: Pick<IngestOptions, "cookiesFromBrowser" | "cookiesPath">
): string {
  if (errorInfo.category === "forbidden" && options.cookiesFromBrowser) {
    return `Retry without --cookies-from-browser ${options.cookiesFromBrowser}; public videos can fail when YouTube returns cookie-bound media URLs.`;
  }
  if (errorInfo.category === "forbidden" && options.cookiesPath) {
    return "Retry without --cookies, or refresh the cookies file from a logged-in browser session.";
  }
  return errorInfo.suggestion;
}

export async function resolveVideoFolder(defaultFolder: string, options: IngestOptions): Promise<string> {
  const answer = options.promptVideoFolder
    ? await options.promptVideoFolder(defaultFolder)
    : await promptForVideoFolder(defaultFolder);

  return expandHomePath(answer?.trim() || defaultFolder);
}

function expandHomePath(value: string): string {
  if (value === "~") {
    return homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(homedir(), value.slice(2));
  }
  return value;
}

async function promptForVideoFolder(defaultFolder: string): Promise<string | undefined> {
  if (!input.isTTY || !output.isTTY) {
    return undefined;
  }

  return await promptInput({
    message: "Where should this video be saved?",
    default: defaultFolder
  });
}

async function readVideoMetadata(url: string, options: RunOptions): Promise<YtDlpMetadata> {
  if (options.dryRun) {
    return { id: "dry-run", title: "youtube-video" };
  }

  const result = await runCommand("yt-dlp", ["--dump-json", "--no-playlist", url], {
    capture: true,
    verbose: options.verbose
  });

  return JSON.parse(result.stdout) as YtDlpMetadata;
}

export async function normalizeArtifacts(
  videoFolder: string,
  options: RunOptions
): Promise<IngestedAssets> {
  const assets: IngestedAssets = {
    metadata: false,
    description: false,
    transcript: false,
    video: false,
    audio: false,
    thumbnail: false
  };

  assets.metadata = await moveIfExists(
    await findFirstFile(videoFolder, (name) => name === "source.info.json"),
    path.join(videoFolder, "metadata.info.json")
  );
  assets.description = await moveIfExists(
    await findFirstFile(videoFolder, (name) => name === "source.description"),
    path.join(videoFolder, "description.txt")
  );

  // Best-effort thumbnail conversion (yt-dlp downloads source.webp/png; we convert to thumbnail.jpg)
  const thumbnailSource = await findFirstFile(videoFolder, (name) =>
    /^source\.(webp|jpg|jpeg|png)$/i.test(name)
  );
  if (thumbnailSource) {
    const ext = path.extname(thumbnailSource).toLowerCase();
    if (ext === ".jpg" || ext === ".jpeg") {
      assets.thumbnail = await moveIfExists(thumbnailSource, path.join(videoFolder, "thumbnail.jpg"));
    } else {
      try {
        await runCommand(
          "ffmpeg",
          ["-y", "-i", thumbnailSource, path.join(videoFolder, "thumbnail.jpg")],
          { ...options, allowFailure: false }
        );
        assets.thumbnail = true;
      } catch {
        warn("Thumbnail conversion failed", path.basename(thumbnailSource));
        // Keep original file as a fallback
        await moveIfExists(thumbnailSource, path.join(videoFolder, `thumbnail${ext}`));
      }
    }
  }

  const vtt = await findFirstFile(videoFolder, (name) => /^source\..*\.vtt$/i.test(name));
  if (await copyIfExists(vtt, path.join(videoFolder, "transcript.vtt"))) {
    assets.transcript = true;
    await runCommand(
      "ffmpeg",
      ["-y", "-i", path.join(videoFolder, "transcript.vtt"), path.join(videoFolder, "transcript.srt")],
      { ...options, allowFailure: true }
    );
  }

  const sourceVideo = await findFirstFile(videoFolder, (name) =>
    /^source\.(mp4|mkv|webm|mov)$/i.test(name)
  );
  if (sourceVideo) {
    assets.video = true;
    try {
      await runCommand(
        "ffmpeg",
        ["-y", "-i", sourceVideo, "-vn", "-ac", "1", "-ar", "16000", path.join(videoFolder, "audio.wav")],
        options
      );
      assets.audio = true;
    } catch {
      warn("Audio extraction failed", path.basename(sourceVideo));
    }
  }

  return assets;
}
