---
name: ytai-cli
description: Maintain and extend the project-local ytai AI-ingestion CLI for YouTube URLs and local video files. Use when working on ytai commands, yt-dlp/ffmpeg integration, local file ingestion, whisper transcription, the learning workflow, timestamp parsing, frame extraction modes, AI context files, README examples, or the local project skill for this repository.
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
- `src/commands/ingest.ts`: yt-dlp integration, `IngestResult`/`IngestedAssets`, `IngestStatus`, `IngestSource`, `classifySourceInput` (http(s) means URL, everything else is a local file), error classification (`classifyYtDlpError`), `buildYtDlpArgs`, `normalizeArtifacts`, `writeIngestStatus`/`readIngestStatus`, `resumeIngest`, `runPostIngestTranscription`. `ingest()` dispatches local sources to `ingestLocal()`.
- `src/commands/ingestLocal.ts`: local file ingest and resume: ffprobe metadata, hash-based video id, copy or `--link` hardlink import, container remux, sidecar subtitle pickup (`matchSidecarSubtitle`), `resumeLocalIngest`, `detectFinalAssets`. The local path detects assets with `detectFinalAssets` and must NOT call `normalizeArtifacts`, which renames raw yt-dlp output; local folders already use final asset names.
- `src/commands/prepare.ts`: orchestrates `ingest → scout → summarize`; handles `--resume` by reading `ingest-status.json`.
- `src/commands/scout.ts`: visual frame sampling, contact sheet generation, and opt-in enhanced temporal frame groups.
- `src/commands/context.ts`: `summarize` (writes `analysis/summary-input.md` with source provenance), `ask` (writes `analysis/question-input.md`), and the exported `buildContextDocument` reused by `ytai topics` as the evidence document.
- `src/commands/clip.ts`: timestamp-based clip extraction: yt-dlp `--download-sections` for URLs, ffmpeg for local files.
- `src/commands/frames.ts`: frame extraction with `select`, `seek`, `auto` modes.
- `src/commands/transcribe.ts`: `ytai transcribe` command: skips when a transcript exists unless `--force`, requires `audio.wav` outside dry-run, updates `ingest-status.json` after success.
- `src/commands/learn.ts`: I/O layer for `topics`/`plan`/`teach`/`learn`/`score`: writes `learning/*-input.md` prompts, writes `learning/teaching-guide.md` once when topics are generated, reads and validates `learning/topics.json`, tracks `learning/progress.json`, builds topic transcript excerpts (ranges padded 15s each side). `plan` now asks the LLM to write `plan.md`, `resources.md`, and `concepts.json`; `recordScore` appends quiz scores and schedules reviews; exports `recordScore`, `requireValidTopics`, `readProgress`, and `buildTranscriptExcerpt` (reused by `quiz.ts`).
- `src/commands/quiz.ts`: `ytai quiz`: picks a topic (explicit id requires a done lesson; bare or `--due` picks the most overdue due topic, else the first done-but-never-quizzed one in teaching order) and writes `learning/quizzes/<nn>-<id>-quiz-input.md`, embedding the lesson file verbatim when present. Quiz prompts should test transferable understanding rather than transcript scavenger-hunt recall.
- `src/lib/timestamps.ts`: timestamp and range parsing.
- `src/lib/frameMode.ts`: `select`, `seek`, and `auto` frame-mode choice.
- `src/lib/scoutPlan.ts`: automatic visual-scout timeline planning and enhanced temporal block planning.
- `src/lib/process.ts`: safe `spawn` wrapper and dry-run command rendering.
- `src/lib/ui.ts`: shared CLI output helpers for colors, symbols, spinners, and `skip()`.
- `src/lib/agentPrompt.ts`: `preparedFolderAgentPrompt` and `degradedFolderAgentPrompt` for text-only analysis.
- `src/lib/transcriptChunks.ts`: transcript parsing and timestamp-based chunking for full-duration coverage; exports `parseTranscriptCues` used by `teach` excerpts.
- `src/lib/transcribe.ts`: local whisper transcription: `detectWhisperBackend` (tries `mlx_whisper`, then `whisper`), arg builders, `transcribeAudio` (writes `transcript.srt`, converts to `transcript.vtt`).
- `src/lib/learning.ts`: pure learning logic: `TopicsFile`/`Topic` types, `validateTopicsFile`, `orderTopicsForTeaching`, `computeLearnStage`, `computeNextReview`, `reviewState`, the review-aware `nextAction(stage, artifacts, review?)`, `renderLearnStatus(stage, artifacts, next, review)`, `toStatusJson(stage, artifacts, next, review)`, and the `topics-input.md`/`teaching-guide.md`/`plan-input.md`/lesson-input/quiz-input (`renderQuizInputMd`) renderers. Lesson prompts must teach prerequisites and acronyms before summarizing video evidence.
- `src/lib/files.ts` and `src/lib/media.ts`: filesystem and media helpers.

