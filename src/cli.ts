#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { ask, summarize } from "./commands/context.js";
import { clip } from "./commands/clip.js";
import { frames } from "./commands/frames.js";
import { ingest } from "./commands/ingest.js";
import { prepare } from "./commands/prepare.js";
import { scout } from "./commands/scout.js";
import type { RequestedFrameMode } from "./lib/frameMode.js";

const program = new Command();

program
  .name("ytai")
  .description("Local YouTube AI-ingestion CLI")
  .version("0.1.0")
  .option("--dry-run", "print commands without executing them")
  .option("--verbose", "print command details and extra diagnostics");

program
  .command("ingest")
  .description("Download a YouTube video into an AI-ready local asset folder")
  .argument("<url>", "YouTube URL")
  .option("--out-dir <dir>", "base output directory", "videos")
  .action(async (url: string, options: { outDir: string }) => {
    await runCli(() => ingest(url, { ...globalOptions(), ...options }));
  });

program
  .command("prepare")
  .description("Ingest, scout, and create a summary context in one local workflow")
  .argument("<url>", "YouTube URL")
  .option("--out-dir <dir>", "base output directory", "videos")
  .option("--scout-interval <seconds>", "seconds between sampled scout frames", parsePositiveInteger, 60)
  .option("--scout-columns <number>", "contact sheet columns", parsePositiveInteger, 4)
  .action(
    async (
      url: string,
      options: {
        outDir: string;
        scoutInterval: number;
        scoutColumns: number;
      }
    ) => {
      await runCli(() => prepare(url, { ...globalOptions(), ...options }));
    }
  );

program
  .command("clip")
  .description("Download only a timestamp section of a YouTube video")
  .argument("<url>", "YouTube URL")
  .requiredOption("--from <timestamp>", "clip start timestamp, e.g. 03:20")
  .requiredOption("--to <timestamp>", "clip end timestamp, e.g. 05:10")
  .option("--out-dir <dir>", "clip output directory", "videos/clips")
  .option("--force-keyframes", "force keyframes at cuts for more precise but slower clips")
  .action(
    async (
      url: string,
      options: { from: string; to: string; outDir: string; forceKeyframes?: boolean }
    ) => {
      await runCli(() => clip(url, { ...globalOptions(), ...options }));
    }
  );

program
  .command("frames")
  .description("Extract frames from a local ingested video folder")
  .argument("<video-folder>", "folder created by ytai ingest")
  .option("--around <timestamp>", "extract around a timestamp")
  .option("--window <seconds>", "seconds before and after --around", parsePositiveNumber, 10)
  .option("--range <start-end>", "timestamp range; can be repeated", collect, [])
  .option("--fps <number>", "frames per second", parsePositiveNumber, 1)
  .option("--out <dir>", "output directory for frames")
  .option("--mode <mode>", "frame extraction mode: select, seek, auto", parseFrameMode, "auto")
  .action(
    async (
      videoFolder: string,
      options: {
        around?: string;
        window: number;
        range: string[];
        fps: number;
        out?: string;
        mode: RequestedFrameMode;
      }
    ) => {
      await runCli(() =>
        frames(videoFolder, {
          ...globalOptions(),
          around: options.around,
          window: options.window,
          ranges: options.range,
          fps: options.fps,
          out: options.out,
          mode: options.mode
        })
      );
    }
  );

program
  .command("scout")
  .description("Automatically sample visual context from an ingested video folder")
  .argument("<video-folder>", "folder created by ytai ingest")
  .option("--interval <seconds>", "seconds between sampled frames", parsePositiveInteger, 60)
  .option("--out <dir>", "output directory for scout frames")
  .option("--columns <number>", "contact sheet columns", parsePositiveInteger, 4)
  .action(
    async (
      videoFolder: string,
      options: {
        interval: number;
        out?: string;
        columns: number;
      }
    ) => {
      await runCli(() => scout(videoFolder, { ...globalOptions(), ...options }));
    }
  );

program
  .command("summarize")
  .description("Create a local AI summary prompt from an ingested video folder")
  .argument("<video-folder>", "folder created by ytai ingest")
  .action(async (videoFolder: string) => {
    await runCli(() => summarize(videoFolder, globalOptions()));
  });

program
  .command("ask")
  .description("Create a local AI question prompt from an ingested video folder")
  .argument("<video-folder>", "folder created by ytai ingest")
  .argument("<question>", "question to answer from local assets")
  .action(async (videoFolder: string, question: string) => {
    await runCli(() => ask(videoFolder, question, globalOptions()));
  });

await program.parseAsync();

function globalOptions(): { dryRun?: boolean; verbose?: boolean } {
  const options = program.opts<{ dryRun?: boolean; verbose?: boolean }>();
  return {
    dryRun: options.dryRun,
    verbose: options.verbose
  };
}

async function runCli(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ytai: ${message}`);
    process.exitCode = 1;
  }
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parsePositiveNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidArgumentError("must be a number greater than 0");
  }
  return parsed;
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError("must be an integer greater than 0");
  }
  return parsed;
}

function parseFrameMode(value: string): RequestedFrameMode {
  if (value === "select" || value === "seek" || value === "auto") {
    return value;
  }
  throw new InvalidArgumentError("must be select, seek, or auto");
}
