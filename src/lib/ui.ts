import ansis from "ansis";
import figures from "figures";
import ora, { type Ora } from "ora";

type Spinner = {
  succeed(text?: string): void;
  fail(text?: string): void;
  stop(): void;
};

type SpinnerOptions = {
  enabled?: boolean;
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
    succeed: (nextText?: string) => spinner.succeed(nextText),
    fail: (nextText?: string) => spinner.fail(nextText),
    stop: () => spinner.stop()
  };
}

function noopSpinner(): Spinner {
  return {
    succeed: () => undefined,
    fail: () => undefined,
    stop: () => undefined
  };
}

function formatLine(symbol: string, label: string, value?: string): string {
  return value ? `${symbol} ${label}: ${ansis.dim(value)}` : `${symbol} ${label}`;
}