Read `references/cli-behavior.md` when changing command behavior or output structure.

## Key Types

| Type | File | Purpose |
|------|------|---------|
| `IngestResult` | `ingest.ts` | Return type: `{ videoFolder, assets: IngestedAssets, warnings }` |
| `IngestedAssets` | `ingest.ts` | Asset map: metadata, description, transcript, video, audio, thumbnail |
| `IngestStatus` | `ingest.ts` | Written to `ingest-status.json`: URL, timestamp, assets, warnings |
| `IngestOptions` | `ingest.ts` | Options: `transcriptOnly`, `rateLimit`, `cookiesFromBrowser`, `cookiesPath`, `resume`, `link`, `transcribe`, `whisperModel`, `language` |
| `YtDlpErrorCategory` | `ingest.ts` | Enum: rate_limit, forbidden, video_unavailable, age_restricted, geo_blocked, no_formats, network_error, unknown |
| `YtDlpErrorInfo` | `ingest.ts` | Classified error: `{ category, message, suggestion }` |
| `IngestSource` | `ingest.ts` | Provenance in `ingest-status.json`: `{ type: "youtube", url }` or `{ type: "local", originalPath }`; legacy files without it default to youtube |
| `TopicsFile` / `Topic` | `learning.ts` | `learning/topics.json` schema v1: kebab-case `id`, `title`, `importance` (core/supporting/tangent), `timestamps`, `summary`, optional `claims`/`prerequisites`/`visualEvidence` |
| `LearnStage` | `learning.ts` | Stage machine: no-context, needs-topics-input, awaiting-topics, topics-invalid, needs-plan-input, awaiting-plan, teaching, complete |
| `LearnArtifacts` | `learning.ts` | Presence map of learning files plus parsed topics, validation issues, and progress; input to `computeLearnStage`/`nextAction` |
| `LearningProgress` / `LessonProgressEntry` | `learning.ts` | `learning/progress.json` (`version` stays 1): per-topic lesson status (`pending`/`done`), lesson file path, `completedAt`, plus additive optional `scores: QuizScore[]` and `nextReviewAt`; files written before quizzes existed stay valid |
| `QuizScore` | `learning.ts` | One recorded quiz result: `{ date, score }` with `score` an integer 0-100 |
| `ReviewDueEntry` / `ReviewState` | `learning.ts` | Review queue from `reviewState()`: `due` entries `{ id, nextReviewAt, lastScore }` sorted most overdue first, plus `unquizzed` done-topic ids in teaching order |
| `ConceptsFile` / `Concept` | `learning.ts` | `learning/concepts.json` schema v1: kebab-case `id`, required `term`, `type`, `plainDefinition`, `whyItMatters`, and `neededForTopics`; optional extra fields such as `confusions` may be present in the JSON |

## CLI Flags

