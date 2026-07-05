#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { ask, summarize } from "./commands/context.js";
import { clip } from "./commands/clip.js";
import { frames } from "./commands/frames.js";
import { ingest, resumeIngest } from "./commands/ingest.js";
import { learnStatus, plan, recordScore, teach, topics } from "./commands/learn.js";
import { quiz } from "./commands/quiz.js";
import { prepare } from "./commands/prepare.js";
import { scout } from "./commands/scout.js";
import { transcribe } from "./commands/transcribe.js";
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
  .description("Ingest a YouTube video or local video file into an AI-ready local asset folder")
  .argument("<source>", "YouTube URL or local video file path")
  .option("--out-dir <dir>", "base output directory", "videos")
  .option("--transcript-only", "skip video download, only fetch transcript, description, and metadata")
  .option("--rate-limit", "add delays between requests to avoid YouTube rate limits")
  .option("--cookies-from-browser <name>", "use browser cookies for authentication (chrome, safari, firefox, etc.)")
  .option("--cookies <path>", "path to a cookies.txt file for authentication")
  .option("--link", "hardlink local source video instead of copying")
  .option("--transcribe", "transcribe audio locally with whisper when no transcript exists")
  .option("--whisper-model <name>", "whisper model name to use with --transcribe")
  .option("--language <code>", "spoken language code for transcription, e.g. en")
  .action(
    async (
      source: string,
      options: {
        outDir: string;
        transcriptOnly?: boolean;
        rateLimit?: boolean;
        cookiesFromBrowser?: string;
        cookies?: string;
        link?: boolean;
        transcribe?: boolean;
        whisperModel?: string;
        language?: string;
      }
    ) => {
      await runCli(() =>
        ingest(source, {
          ...globalOptions(),
          outDir: options.outDir,
          transcriptOnly: options.transcriptOnly,
          rateLimit: options.rateLimit,
          cookiesFromBrowser: options.cookiesFromBrowser,
          cookiesPath: options.cookies,
          link: options.link,
          transcribe: options.transcribe,
          whisperModel: options.whisperModel,
          language: options.language
        })
      );
    }
  );

program
  .command("prepare")
  .description("Ingest, scout, and create a summary context in one local workflow")
  .argument("<source>", "YouTube URL or local video file path")
  .option("--out-dir <dir>", "base output directory", "videos")
  .option("--scout-interval <seconds>", "seconds between sampled scout frames", parsePositiveInteger, 60)
  .option("--scout-columns <number>", "contact sheet columns", parsePositiveInteger, 4)
  .option("--enhanced-scout", "also create temporal frame groups during scout")
  .option("--transcript-only", "skip video download, only fetch transcript, description, and metadata")
  .option("--rate-limit", "add delays between requests to avoid YouTube rate limits")
  .option("--cookies-from-browser <name>", "use browser cookies for authentication (chrome, safari, firefox, etc.)")
  .option("--cookies <path>", "path to a cookies.txt file for authentication")
  .option("--resume", "resume a previous partial ingest; fill in missing assets")
  .option("--link", "hardlink local source video instead of copying")
  .option("--transcribe", "transcribe audio locally with whisper when no transcript exists")
  .option("--whisper-model <name>", "whisper model name to use with --transcribe")
  .option("--language <code>", "spoken language code for transcription, e.g. en")
  .action(
    async (
      source: string,
      options: {
        outDir: string;
        scoutInterval: number;
        scoutColumns: number;
        transcriptOnly?: boolean;
        rateLimit?: boolean;
        cookiesFromBrowser?: string;
        cookies?: string;
        resume?: boolean;
        enhancedScout?: boolean;
        link?: boolean;
        transcribe?: boolean;
        whisperModel?: string;
        language?: string;
      }
    ) => {
      await runCli(() =>
        prepare(source, {
          ...globalOptions(),
          outDir: options.outDir,
          scoutInterval: options.scoutInterval,
          scoutColumns: options.scoutColumns,
          transcriptOnly: options.transcriptOnly,
          rateLimit: options.rateLimit,
          cookiesFromBrowser: options.cookiesFromBrowser,
          cookiesPath: options.cookies,
          resume: options.resume,
          enhancedScout: options.enhancedScout,
          link: options.link,
          transcribe: options.transcribe,
          whisperModel: options.whisperModel,
          language: options.language
        })
      );
    }
  );

program
  .command("resume")
  .description("Resume a previous partial ingest on an existing video folder")
  .argument("<video-folder>", "folder created by ytai ingest (must contain ingest-status.json)")
  .option("--rate-limit", "add delays between requests to avoid YouTube rate limits")
  .option("--cookies-from-browser <name>", "use browser cookies for authentication (chrome, safari, firefox, etc.)")
  .option("--cookies <path>", "path to a cookies.txt file for authentication")
  .action(
    async (
      videoFolder: string,
      options: {
        rateLimit?: boolean;
        cookiesFromBrowser?: string;
        cookies?: string;
      }
    ) => {
      await runCli(() =>
        resumeIngest(videoFolder, {
          ...globalOptions(),
          outDir: "",
          rateLimit: options.rateLimit,
          cookiesFromBrowser: options.cookiesFromBrowser,
          cookiesPath: options.cookies,
          quiet: false
        })
      );
    }
  );

