import { spawn } from "node:child_process";

export type RunOptions = {
  dryRun?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
  capture?: boolean;
  allowFailure?: boolean;
};

export type RunResult = {
  stdout: string;
  stderr: string;
  code: number;
};

export function quoteCommand(command: string, args: string[]): string {
  return [command, ...args].map(quoteArg).join(" ");
}

export async function runCommand(
  command: string,
  args: string[],
  options: RunOptions = {}
): Promise<RunResult> {
  if (options.dryRun) {
    console.log(quoteCommand(command, args));
    return { stdout: "", stderr: "", code: 0 };
  }

  if (options.verbose) {
    console.error(`$ ${quoteCommand(command, args)}`);
  }

  return await new Promise((resolve, reject) => {
    const stdio = resolveRunStdio(options);
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      stdio: stdio === "pipe" ? ["ignore", "pipe", "pipe"] : "inherit"
    });

    let stdout = "";
    let stderr = "";

    if (stdio === "pipe") {
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
    }

    child.on("error", reject);
    child.on("close", (code) => {
      const result = { stdout, stderr, code: code ?? 1 };
      if (result.code !== 0 && !options.allowFailure) {
        reject(
          new Error(
            `${command} exited with code ${result.code}${stderr ? `: ${stderr.trim()}` : ""}`
          )
        );
        return;
      }
      resolve(result);
    });
  });
}

export function resolveRunStdio(options: Pick<RunOptions, "capture" | "verbose">): "pipe" | "inherit" {
  if (options.capture) {
    return "pipe";
  }
  return options.verbose ? "inherit" : "pipe";
}

function quoteArg(value: string): string {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}
