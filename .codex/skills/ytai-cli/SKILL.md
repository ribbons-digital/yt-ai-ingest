---
name: ytai-cli
description: Maintain and extend the project-local ytai YouTube AI-ingestion CLI. Use when working on ytai commands, yt-dlp/ffmpeg integration, timestamp parsing, frame extraction modes, AI context files, README examples, or the local project skill for this repository.
---

# ytai CLI

Use this skill when changing the `ytai` TypeScript CLI in this repository.

## Workflow

1. Inspect `README.md`, `src/cli.ts`, and the relevant command under `src/commands/`.
2. Add or update focused tests first for parser, mode-selection, or context behavior.
3. Keep external process calls in `src/lib/process.ts` or a command module using argument arrays.
4. Keep YouTube URLs, timestamps, and paths out of shell strings.
5. Run `pnpm test`, `pnpm typecheck`, and `pnpm build` before reporting completion.
6. Update this skill and `README.md` when CLI behavior changes.

## Architecture

- `src/cli.ts`: `commander` routing and user-facing flags.
- `src/commands/`: command implementations for `ingest`, `clip`, `frames`, `summarize`, and `ask`.
- `src/lib/timestamps.ts`: timestamp and range parsing.
- `src/lib/frameMode.ts`: `select`, `seek`, and `auto` frame-mode choice.
- `src/lib/process.ts`: safe `spawn` wrapper and dry-run command rendering.
- `src/lib/files.ts` and `src/lib/media.ts`: filesystem and media helpers.

Read `references/cli-behavior.md` when changing command behavior or output structure.
