import { summarize } from "./context.js";
import { ingest } from "./ingest.js";
import { scout } from "./scout.js";
import { preparedFolderAgentPrompt } from "../lib/agentPrompt.js";
import type { RunOptions } from "../lib/process.js";
import { block, info, section, startSpinner, success, title } from "../lib/ui.js";

type PrepareOptions = RunOptions & {
  outDir: string;
  scoutInterval: number;
  scoutColumns: number;
  promptVideoFolder?: (defaultFolder: string) => Promise<string | undefined>;
};

export async function prepare(url: string, options: PrepareOptions): Promise<string> {
  if (!options.quiet) {
    title("ytai prepare");
    section("1/3 Ingest");
  }

  const videoFolder = await ingest(url, { ...options, quiet: true, showProgress: true });
  if (!options.quiet) {
    success("Video folder", videoFolder);
  }

  if (!options.quiet) {
    section("2/3 Scout");
  }
  const scoutSpinner = startSpinner("Sampling visual context...", {
    enabled: !options.dryRun && !options.verbose && !options.quiet
  });
  await scout(videoFolder, {
    dryRun: options.dryRun,
    verbose: options.verbose,
    quiet: true,
    interval: options.scoutInterval,
    columns: options.scoutColumns
  });
  scoutSpinner.succeed("Visual scout complete");
  if (!options.quiet) {
    success("Frames", `${videoFolder}/frames/scout`);
    success("Contact sheet", `${videoFolder}/frames/scout/contact_sheet.jpg`);
  }

  if (!options.quiet) {
    section("3/3 Summarize");
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
    section("Done");
    success("Video folder", videoFolder);
    info("No AI provider is wired yet. Send the generated context to an AI model when ready.");
    section("Agent Prompt");
    block(preparedFolderAgentPrompt(videoFolder));
  }
  return videoFolder;
}
