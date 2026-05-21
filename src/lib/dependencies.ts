import { runCommand } from "./process.js";

const INSTALL_HINT = "Install prerequisites on macOS with: brew install yt-dlp ffmpeg";

export async function ensureDependencies(commands: string[], verbose = false): Promise<void> {
  const missing: string[] = [];

  for (const command of commands) {
    const exists = await commandExists(command);
    if (!exists) {
      missing.push(command);
    } else if (verbose) {
      console.error(`Found ${command}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required command(s): ${missing.join(", ")}.\n${INSTALL_HINT}`);
  }
}

async function commandExists(command: string): Promise<boolean> {
  const result = await runCommand(command, getDependencyVersionArgs(command), {
    capture: true,
    allowFailure: true
  }).catch(() => ({ code: 1, stdout: "", stderr: "" }));

  return result.code === 0;
}

export function getDependencyVersionArgs(command: string): string[] {
  if (command === "ffmpeg" || command === "ffprobe") {
    return ["-version"];
  }

  return ["--version"];
}
