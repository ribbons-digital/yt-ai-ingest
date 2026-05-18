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
import { runCommand, type RunOptions } from "../lib/process.js";

type IngestOptions = RunOptions & {
  outDir: string;
};

type YtDlpMetadata = {
  id?: string;
  title?: string;
};

export async function ingest(url: string, options: IngestOptions): Promise<void> {
  if (!options.dryRun) {
    await ensureDependencies(["yt-dlp", "ffmpeg"], options.verbose);
  }

  const metadata = await readVideoMetadata(url, options);
  const folderName = [
    new Date().toISOString().slice(0, 10),
    safeSlug(metadata.title ?? "youtube-video"),
    safeSlug(metadata.id ?? "unknown")
  ].join("_");
  const videoFolder = path.join(options.outDir, folderName);

  await ensureDir(path.join(videoFolder, "frames"));
  await ensureDir(path.join(videoFolder, "clips"));
  await ensureDir(path.join(videoFolder, "analysis"));

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

  if (options.dryRun) {
    console.log(`Would normalize artifacts in ${videoFolder}`);
    return;
  }

  await normalizeArtifacts(videoFolder, options);
  console.log(`Ingested assets: ${videoFolder}`);
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
