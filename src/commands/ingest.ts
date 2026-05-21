import { input as promptInput } from "@inquirer/prompts";
import { homedir } from "node:os";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { ensureDependencies } from "../lib/dependencies.js";
import {
  copyIfExists,
  ensureDir,
  findFirstFile,
  moveIfExists,
  safeSlug
} from "../lib/files.js";
import { findSourceVideo } from "../lib/media.js";
import { ingestedFolderAgentPrompt } from "../lib/agentPrompt.js";
import { runCommand, type RunOptions } from "../lib/process.js";
import { block, section, startSpinner, success } from "../lib/ui.js";

type IngestOptions = RunOptions & {
  outDir: string;
  showProgress?: boolean;
  promptVideoFolder?: (defaultFolder: string) => Promise<string | undefined>;
};

type YtDlpMetadata = {
  id?: string;
  title?: string;
};

export async function ingest(url: string, options: IngestOptions): Promise<string> {
  if (!options.dryRun) {
    await ensureDependencies(["yt-dlp", "ffmpeg"], options.verbose);
  }

  const metadataSpinner = startSpinner("Reading video metadata...", {
    enabled: shouldShowProgress(options)
  });
  let metadata: YtDlpMetadata;
  try {
    metadata = await readVideoMetadata(url, options);
    metadataSpinner.succeed("Read video metadata");
  } catch (error) {
    metadataSpinner.fail("Could not read video metadata");
    throw error;
  }
  const folderName = [
    new Date().toISOString().slice(0, 10),
    safeSlug(metadata.title ?? "youtube-video"),
    safeSlug(metadata.id ?? "unknown")
  ].join("_");
  const defaultVideoFolder = path.join(options.outDir, folderName);
  const videoFolder = await resolveVideoFolder(defaultVideoFolder, options);

  await ensureDir(path.join(videoFolder, "frames"));
  await ensureDir(path.join(videoFolder, "clips"));
  await ensureDir(path.join(videoFolder, "analysis"));

  const spinner = startSpinner("Downloading video assets...", {
    enabled: shouldShowProgress(options)
  });
  try {
    await runCommand(
      "yt-dlp",
      [
        "--no-playlist",
        "--write-info-json",
        "--write-description",
        "--write-thumbnail",
        "--convert-thumbnails",
        "jpg",
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs",
        "en.*",
        "--sub-format",
        "vtt/best",
        "-f",
        "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best",
        "--merge-output-format",
        "mp4",
        "-o",
        path.join(videoFolder, "source.%(ext)s"),
        url
      ],
      options
    );
    spinner.succeed("Downloaded video assets");
  } catch (error) {
    spinner.fail("Download failed");
    throw error;
  }

  if (options.dryRun) {
    if (!options.quiet) {
      console.log(`Would normalize artifacts in ${videoFolder}`);
    }
    return videoFolder;
  }

  const normalizeSpinner = startSpinner("Normalizing local assets...", {
    enabled: shouldShowProgress(options)
  });
  try {
    await normalizeArtifacts(videoFolder, options);
    normalizeSpinner.succeed("Normalized local assets");
  } catch (error) {
    normalizeSpinner.fail("Normalization failed");
    throw error;
  }
  if (!options.quiet) {
    success("Ingested assets", videoFolder);
    section("Agent Prompt");
    block(ingestedFolderAgentPrompt(videoFolder));
  }
  return videoFolder;
}

function shouldShowProgress(options: IngestOptions): boolean {
  return !options.dryRun && !options.verbose && (!options.quiet || options.showProgress === true);
}

async function resolveVideoFolder(defaultFolder: string, options: IngestOptions): Promise<string> {
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

async function normalizeArtifacts(videoFolder: string, options: RunOptions): Promise<void> {
  await moveIfExists(
    await findFirstFile(videoFolder, (name) => name === "source.info.json"),
    path.join(videoFolder, "metadata.info.json")
  );
  await moveIfExists(
    await findFirstFile(videoFolder, (name) => name === "source.description"),
    path.join(videoFolder, "description.txt")
  );
  await moveIfExists(
    await findFirstFile(videoFolder, (name) => /^source\.(jpg|jpeg)$/i.test(name)),
    path.join(videoFolder, "thumbnail.jpg")
  );

  const vtt = await findFirstFile(videoFolder, (name) => /^source\..*\.vtt$/i.test(name));
  if (await copyIfExists(vtt, path.join(videoFolder, "transcript.vtt"))) {
    await runCommand(
      "ffmpeg",
      ["-y", "-i", path.join(videoFolder, "transcript.vtt"), path.join(videoFolder, "transcript.srt")],
      { ...options, allowFailure: true }
    );
  }

  const sourceVideo = await findSourceVideo(videoFolder);
  await runCommand(
    "ffmpeg",
    ["-y", "-i", sourceVideo, "-vn", "-ac", "1", "-ar", "16000", path.join(videoFolder, "audio.wav")],
    options
  );
}
