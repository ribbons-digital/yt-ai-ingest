import path from "node:path";
import { ensureDependencies } from "../lib/dependencies.js";
import { ensureDir } from "../lib/files.js";
import { formatSeconds, parseTimestamp } from "../lib/timestamps.js";
import { runCommand, type RunOptions } from "../lib/process.js";

type ClipOptions = RunOptions & {
  from: string;
  to: string;
  outDir: string;
  forceKeyframes?: boolean;
};

export async function clip(url: string, options: ClipOptions): Promise<void> {
  if (!options.dryRun) {
    await ensureDependencies(["yt-dlp", "ffmpeg"], options.verbose);
  }

  const start = parseTimestamp(options.from);
  const end = parseTimestamp(options.to);
  if (end <= start) {
    throw new Error("--to must be after --from.");
  }

  await ensureDir(options.outDir);

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

  args.push(url);

  await runCommand("yt-dlp", args, options);
}
