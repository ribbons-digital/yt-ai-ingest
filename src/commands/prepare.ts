import { summarize } from "./context.js";
import {
  ingest,
  readIngestStatus,
  resumeIngest,
  type IngestResult
} from "./ingest.js";
import { scout } from "./scout.js";
import {
  degradedFolderAgentPrompt,
  preparedFolderAgentPrompt
} from "../lib/agentPrompt.js";
import type { RunOptions } from "../lib/process.js";
import {
  block,
  info,
  section,
  skip,
  startSpinner,
  success,
  title,
  warn
} from "../lib/ui.js";

type PrepareOptions = RunOptions & {
  outDir: string;
  scoutInterval: number;
  scoutColumns: number;
  promptVideoFolder?: (defaultFolder: string) => Promise<string | undefined>;
  transcriptOnly?: boolean;
  rateLimit?: boolean;
  cookiesFromBrowser?: string;
  cookiesPath?: string;
  resume?: boolean;
  enhancedScout?: boolean;
  link?: boolean;
  transcribe?: boolean;
  whisperModel?: string;
  language?: string;
};

export async function prepare(url: string, options: PrepareOptions): Promise<string> {
  printPrepareStart(options);

  const result = await runIngestPhase(url, options);
  const { videoFolder, assets } = result;
  printIngestResult(result, options);

  const canScout = assets.video;
  const canSummarize = assets.metadata || assets.description || assets.transcript;
  if (!canScout && !canSummarize) {
    throw new Error("No usable assets were produced. Cannot scout or summarize.");
  }

  await runScoutPhase(videoFolder, canScout, options);
  await runSummarizePhase(videoFolder, canSummarize, options);
  printPrepareDone(videoFolder, canScout, canSummarize, assets, options);

  return videoFolder;
}

function printPrepareStart(options: PrepareOptions): void {
  if (!options.quiet) {
    title("ytai prepare");
    section("1/3 Ingest");
  }
}

async function runIngestPhase(url: string, options: PrepareOptions): Promise<IngestResult> {
  if (options.resume) {
    return await runResumePhase(url, options);
  }
  return await ingest(url, {
    ...options,
    quiet: true,
    showProgress: true
  });
}

function printIngestResult(result: IngestResult, options: PrepareOptions): void {
  if (options.quiet) {
    return;
  }
  success("Video folder", result.videoFolder);
  for (const warning of result.warnings) {
    warn("Ingest warning", warning);
  }
}

async function runScoutPhase(
  videoFolder: string,
  canScout: boolean,
  options: PrepareOptions
): Promise<void> {
  if (!options.quiet) {
    section("2/3 Scout");
  }
  if (!canScout) {
    if (!options.quiet) {
      skip("Scout", "No video available — skipping visual context extraction");
    }
    return;
  }

  const scoutSpinner = startSpinner("Sampling visual context...", {
    enabled: !options.dryRun && !options.verbose && !options.quiet
  });
  await scout(videoFolder, {
    dryRun: options.dryRun,
    verbose: options.verbose,
    quiet: true,
    interval: options.scoutInterval,
    columns: options.scoutColumns,
    enhanced: options.enhancedScout
  });
  scoutSpinner.succeed("Visual scout complete");

  if (!options.quiet) {
    success("Frames", `${videoFolder}/frames/scout`);
    success("Contact sheet", `${videoFolder}/frames/scout/contact_sheet.jpg`);
    if (options.enhancedScout) {
      success("Temporal context", `${videoFolder}/analysis/temporal-context.md`);
      success("Temporal blocks", `${videoFolder}/frames/scout/temporal`);
    }
  }
}

async function runSummarizePhase(
  videoFolder: string,
  canSummarize: boolean,
  options: PrepareOptions
): Promise<void> {
  if (!options.quiet) {
    section("3/3 Summarize");
  }
  if (!canSummarize) {
    if (!options.quiet) {
      skip("Summarize", "No transcript, description, or metadata — skipping context generation");
    }
    return;
  }

  const summarizeSpinner = startSpinner("Writing AI context...", {
    enabled: !options.dryRun && !options.verbose && !options.quiet
  });
  await summarize(videoFolder, {
    verbose: options.verbose,
    quiet: true
  });
  summarizeSpinner.succeed("Summary context complete");

  if (!options.quiet) {
    success("Summary prompt", `${videoFolder}/analysis/summary-input.md`);
  }
}

function printPrepareDone(
  videoFolder: string,
  canScout: boolean,
  canSummarize: boolean,
  assets: IngestResult["assets"],
  options: PrepareOptions
): void {
  if (options.quiet) {
    return;
  }

  section("Done");
  success("Video folder", videoFolder);
  info("No AI provider is wired yet. Send the generated context to an AI model when ready.");
  section("Agent Prompt");

  block(
    canScout && canSummarize
      ? preparedFolderAgentPrompt(videoFolder)
      : degradedFolderAgentPrompt(videoFolder, assets)
  );
}

async function runResumePhase(url: string, options: PrepareOptions): Promise<IngestResult> {
  // First ingest with dry-run to determine the folder path without actual downloads
  const dryResult = await ingest(url, {
    ...options,
    dryRun: true,
    quiet: true
  });

  const status = await readIngestStatus(dryResult.videoFolder);
  if (!status) {
    if (!options.quiet) {
      info("No previous ingest found", "running full ingest instead");
    }
    return await ingest(url, {
      ...options,
      quiet: true,
      showProgress: true
    });
  }

  if (!options.quiet) {
    success("Resuming ingest", dryResult.videoFolder);
  }

  return await resumeIngest(dryResult.videoFolder, {
    ...options,
    quiet: true
  });
}
