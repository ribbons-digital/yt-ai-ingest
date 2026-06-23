import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureDependencies } from "../lib/dependencies.js";
import { ensureDir, writeJson } from "../lib/files.js";
import { findSourceVideo, getVideoDurationSeconds } from "../lib/media.js";
import {
  buildScoutTimeline,
  buildTemporalPlan,
  type ScoutMoment,
  type TemporalBlock
} from "../lib/scoutPlan.js";
import { runCommand, type RunOptions } from "../lib/process.js";
import { success } from "../lib/ui.js";

type ScoutOptions = RunOptions & {
  interval: number;
  out?: string;
  columns: number;
  enhanced?: boolean;
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

type TemporalManifest = {
  sourceVideo: string;
  durationSeconds: number;
  outputFolder: string;
  settings: {
    enhanced: true;
    intervalSeconds: number;
    blockFrameCount: number;
    stripLayout: "horizontal";
  };
  blocks: TemporalManifestBlock[];
  generatedAt: string;
};

type TemporalManifestBlock = Omit<TemporalBlock, "scoutFrame"> & {
  framePaths: string[];
  stripPath: string;
  scoutFramePath?: string;
};

const TEMPORAL_BLOCK_FRAME_COUNT = 4;

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

  const temporalManifest = options.enhanced
    ? await buildEnhancedTemporalScout({
        sourceVideo,
        outDir,
        durationSeconds,
        intervalSeconds: options.interval,
        moments,
        options
      })
    : undefined;

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
    if (temporalManifest) {
      await writeJson(path.join(analysisDir, "temporal-manifest.json"), temporalManifest);
      await writeTemporalContext(
        path.join(analysisDir, "temporal-context.md"),
        temporalManifest,
        videoFolder
      );
    }
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

async function buildEnhancedTemporalScout(input: {
  sourceVideo: string;
  outDir: string;
  durationSeconds: number;
  intervalSeconds: number;
  moments: ScoutMoment[];
  options: ScoutOptions;
}): Promise<TemporalManifest> {
  const temporalRoot = path.join(input.outDir, "temporal");
  const blocks = buildTemporalPlan({
    moments: input.moments,
    durationSeconds: input.durationSeconds,
    blockFrameCount: TEMPORAL_BLOCK_FRAME_COUNT
  });

  await ensureDir(temporalRoot);

  const manifestBlocks: TemporalManifestBlock[] = [];
  for (const block of blocks) {
    const blockDir = path.join(temporalRoot, `block_${String(block.index).padStart(4, "0")}`);
    await ensureDir(blockDir);

    const framePaths: string[] = [];
    for (const [frameIndex, timestamp] of block.frameTimestamps.entries()) {
      const framePath = path.join(blockDir, `frame_${String(frameIndex + 1).padStart(4, "0")}.jpg`);
      await extractTemporalFrame(input.sourceVideo, framePath, timestamp, input.options);
      framePaths.push(framePath);
    }

    const stripPath = path.join(blockDir, "strip.jpg");
    await buildTemporalStrip(blockDir, stripPath, framePaths.length, input.options);

    manifestBlocks.push({
      index: block.index,
      centerTimestampSeconds: block.centerTimestampSeconds,
      centerTimestamp: block.centerTimestamp,
      startSeconds: block.startSeconds,
      endSeconds: block.endSeconds,
      frameTimestamps: block.frameTimestamps,
      frameTimestampLabels: block.frameTimestampLabels,
      framePaths,
      stripPath,
      scoutFramePath: path.join(input.outDir, block.scoutFrame),
      reason: block.reason
    });
  }

  return {
    sourceVideo: input.sourceVideo,
    durationSeconds: input.durationSeconds,
    outputFolder: temporalRoot,
    settings: {
      enhanced: true,
      intervalSeconds: input.intervalSeconds,
      blockFrameCount: TEMPORAL_BLOCK_FRAME_COUNT,
      stripLayout: "horizontal"
    },
    blocks: manifestBlocks,
    generatedAt: new Date().toISOString()
  };
}

async function extractTemporalFrame(
  sourceVideo: string,
  framePath: string,
  timestampSeconds: number,
  options: ScoutOptions
): Promise<void> {
  await runCommand(
    "ffmpeg",
    [
      "-y",
      "-ss",
      String(timestampSeconds),
      "-i",
      sourceVideo,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      framePath
    ],
    options
  );
}

async function buildTemporalStrip(
  blockDir: string,
  stripPath: string,
  frameCount: number,
  options: ScoutOptions
): Promise<void> {
  await runCommand(
    "ffmpeg",
    [
      "-y",
      "-framerate",
      "1",
      "-i",
      path.join(blockDir, "frame_%04d.jpg"),
      "-vf",
      `scale=320:-1,tile=${frameCount}x1`,
      "-frames:v",
      "1",
      stripPath
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

async function writeTemporalContext(
  target: string,
  manifest: TemporalManifest,
  videoFolder: string
): Promise<void> {
  const lines = [
    "# Enhanced Temporal Scout Context",
    "",
    "Enhanced temporal scout is available for this video.",
    "These assets contain ordered before/during/after frame groups around each scout moment.",
    "They are local ffmpeg evidence, not native video-token model understanding.",
    "Read each strip left-to-right as temporal progression.",
    "",
    `Temporal blocks: ${path.relative(videoFolder, manifest.outputFolder)}`,
    "",
    "## Timeline",
    "",
    ...manifest.blocks.map((block) =>
      [
        `- ${block.centerTimestamp} (${block.reason}, ${formatRange(block)}): ${path.relative(
          videoFolder,
          block.stripPath
        )}`,
        ...block.framePaths.map(
          (framePath, index) =>
            `  - ${block.frameTimestampLabels[index]}: ${path.relative(videoFolder, framePath)}`
        )
      ].join("\n")
    ),
    ""
  ];

  await writeFile(target, lines.join("\n"), "utf8");
}

function formatRange(block: TemporalManifestBlock): string {
  const start = block.frameTimestampLabels[0];
  const end = block.frameTimestampLabels[block.frameTimestampLabels.length - 1];
  return `${start} -> ${end}`;
}

function assertPositiveInteger(value: number, flag: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be an integer greater than 0.`);
  }
}
