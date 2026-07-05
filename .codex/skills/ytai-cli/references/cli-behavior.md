# ytai CLI Behavior

`ytai ingest` accepts a YouTube URL or a local video file path; any source that does not start with `http://` or `https://` is treated as a local file.
It creates `videos/YYYY-MM-DD_safe-title_videoid/` and attempts to produce:

- `source.mp4`
- `audio.wav`
- `transcript.vtt`
- `transcript.srt`
- `metadata.info.json`
- `description.txt`
- `thumbnail.jpg`
- `frames/`, `clips/`, and `analysis/`

For local files, ingest uses only ffmpeg and ffprobe: metadata comes from ffprobe, the video id is a 10-character hash of the absolute path and file size, the source video is copied (or hardlinked with `--link`, falling back to copy), and containers other than mp4/mov/mkv/webm are remuxed to `source.mp4` with stream copy.
Sidecar subtitles named `stem.srt`, `stem.vtt`, or `stem.<lang>.srt|vtt` next to the source file are imported as `transcript.srt`/`transcript.vtt` and converted so both formats exist; `.srt` and exact-stem matches win.
Local ingests have no `description.txt`, and the YouTube-only flags `--transcript-only`, `--rate-limit`, `--cookies-from-browser`, and `--cookies` are warn-ignored.
`ingest-status.json` records a `source` field (`{ type: "youtube", url }` or `{ type: "local", originalPath }`; legacy files default to youtube); `ytai resume` routes local folders to a yt-dlp-free path that re-imports the video from `originalPath` when `source.*` is missing and refills audio, thumbnail, and transcript conversions.

Interactive `ytai ingest` runs prompt for the final video folder before writing
assets. Pressing Enter accepts the generated default folder. Prompt answers that
start with `~/` are expanded to the user's home directory before any later
workflow steps run.

`ytai prepare` runs the default local AI-ingestion workflow in one command:
`ingest -> scout -> summarize`. It exposes `--out-dir`, `--scout-interval`, and
`--scout-columns`, and internally uses the same command functions as the
individual steps. Because it delegates to `ingest`, interactive `prepare` runs
also prompt for the final video folder before any assets are written.

Default command output is concise: external `yt-dlp` and `ffmpeg` output is
captured unless `--verbose` is set. `ytai prepare` owns grouped output for its
three steps and suppresses nested command success messages.

When `yt-dlp` exits non-zero but leaves partial assets, `ytai` continues if
metadata, subtitles, or video are usable. The warning stored in
`ingest-status.json` should include the classified cause and a concrete retry
step, such as retrying without browser cookies after an HTTP 403 on a public
video.

After successful `prepare`, print an agent prompt that tells the user to analyze
the full video folder using `analysis/summary-input.md`, visual scout artifacts,
individual scout frames, and timestamped transcripts. After standalone `ingest`,
print a shorter next-step prompt that tells the user to run `scout` and
`summarize` before asking an agent for a high-quality summary.

`ytai clip` uses `yt-dlp --download-sections` with normalized timestamps for URLs; `--force-keyframes` maps to `--force-keyframes-at-cuts`.
For local files it uses ffmpeg with stream copy (`-c copy`) by default, and `--force-keyframes` re-encodes with libx264/aac for frame-accurate cuts.

`ytai transcribe` transcribes `audio.wav` in an ingested folder with the first available local whisper backend (`mlx_whisper`, then `whisper`), writing `transcript.srt` and converting it to `transcript.vtt`.
It skips when a transcript already exists unless `--force`, honors `--whisper-model` and `--language`, and updates `ingest-status.json` on success.
The same transcription runs during ingest and prepare via `--transcribe`, where a failure degrades to a status warning with a `ytai transcribe` retry hint.

`ytai frames` accepts either `--around TIMESTAMP` or repeated `--range START-END` values. It writes a `frames_manifest.json` after successful extraction.

Frame modes:

- `select`: one `ffmpeg` command and continuous `frame_%05d.jpg` output.
- `seek`: separate `ffmpeg` commands and `range_001/frame_%04d.jpg` output.
- `auto`: `seek` for one range, `select` for nearby ranges, and `seek` for far-apart ranges in videos at least one hour long.

