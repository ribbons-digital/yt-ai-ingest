import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { ensureDependencies } from "../lib/dependencies.js";
import { ensureDir, writeJson } from "../lib/files.js";
import { chooseFrameExtractionMode, type RequestedFrameMode } from "../lib/frameMode.js";
import { defaultFramesDir, findSourceVideo, getVideoDurationSeconds } from "../lib/media.js";
import { runCommand, type RunOptions } from "../lib/process.js";
import {
  assertPositiveFps,
  parseRange,
  rangeAround,
  type TimeRange
} from "../lib/timestamps.js";
import { success } from "../lib/ui.js";

type FramesOptions = RunOptions & {
  around?: string;
  window: number;
  fps: number;
  out?: string;
  ranges: string[];
  mode: RequestedFrameMode;
};

export async function frames(videoFolder: string, options: FramesOptions): Promise<void> {
  if (!options.dryRun) {
    await ensureDependencies(["ffmpeg", "ffprobe"], options.verbose);
  }
  assertPositiveFps(options.fps);

  const sourceVideo = await findSourceVideo(videoFolder);
  const ranges = resolveRanges(options);
  const outDir = await resolveOutDir(videoFolder, options);
  await ensureDir(outDir);

  const durationSeconds =
    options.mode === "auto" && !options.dryRun
      ? await getVideoDurationSeconds(sourceVideo, options)
      : undefined;
  const resolvedMode = chooseFrameExtractionMode({
    requestedMode: options.mode,
    durationSeconds,
    ranges
  });

  if (resolvedMode === "select") {
    await runSelectMode(sourceVideo, ranges, outDir, options);
  } else {
    await runSeekMode(sourceVideo, ranges, outDir, options);
  }

  if (!options.dryRun) {
    await writeJson(path.join(outDir, "frames_manifest.json"), {
      sourceVideo,
      ranges,
      fps: options.fps,
      outputFolder: outDir,
      generatedFilePattern:
        resolvedMode === "select" ? "frame_%05d.jpg" : "range_XXX/frame_%04d.jpg",
      extractionMethod: resolvedMode,
      requestedMode: options.mode,
      durationSeconds,
      extractedAt: new Date().toISOString()
    });
  }

  if (!options.quiet) {
    success(`Frames ${options.dryRun ? "planned" : "written"}`, outDir);
  }
}

function resolveRanges(options: FramesOptions): TimeRange[] {
  const ranges = options.ranges.map(parseRange);

  if (options.around) {
    ranges.push(rangeAround(options.around, options.window));
  }

  if (ranges.length === 0) {
    throw new Error("Provide --around TIMESTAMP or at least one --range START-END.");
  }

  return ranges;
}

async function resolveOutDir(videoFolder: string, options: FramesOptions): Promise<string> {
  const defaultDir = defaultFramesDir(videoFolder);
  if (options.out) {
    return options.out;
  }

  if (!input.isTTY || !output.isTTY) {
    return defaultDir;
  }

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`Where should frames be saved? [${defaultDir}] `);
    return answer.trim() || defaultDir;
  } finally {
    rl.close();
  }
}

async function runSelectMode(
  sourceVideo: string,
  ranges: TimeRange[],
  outDir: string,
  options: FramesOptions
): Promise<void> {
  const expression = ranges
    .map((range) => `between(t,${range.start},${range.end})`)
    .join("+");

  await runCommand(
    "ffmpeg",
    [
      "-y",
      "-i",
      sourceVideo,
      "-vf",
      `fps=${options.fps},select='${expression}'`,
      "-vsync",
      "vfr",
      path.join(outDir, "frame_%05d.jpg")
    ],
    options
  );
}

async function runSeekMode(
  sourceVideo: string,
  ranges: TimeRange[],
  outDir: string,
  options: FramesOptions
): Promise<void> {
  for (const [index, range] of ranges.entries()) {
    const rangeDir = path.join(outDir, `range_${String(index + 1).padStart(3, "0")}`);
    await ensureDir(rangeDir);
    await runCommand(
      "ffmpeg",
      [
        "-y",
        "-ss",
        String(range.start),
        "-i",
        sourceVideo,
        "-t",
        String(range.end - range.start),
        "-vf",
        `fps=${options.fps}`,
        path.join(rangeDir, "frame_%04d.jpg")
      ],
      options
    );
  }
}