| Flag | Commands | Purpose |
|------|----------|---------|
| `--out-dir` | ingest, prepare, clip | Set the base output directory for ingests/prepares or the clip output directory |
| `--transcript-only` | ingest, prepare | Skip video download — only fetch transcript/description/metadata |
| `--rate-limit` | ingest, prepare, resume | Inject yt-dlp sleep/retry flags to avoid 429 errors |
| `--cookies-from-browser` | ingest, prepare, resume | Pass browser cookies to yt-dlp for authentication |
| `--cookies` | ingest, prepare, resume | Pass cookies.txt path to yt-dlp |
| `--resume` | prepare | Resume partial ingest — reads `ingest-status.json`, fills gaps |
| `--scout-interval` | prepare | Seconds between sampled scout frames |
| `--scout-columns` | prepare | Contact sheet columns for the prepare scout phase |
| `--enhanced-scout` | prepare | During scout, also create ordered temporal frame groups before summarize |
| `--interval` | scout | Seconds between sampled scout frames |
| `--columns` | scout | Contact sheet columns |
| `--out` | scout, frames | Output directory for scout frames or extracted frames; frames prompts in interactive terminals when omitted |
| `--enhanced` | scout | Create ordered temporal frame groups around each scout moment |
| `--link` | ingest, prepare | Hardlink a local source video instead of copying; falls back to copy when hardlinks fail |
| `--transcribe` | ingest, prepare | After ingest, transcribe `audio.wav` locally with whisper when no transcript exists |
| `--whisper-model` | ingest, prepare, transcribe | Whisper model name for local transcription |
| `--language` | ingest, prepare, transcribe | Spoken language code for local transcription |
| `--force` | transcribe | Transcribe again even if a transcript already exists |
| `--from` / `--to` | clip | Required clip start and end timestamps |
| `--force-keyframes` | clip | Re-encode cuts for more precise local clips or pass yt-dlp keyframe cutting for URLs |
| `--around` | frames | Extract frames around one timestamp |
| `--window` | frames | Seconds before and after `--around` |
| `--range` | frames | Timestamp range; can be repeated |
| `--fps` | frames | Frames per second for extraction |
| `--mode` | frames | Frame extraction mode: `select`, `seek`, or `auto` |
| `--next` | teach | Pick the next unfinished topic in teaching order |
| `--due` | quiz | Quiz the most overdue due topic, else the first done-but-never-quizzed one; bare `ytai quiz` behaves the same |
| `--json` | learn | Print machine-readable status JSON only |
| `--check` | learn | Validate learning artifacts and exit 1 on errors |
| `--done <topic-id>` | learn | Mark a topic's lesson done in `learning/progress.json` |
| `--dry-run` | global | Preview external commands and write actions; ingest/prepare skip folder prompts, learning commands validate without writing prompt files or progress updates, and transcribe previews `mlx_whisper` plus `ffmpeg` without requiring `audio.wav` |

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
- Partial yt-dlp output: `allowFailure: true`, checks for `source.info.json`, video, `.vtt` after non-zero exit. Continues if any exist and records a warning with the classified cause plus retry guidance.
- Default video downloads are capped to the best MP4 stream at or below 1080p, falling back to the highest available stream when the source is below 1080p.
- Non-verbose yt-dlp downloads keep raw output captured but parse `[download]` percentage lines to render a `cli-progress` progress bar.
- `prepare()` conditionally runs scout (needs video) and summarize (needs any text). Uses `skip()` for skipped steps.
- `prepare --enhanced-scout` runs the same `ingest → scout → summarize` workflow, passing `enhanced: true` only to scout. Transcript-only or missing-video runs still skip all scout work.
- `scout --enhanced` keeps normal scout outputs and adds `frames/scout/temporal/`, `analysis/temporal-manifest.json`, and `analysis/temporal-context.md`.
- Enhanced temporal blocks use integer-second frame groups planned by `buildTemporalPlan()`, normally `[center-1, center, center+1, center+2]` shifted into the video range. This is local `ffmpeg` evidence, not native video-token model understanding.
- Enhanced scout is most useful for UI bug recordings, frontend/game demos, trailers, animation, motion graphics, chart animations, editing examples, and visual tutorials with sparse transcripts. It adds less value for talking-head commentary, podcasts, or static slide lectures.
- For regular-vs-enhanced evals, prepare the same URL into separate output roots, e.g. `ytai prepare "URL" --out-dir /tmp/ytai-eval-regular` and `ytai prepare "URL" --enhanced-scout --out-dir /tmp/ytai-eval-enhanced`, then compare source provenance, `visual-context.md`, `temporal-context.md`, contact sheets, and strips.
- `--resume` resolves YouTube folders from metadata/status and local folders by `source.originalPath`, reads `ingest-status.json`, then calls `resumeIngest()` to fill missing assets.
- Every non-dry-run ingest run writes `ingest-status.json` for resume tracking.
- Dry-run ingest and prepare skip the interactive folder prompt and use the generated default path; dry-run local ingest does not create the video folder, `frames/`, `clips/`, or `analysis/` directories.
- `ingest()` dispatches on `classifySourceInput()`: `http(s)://` sources use yt-dlp; everything else goes to `ingestLocal()`, which needs only ffmpeg/ffprobe and warn-ignores the YouTube-only flags (`--transcript-only`, `--rate-limit`, `--cookies-from-browser`, `--cookies`).
- Local resume: `resumeIngest()` reads `status.source.type` and routes local folders to `resumeLocalIngest()`, which runs without yt-dlp, re-imports the source video from `source.originalPath` when it is missing, refills audio/thumbnail/transcript conversions, and re-detects assets with `detectFinalAssets()`.
- `--transcribe` runs `runPostIngestTranscription()` after asset detection, only when no transcript exists and `audio.wav` does; a transcription failure degrades to a status warning with a `ytai transcribe <folder>` retry hint instead of failing the ingest.
- Whisper backends are detected in order: `mlx_whisper`, then `whisper`; the missing-backend error suggests `pip install mlx-whisper` (Apple Silicon) or `pipx install openai-whisper`. The backend writes `audio.srt`, which is moved to `transcript.srt` and converted to `transcript.vtt`. If VTT conversion fails or exits non-zero, keep `transcript.srt` and warn instead of failing transcription. A transcribe dry-run previews `mlx_whisper` and `ffmpeg` commands without checking `audio.wav` or installed backends.
- Learning round-trip contract: ytai never calls AI. `topics` writes `topics-input.md` and creates `teaching-guide.md` only when missing; `plan` writes `plan-input.md`; `teach` writes lesson prompts; any LLM writes `topics.json`, `plan.md`, `resources.md`, `concepts.json`, and `lessons/<nn>-<id>.md`; `learn` validates artifacts and reports the next action (`kind: "cli" | "llm"`). With `--dry-run`, `topics`, `plan`, `teach`, `quiz`, `score`, and `learn --done` validate and print the file or progress update they would make without writing prompt files or changing `progress.json`.
- Stage machine (`computeLearnStage`): no-context -> needs-topics-input -> awaiting-topics -> (topics-invalid) -> needs-plan-input -> awaiting-plan -> teaching -> complete. New folders stay in `awaiting-plan` until `plan.md`, `resources.md`, and `concepts.json` exist; legacy folders with existing lessons/progress do not move backwards just because `concepts.json` predates the feature. `complete` requires done lessons for every core and supporting topic; tangents are optional.
- Teaching order (`orderTopicsForTeaching`): Kahn topological sort by prerequisites, ties broken by importance rank (core, supporting, tangent) then stable input order; prerequisite cycles warn and are broken by input order, never thrown.
- Regenerating a lesson prompt for a done topic resets its status to `pending` while preserving existing quiz `scores` and `nextReviewAt` fields.
- Teaching quality contract: lesson prompts must require `Learning goal`, `Prerequisites and acronyms`, `Mental model`, `What the video says`, `Teach the concept`, `Worked example`, `Common confusions`, `Suggested learning`, and `Practice`. They must steer LLMs away from summary-only lessons and toward concept teaching that survives different sessions and models.
- Lesson quality validation (`validateLessonMarkdown`): `learn` surfaces warnings when lesson outputs miss durable teaching headings, lack exactly three `<details>` answer blocks, or omit timestamp citations in `What the video says`. Warnings appear in human output and JSON `issues` without blocking legacy progress.
- Retention (`ytai quiz` / `ytai score`): `quiz` writes `learning/quizzes/<nn>-<id>-quiz-input.md` (`<nn>` = teaching-order index + 1, matching the lesson number) and expects no LLM output file; the conversation is the exam and only the score is recorded. Quiz prompts should test transferable understanding, not exact transcript recall. Dry-run quiz reports the prompt path without writing it.
- Quiz selection precedence: an explicit topic id requires a done lesson; bare `ytai quiz` equals `--due` and picks `review.due[0]` (most overdue) before the first unquizzed done topic, erroring when both queues are empty.
- Score validation (`recordScore`): known topic id, entry status `done`, integer 0-100; it appends `{ date, score }` to `entry.scores`, sets `nextReviewAt = computeNextReview(scores, now)`, and prints the next review time plus the next action. Dry-run score computes and reports the same next review time without writing progress.
- Scheduling (`computeNextReview`): latest score below 80 -> now + 1 day; otherwise `2^(n-1)` days for a trailing streak of n scores >= 80, capped at 60 days.
- Review surfacing: `learn` prints `Reviews: N due, M never quizzed` and a `Quiz next: ytai quiz <folder> --due` suggestion when either count is non-zero; `--json` carries a `review` block; on stage `complete` with due or unquizzed topics, `nextAction` becomes `ytai quiz <folder> --due`, otherwise the resting complete action.

## Anti-429 Strategy

| Approach | Implementation |
|----------|----------------|
| Minimize requests | `--transcript-only` skips video entirely |
| Slow down | `--rate-limit` adds `--sleep-requests`, `--max-sleep-interval`, `--retries` |
| Authenticate | `--cookies-from-browser` or `--cookies` |
| Resume partial | `--resume` reads status, only fetches missing assets |
| Error guidance | `classifyYtDlpError()` returns actionable suggestions |