`ytai scout` samples an ingested source video at a fixed interval, writes frames to `frames/scout/`, builds `frames/scout/contact_sheet.jpg`, and writes `analysis/scout-manifest.json` plus `analysis/visual-context.md`.

`ytai summarize` and `ytai ask` are local-only placeholders. They write Markdown context files under `analysis/` and do not call OpenAI, Gemini, or other AI providers. If visual scout files exist, they are included in the generated context.

The learning commands implement a round-trip file contract and never call an AI provider.
`ytai topics` writes a self-contained `learning/topics-input.md` prompt built from the same evidence document as `summarize`; it also creates `learning/teaching-guide.md` only when that file is missing, so reruns do not erase customized teaching preferences. An LLM answers by writing `learning/topics.json` (schema version 1).
`ytai plan` validates `topics.json` and writes `learning/plan-input.md`; an LLM answers with `learning/plan.md`, `learning/resources.md`, and `learning/concepts.json`.
`learning/concepts.json` is a persistent concept scaffold for acronyms, libraries, methods, metrics, tools, and prerequisite ideas that lessons must teach before relying on them.
`ytai teach <folder> <topic-id>` (or `--next` for the next unfinished topic in teaching order) writes `learning/lessons/<nn>-<id>-input.md` with topic-scoped transcript excerpts padded 15 seconds on each side; an LLM answers with `learning/lessons/<nn>-<id>.md`.
Lesson prompts require standalone teaching sections: `Learning goal`, `Prerequisites and acronyms`, `Mental model`, `What the video says`, `Teach the concept`, `Worked example`, `Common confusions`, `Suggested learning`, and `Practice`.
`ytai learn` includes lesson quality warnings when lesson files miss the durable teaching headings, lack exactly three `<details>` answer blocks in practice, or omit timestamp citations in video-claim sections. These warnings surface in human output and the JSON `issues` array without changing stage/progress by themselves.
`ytai quiz <folder>` (bare behaves like `--due`) picks the most overdue due-for-review topic, falls back to the first done-but-never-quizzed topic in teaching order, and errors when nothing is due and every done topic has been quizzed; `ytai quiz <folder> <topic-id>` quizzes that topic directly and requires its lesson to be marked done.
It writes `learning/quizzes/<nn>-<id>-quiz-input.md`, where `<nn>` is the teaching-order index plus one (matching the lesson number), embedding the lesson file verbatim when `learning/lessons/<nn>-<id>.md` exists and otherwise quizzing from the topic summary and transcript excerpt.
The prompt is a concept-based oral exam: 3 to 5 questions asked one at a time, no answer revealed before the learner attempts it, grading against the lesson and timestamped evidence when relevant, and a 0 to 100 score; no LLM output file is expected because the conversation is the exam and only the score is recorded.
`ytai score <folder> <topic-id> <score>` requires a known topic with a done lesson and an integer score from 0 to 100; it appends `{ date, score }` to the topic's `scores`, sets `nextReviewAt` (a score below 80 comes back in 1 day; a trailing streak of n scores at or above 80 schedules 2^(n-1) days out, capped at 60), and prints the next review time and next action.
`learning/progress.json` stays schema version 1; files written before quizzes existed remain valid.
`ytai learn` reports the stage and next action, with `--json` for the machine shape `{ stage, artifacts, lessons, issues, review, nextAction }`, `--check` to exit 1 on validation errors, and `--done <topic-id>` to record progress in `learning/progress.json`.
Human `learn` output includes a `Reviews: N due, M never quizzed` line and suggests `Quiz next: ytai quiz <folder> --due` when either count is non-zero.
On stage `complete`, the next action stays `ytai quiz <folder> --due` while any review is due or any done topic is unquizzed, so ytai steers into first quizzes after the last lesson and rests only once both queues are empty.
Stages: no-context -> needs-topics-input -> awaiting-topics -> (topics-invalid) -> needs-plan-input -> awaiting-plan -> teaching -> complete; complete requires every core and supporting lesson done, tangent topics are optional. New folders stay in awaiting-plan until `plan.md`, `resources.md`, and `concepts.json` exist; legacy folders with existing lesson/progress state do not move backwards solely because `concepts.json` predates the feature.
