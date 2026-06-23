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
- `src/commands/ingest.ts`: yt-dlp integration, `IngestResult`/`IngestedAssets`, `IngestStatus`, error classification (`classifyYtDlpError`), `buildYtDlpArgs`, `normalizeArtifacts`, `writeIngestStatus`, `resumeIngest`.
- `src/commands/prepare.ts`: orchestrates `ingest → scout → summarize`; handles `--resume` by reading `ingest-status.json`.
- `src/commands/scout.ts`: visual frame sampling, contact sheet generation, and opt-in enhanced temporal frame groups.
- `src/commands/context.ts`: `summarize` (writes `analysis/summary-input.md` with source provenance) and `ask` (writes `analysis/qna-context.md`).
- `src/commands/clip.ts`: timestamp-based clip extraction via yt-dlp.
- `src/commands/frames.ts`: frame extraction with `select`, `seek`, `auto` modes.
- `src/lib/timestamps.ts`: timestamp and range parsing.
- `src/lib/frameMode.ts`: `select`, `seek`, and `auto` frame-mode choice.
- `src/lib/scoutPlan.ts`: automatic visual-scout timeline planning and enhanced temporal block planning.
- `src/lib/process.ts`: safe `spawn` wrapper and dry-run command rendering.
- `src/lib/ui.ts`: shared CLI output helpers for colors, symbols, spinners, and `skip()`.
- `src/lib/agentPrompt.ts`: `preparedFolderAgentPrompt` and `degradedFolderAgentPrompt` for text-only analysis.
- `src/lib/transcriptChunks.ts`: transcript parsing and timestamp-based chunking for full-duration coverage.
- `src/lib/files.ts` and `src/lib/media.ts`: filesystem and media helpers.

Read `references/cli-behavior.md` when changing command behavior or output structure.

## Key Types

| Type | File | Purpose |
|------|------|---------|
| `IngestResult` | `ingest.ts` | Return type: `{ videoFolder, assets: IngestedAssets, warnings }` |
| `IngestedAssets` | `ingest.ts` | Asset map: metadata, description, transcript, video, audio, thumbnail |
| `IngestStatus` | `ingest.ts` | Written to `ingest-status.json`: URL, timestamp, assets, warnings |
| `IngestOptions` | `ingest.ts` | Options: `transcriptOnly`, `rateLimit`, `cookiesFromBrowser`, `cookiesPath`, `resume` |
| `YtDlpErrorCategory` | `ingest.ts` | Enum: rate_limit, video_unavailable, age_restricted, geo_blocked, no_formats, network_error, unknown |
| `YtDlpErrorInfo` | `ingest.ts` | Classified error: `{ category, message, suggestion }` |

## CLI Flags

| Flag | Commands | Purpose |
|------|----------|---------|
| `--transcript-only` | ingest, prepare | Skip video download — only fetch transcript/description/metadata |
| `--rate-limit` | ingest, prepare, resume | Inject yt-dlp sleep/retry flags to avoid 429 errors |
| `--cookies-from-browser` | ingest, prepare, resume | Pass browser cookies to yt-dlp for authentication |
| `--cookies` | ingest, prepare, resume | Pass cookies.txt path to yt-dlp |
| `--resume` | prepare | Resume partial ingest — reads `ingest-status.json`, fills gaps |
| `--enhanced-scout` | prepare | During scout, also create ordered temporal frame groups before summarize |
| `--enhanced` | scout | Create ordered temporal frame groups around each scout moment |

## Transcript Chunking

When `summary-input.md` is generated from a long transcript (>16K chars), ytai **no longer truncates to the first 16K characters**. Instead:

1. The VTT/SRT transcript is parsed into timestamped cues.
2. Cues are grouped into **5-minute chunks** (configurable via `chunkSec`).
3. Each chunk includes: time range label (e.g., `05:00 → 10:00`), and a text preview (default 3K chars per chunk).
4. The full chunk index is inserted into `summary-input.md` under `## Transcript`.

This ensures the AI agent can see content from the **entire video duration**, not just the opening minutes — critical for investment analysis where targets and risk management often appear in the latter half.

### Key functions

| Function | File | Purpose |
|----------|------|---------|
| `chunkTranscript(transcript, opts)` | `transcriptChunks.ts` | Parse VTT/SRT → `ChunkedTranscript` with timestamped chunks |
| `formatChunkIndex(chunked)` | `transcriptChunks.ts` | Format chunks as markdown for `summary-input.md` |
| `buildTranscriptSection(raw)` | `context.ts` | Decides raw excerpt vs chunked index based on length |

### Thresholds

| Setting | Default | Notes |
|---------|---------|-------|
| Raw excerpt threshold | 16K chars | Shorter transcripts are included verbatim |
| Chunk duration | 300s (5 min) | Groups cues into time windows |
| Preview per chunk | 3K chars | Text preview for each chunk |
| Total section budget | 80K chars | Auto-shrinks preview if chunked output exceeds this |

## Pipeline Design

- `ingest()` returns `IngestResult`, not just a folder path. Downstream commands inspect `assets` to decide what to run.
- Partial yt-dlp output: `allowFailure: true`, checks for `source.info.json`, video, `.vtt` after non-zero exit. Continues if any exist.
- Default video downloads are capped to the best MP4 stream at or below 1080p, falling back to the highest available stream when the source is below 1080p.
- Non-verbose yt-dlp downloads keep raw output captured but parse `[download]` percentage lines to render a `cli-progress` progress bar.
- `prepare()` conditionally runs scout (needs video) and summarize (needs any text). Uses `skip()` for skipped steps.
- `prepare --enhanced-scout` runs the same `ingest → scout → summarize` workflow, passing `enhanced: true` only to scout. Transcript-only or missing-video runs still skip all scout work.
- `scout --enhanced` keeps normal scout outputs and adds `frames/scout/temporal/`, `analysis/temporal-manifest.json`, and `analysis/temporal-context.md`.
- Enhanced temporal blocks use integer-second frame groups planned by `buildTemporalPlan()`, normally `[center-1, center, center+1, center+2]` shifted into the video range. This is local `ffmpeg` evidence, not native video-token model understanding.
- Enhanced scout is most useful for UI bug recordings, frontend/game demos, trailers, animation, motion graphics, chart animations, editing examples, and visual tutorials with sparse transcripts. It adds less value for talking-head commentary, podcasts, or static slide lectures.
- For regular-vs-enhanced evals, prepare the same URL into separate output roots, e.g. `ytai prepare "URL" --out-dir /tmp/ytai-eval-regular` and `ytai prepare "URL" --enhanced-scout --out-dir /tmp/ytai-eval-enhanced`, then compare source provenance, `visual-context.md`, `temporal-context.md`, contact sheets, and strips.
- `--resume` does a dry-run ingest to determine the folder path, reads `ingest-status.json`, then calls `resumeIngest()` to fill missing assets.
- Every ingest run writes `ingest-status.json` for resume tracking.

## Anti-429 Strategy

| Approach | Implementation |
|----------|----------------|
| Minimize requests | `--transcript-only` skips video entirely |
| Slow down | `--rate-limit` adds `--sleep-requests`, `--max-sleep-interval`, `--retries` |
| Authenticate | `--cookies-from-browser` or `--cookies` |
| Resume partial | `--resume` reads status, only fetches missing assets |
| Error guidance | `classifyYtDlpError()` returns actionable suggestions |
