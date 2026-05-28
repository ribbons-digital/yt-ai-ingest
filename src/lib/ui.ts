import ansis from "ansis";
import cliProgress from "cli-progress";
import figures from "figures";
import ora, { type Ora } from "ora";

type Spinner = {
  update(text: string): void;
  succeed(text?: string): void;
  fail(text?: string): void;
  stop(): void;
};

type SpinnerOptions = {
  enabled?: boolean;
};

type DownloadProgressBar = {
  start(percent: number): void;
  update(percent: number): void;
  stop(): void;
};

export function title(value: string): void {
  console.log(ansis.bold(value));
}

export function section(value: string): void {
  console.log(`\n${ansis.bold(value)}`);
}

export function info(label: string, value?: string): void {
  console.log(formatLine(figures.pointer, ansis.cyan(label), value));
}

export function block(value: string): void {
  console.log(ansis.dim(value));
}

export function success(label: string, value?: string): void {
  console.log(formatLine(figures.tick, ansis.green(label), value));
}

export function warn(label: string, value?: string): void {
  console.warn(formatLine(figures.warning, ansis.yellow(label), value));
}

export function skip(label: string, reason?: string): void {
  console.log(formatLine(figures.arrowRight, ansis.dim(label), reason));
}

export function startSpinner(text: string, options: SpinnerOptions = {}): Spinner {
  const enabled = options.enabled ?? process.stderr.isTTY;
  if (!enabled) {
    return noopSpinner();
  }

  const spinner = ora({ text, stream: process.stderr }).start();
  return {
    update: (nextText: string) => {
      spinner.text = nextText;
    },
    succeed: (nextText?: string) => spinner.succeed(nextText),
    fail: (nextText?: string) => spinner.fail(nextText),
    stop: () => spinner.stop()
  };
}

export function createDownloadProgressBar(
  label: string,
  options: SpinnerOptions = {}
): DownloadProgressBar {
  const enabled = options.enabled ?? process.stderr.isTTY;
  if (!enabled) {
    return noopDownloadProgressBar();
  }

  const progress = new cliProgress.SingleBar({
    barsize: 24,
    clearOnComplete: false,
    format: `${label} [{bar}] {percentage}%`,
    hideCursor: true,
    stream: process.stderr
  }, cliProgress.Presets.shades_classic);

  return {
    start: (percent: number) => progress.start(100, clampPercent(percent)),
    update: (percent: number) => progress.update(clampPercent(percent)),
    stop: () => progress.stop()
  };
}

function noopSpinner(): Spinner {
  return {
    update: () => undefined,
    succeed: () => undefined,
    fail: () => undefined,
    stop: () => undefined
  };
}

function noopDownloadProgressBar(): DownloadProgressBar {
  return {
    start: () => undefined,
    update: () => undefined,
    stop: () => undefined
  };
}

function clampPercent(percent: number): number {
  return Math.max(0, Math.min(100, percent));
}

function formatLine(symbol: string, label: string, value?: string): string {
  return value ? `${symbol} ${label}: ${ansis.dim(value)}` : `${symbol} ${label}`;
}
