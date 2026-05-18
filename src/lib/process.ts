import { spawn } from "node:child_process";

export type RunOptions = {
  dryRun?: boolean;
  verbose?: boolean;
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
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit"
    });

    let stdout = "";
    let stderr = "";

    if (options.capture) {
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

function quoteArg(value: string): string {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}