program
  .command("clip")
  .description("Clip a timestamp section of a YouTube video or local video file")
  .argument("<source>", "YouTube URL or local video file path")
  .requiredOption("--from <timestamp>", "clip start timestamp, e.g. 03:20")
  .requiredOption("--to <timestamp>", "clip end timestamp, e.g. 05:10")
  .option("--out-dir <dir>", "clip output directory", "videos/clips")
  .option("--force-keyframes", "force keyframes at cuts for more precise but slower clips")
  .action(
    async (
      source: string,
      options: { from: string; to: string; outDir: string; forceKeyframes?: boolean }
    ) => {
      await runCli(() => clip(source, { ...globalOptions(), ...options }));
    }
  );

program
  .command("transcribe")
  .description("Transcribe audio.wav in an ingested video folder with a local whisper backend")
  .argument("<video-folder>", "folder created by ytai ingest")
  .option("--force", "transcribe again even if a transcript already exists")
  .option("--whisper-model <name>", "whisper model name to use")
  .option("--language <code>", "spoken language code for transcription, e.g. en")
  .action(
    async (
      videoFolder: string,
      options: { force?: boolean; whisperModel?: string; language?: string }
    ) => {
      await runCli(() =>
        transcribe(videoFolder, {
          ...globalOptions(),
          force: options.force,
          whisperModel: options.whisperModel,
          language: options.language
        })
      );
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
  .option("--enhanced", "also create temporal frame groups around each scout moment")
  .action(
    async (
      videoFolder: string,
      options: {
        interval: number;
        out?: string;
        columns: number;
        enhanced?: boolean;
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

program
  .command("topics")
  .description("Create a topic-extraction prompt for the learning workflow")
  .argument("<video-folder>", "folder created by ytai ingest")
  .action(async (videoFolder: string) => {
    await runCli(() => topics(videoFolder, globalOptions()));
  });

program
  .command("plan")
  .description("Create a learning-plan prompt from a validated learning/topics.json")
  .argument("<video-folder>", "folder created by ytai ingest")
  .action(async (videoFolder: string) => {
    await runCli(() => plan(videoFolder, globalOptions()));
  });

program
  .command("teach")
  .description("Create a lesson prompt for one topic from learning/topics.json")
  .argument("<video-folder>", "folder created by ytai ingest")
  .argument("[topic-id]", "topic id from learning/topics.json")
  .option("--next", "pick the next unfinished topic in teaching order")
  .action(async (videoFolder: string, topicId: string | undefined, options: { next?: boolean }) => {
    await runCli(() => teach(videoFolder, topicId, { ...globalOptions(), next: options.next }));
  });

program
  .command("quiz")
  .description("Create a quiz prompt for a topic whose lesson is done")
  .argument("<video-folder>", "folder created by ytai ingest")
  .argument("[topic-id]", "topic id from learning/topics.json")
  .option("--due", "quiz the most overdue topic, or the first unquizzed one")
  .action(async (videoFolder: string, topicId: string | undefined, options: { due?: boolean }) => {
    await runCli(() => quiz(videoFolder, topicId, { ...globalOptions(), due: options.due }));
  });

program
  .command("score")
  .description("Record a quiz score for a topic whose lesson is done")
  .argument("<video-folder>", "folder created by ytai ingest")
  .argument("<topic-id>", "topic id from learning/topics.json")
  .argument("<score>", "integer score from 0 to 100")
  .action(async (videoFolder: string, topicId: string, score: string) => {
    await runCli(() => recordScore(videoFolder, topicId, score, globalOptions()));
  });

program
  .command("learn")
  .description("Show learning progress and the next step for a video folder")
  .argument("<video-folder>", "folder created by ytai ingest")
  .option("--json", "print machine-readable status JSON only")
  .option("--check", "validate learning artifacts and exit 1 on errors")
  .option("--done <topic-id>", "mark a topic's lesson as done")
  .action(
    async (videoFolder: string, options: { json?: boolean; check?: boolean; done?: string }) => {
      await runCli(() =>
        learnStatus(videoFolder, {
          ...globalOptions(),
          json: options.json,
          check: options.check,
          done: options.done
        })
      );
    }
  );

await program.parseAsync();

function globalOptions(): { dryRun?: boolean; verbose?: boolean } {
  const opts = program.opts<{ dryRun?: boolean; verbose?: boolean }>();
  return {
    dryRun: opts.dryRun,
    verbose: opts.verbose
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
