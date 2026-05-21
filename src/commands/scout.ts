import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureDependencies } from "../lib/dependencies.js";
import { ensureDir, writeJson } from "../lib/files.js";
import { findSourceVideo, getVideoDurationSeconds } from "../lib/media.js";
import { buildScoutTimeline, type ScoutMoment } from "../lib/scoutPlan.js";
import { runCommand, type RunOptions } from "../lib/process.js";
import { success } from "../lib/ui.js";

type ScoutOptions = RunOptions & {
  interval: number;
  out?: string;
  columns: number;
};

type ScoutManifest = {
  sourceVideo: string;
  durationSeconds: number;
  intervalSeconds: number;
  outputFolder: string;
  contactSheet: string;
  moments: Array<ScoutMoment & { framePath: string }>;
  generatedAt: string;
};

export async function scout(videoFolder: string, options: ScoutOptions): Promise<void> {
  if (!options.dryRun) {
    await ensureDependencies(["ffmpeg", "ffprobe"], options.verbose);
  }
  assertPositiveInteger(options.interval, "--interval");
  assertPositiveInteger(options.columns, "--columns");

  const sourceVideo = await resolveSourceVideo(videoFolder, options);
  const durationSeconds = await resolveDuration(sourceVideo, options);
  const outDir = options.out ?? path.join(videoFolder, "frames", "scout");
  const analysisDir = path.join(videoFolder, "analysis");
  const contactSheet = path.join(outDir, "contact_sheet.jpg");
  const moments = buildScoutTimeline({
    durationSeconds,
    intervalSeconds: options.interval
  });

  await ensureDir(outDir);
  await ensureDir(analysisDir);

  for (const moment of moments) {
    await extractFrame(sourceVideo, outDir, moment, options);
  }
  await buildContactSheet(outDir, contactSheet, moments.length, options);

  if (!options.dryRun) {
    const manifest: ScoutManifest = {
      sourceVideo,
      durationSeconds,
      intervalSeconds: options.interval,
      outputFolder: outDir,
      contactSheet,
      moments: moments.map((moment) => ({
        ...moment,
        framePath: path.join(outDir, moment.frame)
      })),
      generatedAt: new Date().toISOString()
    };
    await writeJson(path.join(analysisDir, "scout-manifest.json"), manifest);
    await writeVisualContext(path.join(analysisDir, "visual-context.md"), manifest, videoFolder);
  }

  if (!options.quiet) {
    success(`Scout ${options.dryRun ? "planned" : "written"}`, outDir);
  }
}

async function resolveDuration(sourceVideo: string, options: ScoutOptions): Promise<number> {
  if (options.dryRun) {
    return options.interval;
  }

  const duration = await getVideoDurationSeconds(sourceVideo, options);
  if (duration === undefined) {
    throw new Error(`Could not read video duration: ${sourceVideo}`);
  }
  return Math.ceil(duration);
}

async function resolveSourceVideo(videoFolder: string, options: ScoutOptions): Promise<string> {
  if (!options.dryRun) {
    return await findSourceVideo(videoFolder);
  }

  return path.join(videoFolder, "source.mp4");
}

async function extractFrame(
  sourceVideo: string,
  outDir: string,
  moment: ScoutMoment,
  options: ScoutOptions
): Promise<void> {
  await runCommand(
    "ffmpeg",
    [
      "-y",
      "-ss",
      String(moment.timestampSeconds),
      "-i",
      sourceVideo,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      path.join(outDir, moment.frame)
    ],
    options
  );
}

async function buildContactSheet(
  outDir: string,
  contactSheet: string,
  frameCount: number,
  options: ScoutOptions
): Promise<void> {
  const rows = Math.ceil(frameCount / options.columns);
  await runCommand(
    "ffmpeg",
    [
      "-y",
      "-framerate",
      "1",
      "-i",
      path.join(outDir, "frame_%04d.jpg"),
      "-vf",
      `scale=320:-1,tile=${options.columns}x${rows}`,
      "-frames:v",
      "1",
      contactSheet
    ],
    options
  );
}

async function writeVisualContext(
  target: string,
  manifest: ScoutManifest,
  videoFolder: string
): Promise<void> {
  const lines = [
    "# Visual Scout Context",
    "",
    `Contact sheet: ${path.relative(videoFolder, manifest.contactSheet)}`,
    "",
    "## Timeline",
    "",
    ...manifest.moments.map(
      (moment) =>
        `- ${moment.timestamp} (${moment.reason}): ${path.relative(videoFolder, moment.framePath)}`
    ),
    ""
  ];

  await writeFile(target, lines.join("\n"), "utf8");
}

function assertPositiveInteger(value: number, flag: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be an integer greater than 0.`);
  }
}
