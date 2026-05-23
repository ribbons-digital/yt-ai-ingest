@RTK.md
@CLAUDE.md

# Project Instructions

This repository contains `ytai`, a TypeScript/Node CLI for local YouTube AI ingestion.

Use `pnpm` for package management. Run `pnpm test`, `pnpm typecheck`, and `pnpm build` before claiming CLI changes are complete.

Keep command execution safe: use `child_process.spawn` with argument arrays, never shell-interpolate YouTube URLs, timestamps, or local paths.

Keep the first milestone local-only. Do not add vector databases, embeddings, diarization, or AI provider calls unless explicitly requested.
