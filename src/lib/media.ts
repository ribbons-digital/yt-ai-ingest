import path from "node:path";
import { findFirstFile } from "./files.js";
import { runCommand, type RunOptions } from "./process.js";

export async function findSourceVideo(videoFolder: string): Promise<string> {
  const source = await findFirstFile(videoFolder, (name) =>
    /^source\.(mp4|mkv|webm|mov)$/i.test(name)
  );

  if (!source) {
    throw new Error(`Could not find source video in ${videoFolder}. Expected source.mp4 or similar.`);
  }

  return source;
}

export async function getVideoDurationSeconds(
  videoPath: string,
  options: Pick<RunOptions, "verbose"> = {}
): Promise<number | undefined> {
  const result = await runCommand(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      videoPath
    ],
    { capture: true, allowFailure: true, verbose: options.verbose }
  );

  const duration = Number.parseFloat(result.stdout.trim());
  return Number.isFinite(duration) ? duration : undefined;
}

export function defaultFramesDir(videoFolder: string): string {
  return path.join(videoFolder, "frames");
}
