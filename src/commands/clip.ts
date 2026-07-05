import path from "node:path";
import { ensureDependencies } from "../lib/dependencies.js";
import { ensureDir, pathExists, safeSlug } from "../lib/files.js";
import { formatSeconds, parseTimestamp } from "../lib/timestamps.js";
import { runCommand, type RunOptions } from "../lib/process.js";
import { classifySourceInput } from "./ingest.js";

type ClipOptions = RunOptions & {
  from: string;
  to: string;
  outDir: string;
  forceKeyframes?: boolean;
};

export async function clip(source: string, options: ClipOptions): Promise<void> {
  const kind = classifySourceInput(source);
  if (!options.dryRun) {
    await ensureDependencies(kind === "local" ? ["ffmpeg"] : ["yt-dlp", "ffmpeg"], options.verbose);
  }

  const start = parseTimestamp(options.from);
  const end = parseTimestamp(options.to);
  if (end <= start) {
    throw new Error("--to must be after --from.");
  }

  await ensureDir(options.outDir);

  if (kind === "local") {
    await clipLocal(source, start, end, options);
    return;
  }

  const section = `*${formatSeconds(start)}-${formatSeconds(end)}`;
  const output = path.join(
    options.outDir,
    `%(title).80B_%(id)s_clip_${start}-${end}.%(ext)s`
  );

  const args = [
    "--no-playlist",
    "--download-sections",
    section,
    "-f",
    "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best",
    "--merge-output-format",
    "mp4",
    "-o",
    output
  ];

  if (options.forceKeyframes) {
    args.push("--force-keyframes-at-cuts");
  }

  args.push(source);

  await runCommand("yt-dlp", args, options);
}

async function clipLocal(
  filePath: string,
  start: number,
  end: number,
  options: ClipOptions
): Promise<void> {
  const absolutePath = path.resolve(filePath);
  if (!options.dryRun && !(await pathExists(absolutePath))) {
    throw new Error(
      `Local video file not found: ${absolutePath}. If you meant a remote video, URLs must start with http:// or https://.`
    );
  }

  const stem = path.basename(absolutePath, path.extname(absolutePath));
  const output = path.join(options.outDir, `${safeSlug(stem)}_clip_${start}-${end}.mp4`);
  const from = formatSeconds(start);
  const to = formatSeconds(end);

  // Stream copy by default; --force-keyframes re-encodes with -ss/-to after -i for frame accuracy.
  const args = options.forceKeyframes
    ? ["-y", "-i", absolutePath, "-ss", from, "-to", to, "-c:v", "libx264", "-c:a", "aac", output]
    : ["-y", "-ss", from, "-to", to, "-i", absolutePath, "-c", "copy", output];

  await runCommand("ffmpeg", args, options);
}
