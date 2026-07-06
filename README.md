# ytai

`ytai` is a local AI-ingestion CLI for YouTube URLs and local video files.
It uses `yt-dlp` and `ffmpeg` to turn a video into a predictable folder of video, audio, transcript, metadata, frame, and AI prompt assets.
It also drives a systematic learning workflow that works with any LLM agent.

## Install

```bash
pnpm install
pnpm build
pnpm link --global
```

Prerequisites:

- Node.js 20 or newer.
- `yt-dlp` and `ffmpeg` available on `PATH`.

```bash
brew install yt-dlp ffmpeg
```

## Commands

```bash
ytai prepare "YOUTUBE_URL"
ytai prepare "YOUTUBE_URL" --transcript-only
ytai prepare "YOUTUBE_URL" --rate-limit
ytai prepare "YOUTUBE_URL" --cookies-from-browser chrome
ytai prepare "YOUTUBE_URL" --cookies ./cookies.txt
ytai prepare "YOUTUBE_URL" --resume
ytai prepare "YOUTUBE_URL" --enhanced-scout
ytai prepare "YOUTUBE_URL" --scout-interval 30 --scout-columns 5
ytai prepare ~/Movies/talk.mp4
ytai prepare ~/Movies/talk.mp4 --link
ytai prepare ~/Movies/talk.mp4 --transcribe --whisper-model small --language en
ytai ingest "YOUTUBE_URL"
ytai ingest "YOUTUBE_URL" --transcript-only
ytai ingest "YOUTUBE_URL" --rate-limit
ytai ingest "YOUTUBE_URL" --cookies-from-browser chrome
ytai ingest "YOUTUBE_URL" --cookies ./cookies.txt
ytai ingest ~/Movies/talk.mp4
ytai resume ./videos/video-folder
ytai resume ./videos/video-folder --rate-limit --cookies-from-browser chrome
ytai transcribe ./videos/video-folder
ytai transcribe ./videos/video-folder --force --whisper-model small --language en
ytai clip "YOUTUBE_URL" --from 03:20 --to 05:10
ytai clip "YOUTUBE_URL" --from 03:20 --to 05:10 --force-keyframes
ytai clip ~/Movies/talk.mp4 --from 03:20 --to 05:10
ytai frames ./videos/video-folder --around 12:30
ytai frames ./videos/video-folder --around 12:30 --window 20 --fps 2
ytai scout ./videos/video-folder
ytai scout ./videos/video-folder --interval 30 --columns 5
ytai scout ./videos/video-folder --enhanced
ytai summarize ./videos/video-folder
ytai ask ./videos/video-folder "What are the key implementation steps?"
ytai topics ./videos/video-folder
ytai plan ./videos/video-folder
ytai teach ./videos/video-folder --next
ytai teach ./videos/video-folder some-topic-id
ytai quiz ./videos/video-folder
ytai quiz ./videos/video-folder --due
ytai quiz ./videos/video-folder some-topic-id
ytai score ./videos/video-folder some-topic-id 85
ytai learn ./videos/video-folder
ytai learn ./videos/video-folder --json
ytai learn ./videos/video-folder --check
ytai learn ./videos/video-folder --done some-topic-id
```

Global flags:

```bash
ytai --dry-run frames ./videos/video-folder --around 12:30
ytai --dry-run topics ./videos/video-folder
ytai --verbose ingest "YOUTUBE_URL"
```

Use `--dry-run` to preview supported external commands and non-mutating write plans.
For `ingest` and `prepare`, dry runs skip the interactive folder prompt and use the generated default folder.
For local ingest and learning commands, dry runs validate inputs and report the directory, prompt, or progress update that would happen without changing output files.

Default output is concise and hides raw `yt-dlp` / `ffmpeg` logs behind friendly status lines.
Use `--verbose` when you need to debug the underlying commands or see full tool output.

## Default Workflow

Use `prepare` when you want the normal AI-ingestion path in one command:

```bash
ytai prepare "YOUTUBE_URL"
```

It runs the local workflow:

```text
ingest -> scout -> summarize
```

The command downloads the video assets, samples visual context with default scout
settings, and writes `analysis/summary-input.md`. Its output is grouped into
the same three steps so long downloads and frame extraction are easier to follow.
Video downloads default to the best MP4 stream at or below 1080p. If the source
video is only available below 1080p, `ytai` uses the highest available matching
stream. During the yt-dlp download, the CLI switches from the spinner to a
`cli-progress` progress bar with a percentage when yt-dlp reports progress.

Interactive `prepare` and `ingest` runs prompt for the final video folder before writing assets.
Press Enter to accept the generated default, or enter a custom folder path.
Home-relative paths such as `~/Movies/my-video` are expanded before any later workflow steps run.
Dry runs skip this prompt and use the generated default path.

For videos with dense visual information, use a shorter scout interval or wider
contact sheet:

```bash
ytai prepare "YOUTUBE_URL" --scout-interval 30 --scout-columns 5
```

For screen recordings, UI demos, animation, editing analysis, or other videos
where motion and timing matter, enable enhanced temporal scout:

```bash
ytai prepare "YOUTUBE_URL" --enhanced-scout
```

This keeps the same one-command workflow but adds ordered temporal frame groups
around each scout moment before `summarize` writes the final context.

Enhanced scout is most useful when key evidence lives between frames: UI bug
reproductions, game/frontend demos, animation, motion graphics, trailers,
editing examples, chart animations, or visual tutorials with sparse transcript
coverage. It usually adds less value for talking-head commentary, podcasts, or
static slide lectures where the transcript already carries most of the meaning.

## Local Video Files

`ytai ingest`, `ytai prepare`, and `ytai clip` accept a local video file path anywhere they accept a YouTube URL.
Any source that does not start with `http://` or `https://` is treated as a local file.

```bash
ytai prepare ~/Movies/talk.mp4
ytai prepare ~/Movies/talk.mp4 --link
ytai prepare ~/Movies/talk.mp4 --transcribe
ytai clip ~/Movies/talk.mp4 --from 03:20 --to 05:10
```

Local ingest needs only `ffmpeg` and `ffprobe`; `yt-dlp` is not used.
Metadata comes from `ffprobe`, and the video id is a 10-character hash of the absolute path and file size, so re-ingesting the same file yields the same id.

- The source video is copied into the folder by default. `--link` hardlinks it instead, and silently falls back to copying when hardlinks are not possible, for example across filesystems.
- `mp4`, `mov`, `mkv`, and `webm` files keep their container as `source.<ext>`. Other containers are remuxed to `source.mp4` with `ffmpeg -c copy`; if the remux fails, ingest stops and suggests a conversion command.
- Sidecar subtitles next to the source file are picked up automatically. For `talk.mp4`, files named `talk.srt`, `talk.vtt`, or language-tagged variants like `talk.en.srt` become `transcript.srt` / `transcript.vtt`. Exact-stem matches beat language-tagged ones, `.srt` beats `.vtt`, and the imported file is converted so both formats exist.
- `audio.wav` (16 kHz mono) and `thumbnail.jpg` are extracted from the video. Local files have no `description.txt`.
- `ingest-status.json` records `source: { "type": "local", "originalPath": ... }`, so `ytai resume` works on local folders without `yt-dlp` and re-imports the video from `originalPath` if `source.*` was deleted.
- YouTube-only flags (`--transcript-only`, `--rate-limit`, `--cookies-from-browser`, `--cookies`) are ignored for local files with a warning.

When no transcript exists, add `--transcribe` to `ingest` or `prepare` to generate one locally with whisper, or run `ytai transcribe` later:

```bash
ytai transcribe ./videos/video-folder
ytai transcribe ./videos/video-folder --force --whisper-model small --language en
```

Transcription uses the first available local whisper backend: `mlx_whisper`, then `whisper`.
Install one with `pip install mlx-whisper` (Apple Silicon) or `pipx install openai-whisper` (other platforms).
It reads `audio.wav`, writes `transcript.srt`, and converts it to `transcript.vtt`.
If VTT conversion fails, `ytai` keeps `transcript.srt` and prints a warning.
A `--dry-run` transcribe previews the `mlx_whisper` and `ffmpeg` commands without requiring `audio.wav` or probing installed backends.
During `ingest` or `prepare`, a failed `--transcribe` degrades to a status warning with a `ytai transcribe` retry hint instead of failing the run.

## Transcript Handling

`ytai` keeps the full transcript as `transcript.vtt` / `transcript.srt` in the video folder.
Transcripts come from YouTube subtitles, from sidecar subtitle files next to a local video, or from local whisper transcription via `--transcribe` / `ytai transcribe`.
When `summarize` generates `analysis/summary-input.md`, the transcript section works as follows:

| Transcript size | Behavior |
|-----------------|----------|
| ≤ 16K characters | Full raw transcript included verbatim |
| > 16K characters | Parsed into **5-minute timestamped chunks** covering the entire video duration |

This ensures the AI agent can see content from the **full video**, not just the opening minutes. Each chunk includes a time range (e.g., `10:00 → 15:00`) and the raw transcript text for that period — critical for investment analysis where stock targets and risk management often appear in the latter half.

## Partial Download Recovery

When YouTube blocks or rate-limits media downloads, `ytai` may still continue
with transcript, metadata, description, and thumbnail assets. The warning and
`ingest-status.json` include the classified `yt-dlp` cause plus the suggested
next retry step.

```bash
# HTTP 429 / rate limit: slow down requests
ytai prepare "URL" --rate-limit

# Login-required / age-restricted videos: use authenticated cookies
ytai prepare "URL" --cookies-from-browser chrome

# HTTP 403 after using browser cookies on a public video: retry without cookies
ytai prepare "URL" --resume
ytai resume ./videos/partial-folder

# Skip video entirely — only fetch transcript and metadata
ytai prepare "URL" --transcript-only

# Resume a partial ingest with cookies when authentication is required
ytai resume ./videos/partial-folder --cookies-from-browser chrome
```

## Output Structure

`ytai ingest` writes to `videos/YYYY-MM-DD_safe-title_videoid/` by default, or under the directory passed to `--out-dir`:

```text
source.mp4                      # video (may be missing on partial download; local files may keep source.mov/mkv/webm)
audio.wav                       # extracted audio (only if video exists)
transcript.vtt                  # full transcript
transcript.srt                  # converted transcript
description.txt                 # video description (YouTube sources only)
metadata.info.json              # yt-dlp metadata (ffprobe metadata for local files)
thumbnail.jpg                   # video thumbnail
ingest-status.json              # machine-readable asset record
frames/
clips/
analysis/
  summary-input.md              # includes timestamped transcript chunks
  visual-context.md             # (after scout)
  scout-manifest.json           # (after scout)
  temporal-context.md           # (after enhanced scout)
  temporal-manifest.json        # (after enhanced scout)
frames/scout/temporal/          # ordered temporal frame groups (after enhanced scout)
learning/                       # (after the learning commands, see Learning Workflow)
  topics-input.md               # written by ytai topics
  topics.json                   # written by your LLM
  plan-input.md                 # written by ytai plan
  plan.md                       # written by your LLM
  resources.md                  # written by your LLM
  progress.json                 # lesson progress and quiz scores, managed by ytai
  lessons/                      # <nn>-<topic-id>-input.md from ytai teach, <nn>-<topic-id>.md from your LLM
  quizzes/                      # <nn>-<topic-id>-quiz-input.md from ytai quiz; only the score persists, via ytai score
```

`ingest-status.json` includes a `source` field recording provenance: `{ "type": "youtube", "url": "..." }` or `{ "type": "local", "originalPath": "..." }`.
Status files written before this field existed are read as YouTube sources.

Some assets depend on what YouTube and `yt-dlp` can provide for the source video.

## Frame Extraction

Single timestamp extraction defaults to a 10-second window before and after the timestamp at 1 fps:

```bash
ytai frames ./videos/my-video --around 12:30
```

Multiple ranges can be extracted into one continuous sequence:

```bash
ytai frames ./videos/my-video \
  --range 00:05:20-00:05:40 \
  --range 00:13:00-00:13:30 \
  --range 00:23:40-00:24:00 \
  --fps 1 \
  --out ./frames \
  --mode select
```

Modes:

- `select`: one `ffmpeg` command with `select=between(...)`, writing `frame_%05d.jpg`.
- `seek`: one `ffmpeg` command per range, writing `range_001/frame_%04d.jpg` folders.
- `auto`: uses `seek` for one range, `select` for close ranges, and `seek` for far-apart ranges in videos over one hour.

Every successful extraction writes `frames_manifest.json`.
When run interactively without `--out`, `ytai frames` prompts for the output directory and defaults to `<video-folder>/frames`.

## Visual Scouting

`ytai scout` automatically samples visual context from an ingested video folder, so
you do not need to manually review the whole video and choose every timestamp:

```bash
ytai scout ./videos/my-video
```

By default it captures one frame every 60 seconds into `frames/scout/`, writes a
contact sheet, and creates agent-readable context files:

```text
frames/scout/frame_0001.jpg
frames/scout/frame_0002.jpg
frames/scout/contact_sheet.jpg
analysis/scout-manifest.json
analysis/visual-context.md
```

Use a shorter interval for chart-heavy videos or UI demos:

```bash
ytai scout ./videos/my-video --interval 30 --columns 5
```

Enhanced scout is opt-in:

```bash
ytai scout ./videos/my-video --enhanced
```

It keeps the normal scout outputs and also writes short temporal frame groups:

```text
frames/scout/temporal/block_0001/frame_0001.jpg
frames/scout/temporal/block_0001/frame_0002.jpg
frames/scout/temporal/block_0001/frame_0003.jpg
frames/scout/temporal/block_0001/frame_0004.jpg
frames/scout/temporal/block_0001/strip.jpg
analysis/temporal-manifest.json
analysis/temporal-context.md
```

Each block uses integer-second frames around a scout timestamp, usually one
frame before, one at the moment, and two after. The strip image is horizontal
and should be read left-to-right as temporal progression. This is local
`ffmpeg` evidence for agents that can inspect images; it does not reproduce
native video-token model understanding.

To compare regular and enhanced scout quality, prepare the same URL into two
separate folders:

```bash
ytai prepare "YOUTUBE_URL" --out-dir /tmp/ytai-eval-regular
ytai prepare "YOUTUBE_URL" --enhanced-scout --out-dir /tmp/ytai-eval-enhanced
```

Use questions that depend on visual sequence, such as what changed step by
step, where a UI bug happened, how an animation transitioned, or what motion
should be recreated. Regular scout shows isolated visual states; enhanced scout
adds short before/during/after strips around each sampled state.

## AI Context Files

`ytai summarize` and `ytai ask` do not call an AI provider yet. They create local prompt inputs:

```text
analysis/summary-input.md
analysis/question-input.md
```

These files include metadata, description, **full transcript** (or timestamped chunk index for long videos), and frame manifests. Future integrations can add OpenAI or Gemini calls on top of these context builders.

If `analysis/visual-context.md` or `analysis/scout-manifest.json` exists, the
generated prompt also includes those visual scouting artifacts so agents can
inspect sampled frames and contact sheets alongside the transcript.

If enhanced scout artifacts exist, the generated prompt also includes
`analysis/temporal-context.md` and `analysis/temporal-manifest.json` so agents
can inspect ordered frame groups for motion, timing, transitions, and UI flow.

After `ytai prepare`, `ytai learn <folder>` is the entry point for an agent that should drive the learning workflow.
It reports the current learning stage and the exact next command to run or file to write.

## Learning Workflow

The learning commands turn a prepared video folder into a study curriculum through a round-trip file contract.
`ytai` never calls an AI provider.
It writes self-contained `*-input.md` prompt files, any LLM writes the requested artifact files, and `ytai` validates the results and reports the next step.
This works with any LLM harness because every `*-input.md` embeds all evidence and instructions, and `ytai learn --json` is machine-readable.

The stage progression is:

```text
no-context -> needs-topics-input -> awaiting-topics -> (topics-invalid) ->
needs-plan-input -> awaiting-plan -> teaching -> complete
```

`topics-invalid` only appears while `learning/topics.json` has validation errors.
`complete` requires a done lesson for every `core` and `supporting` topic; `tangent` topics are optional.

Everything lives under `learning/` in the video folder:

```text
learning/
  teaching-guide.md             # deterministic teaching contract, preserved when topics reruns
  learner-profile.json           # editable learner preferences, preserved on reruns
  topics-input.md               # written by ytai topics
  topics.json                   # written by your LLM
  plan-input.md                 # written by ytai plan
  plan.md                       # written by your LLM
  resources.md                  # written by your LLM
  concepts.json                 # written by your LLM: acronyms, tools, methods, prerequisite concepts
  progress.json                 # lesson progress and quiz scores, managed by ytai
  lessons/
    01-topic-id-input.md        # written by ytai teach
    01-topic-id.md              # written by your LLM
  quizzes/
    01-topic-id-quiz-input.md   # written by ytai quiz; the quiz runs in conversation, no output file
```

`learner-profile.json` is local JSON that `ytai` writes when missing and preserves on reruns.
You may edit it manually to tune the learner's level, goals, known concepts, terms the lesson should not assume, preferred depth, and teaching preferences.

`learning/topics.json` uses schema version 1:

```json
{
  "version": 1,
  "topics": [
    {
      "id": "kebab-case-unique",
      "title": "Human title",
      "importance": "core",
      "timestamps": ["02:10-05:40"],
      "summary": "2-4 sentence summary of what the video says",
      "claims": ["specific claims made in the video"],
      "prerequisites": ["other-topic-id"],
      "visualEvidence": ["frames/scout/frame_0007.jpg"]
    }
  ]
}
```

`importance` is `core`, `supporting`, or `tangent`; `claims`, `prerequisites`, and `visualEvidence` are optional.
Validation errors include non-kebab-case or duplicate ids, invalid timestamp ranges, and prerequisites that reference unknown ids.
Ranges ending past the video duration, `visualEvidence` paths missing from the folder, and prerequisite cycles are warnings.
Lessons are taught in topological prerequisite order, with ties broken by importance rank and then input order; cycles never block ordering.

`learning/concepts.json` uses schema version 1:

```json
{
  "version": 1,
  "concepts": [
    {
      "id": "kebab-case-unique",
      "term": "SFT",
      "type": "acronym | library | method | metric | tool | background",
      "plainDefinition": "Beginner-friendly definition in 1-3 sentences.",
      "whyItMatters": "Why this concept matters for understanding the video.",
      "neededForTopics": ["topic-id"],
      "confusions": ["Common misconception to prevent."]
    }
  ]
}
```

`id`, `term`, `type`, `plainDefinition`, `whyItMatters`, and `neededForTopics` are required.
`neededForTopics` must only reference topic ids from `topics.json`; `confusions` is optional.
Validation errors include invalid JSON, a missing version, duplicate or non-kebab ids, missing required strings, non-array `neededForTopics`, and unknown topic references.
Core topics with no concept coverage are warnings.

A worked session:

```bash
ytai prepare ~/Movies/attention-talk.mp4 --transcribe
ytai topics ./videos/2026-07-05_attention-talk_1a2b3c4d5e
# LLM step: read learning/topics-input.md and write learning/topics.json
ytai learn ./videos/2026-07-05_attention-talk_1a2b3c4d5e
ytai plan ./videos/2026-07-05_attention-talk_1a2b3c4d5e
# LLM step: read learning/plan-input.md and write learning/plan.md + learning/resources.md + learning/concepts.json
ytai teach ./videos/2026-07-05_attention-talk_1a2b3c4d5e --next
# LLM step: read learning/lessons/01-<topic>-input.md and write learning/lessons/01-<topic>.md
ytai learn ./videos/2026-07-05_attention-talk_1a2b3c4d5e --done <topic>
ytai teach ./videos/2026-07-05_attention-talk_1a2b3c4d5e --next
# repeat teach and learn --done until ytai learn reports stage: complete
ytai quiz ./videos/2026-07-05_attention-talk_1a2b3c4d5e --due
# LLM step: read learning/quizzes/01-<topic>-quiz-input.md and conduct the quiz in the conversation
ytai score ./videos/2026-07-05_attention-talk_1a2b3c4d5e <topic> 85
ytai learn ./videos/2026-07-05_attention-talk_1a2b3c4d5e --json
```

At each LLM step the prompt file states the task, the exact output path, the schema or required sections, a quality bar, and the embedded evidence:

- `topics-input.md` asks for 4 to 12 teachable topics as strict JSON, with every timestamp grounded in the embedded transcript and scout evidence. `ytai topics` also writes `teaching-guide.md` when it does not already exist, so reruns do not erase user or model teaching preferences.
- `plan-input.md` asks for `plan.md` (stages that respect prerequisites, with depth targets and completion checks), `resources.md` (2 to 4 external resources per core topic), and `concepts.json` (acronyms, tools, methods, metrics, and prerequisite concepts needed to teach the topics well).
- Each `lessons/<nn>-<id>-input.md` asks for one standalone lesson with fixed sections: `## Learning goal`, `## Prerequisites and acronyms`, `## Mental model`, `## What the video says`, `## Teach the concept`, `## Worked example`, `## Common confusions`, `## Suggested learning`, and `## Practice`. The prompt embeds `teaching-guide.md` when present, only concept cards from `concepts.json` whose `neededForTopics` includes the current topic id, and the matching topic section from `resources.md`; missing artifacts are called out in the prompt so the LLM proceeds cautiously instead of failing.
- Each `quizzes/<nn>-<id>-quiz-input.md` asks for a concept-based oral quiz that tests definitions, distinctions, worked examples, failure modes, and application to new cases rather than transcript scavenger-hunt recall.
Concept validation surfaces schema errors, duplicate or non-kebab ids, unknown topic references, and uncovered core topics in `ytai learn` output and `learn --json` issues.
New folders remain in `awaiting-plan` until concept errors are fixed; legacy folders with existing lesson or progress state do not move backwards by themselves.
Lesson quality validation surfaces missing teaching sections, missing practice answers, and missing timestamp citations as warnings in `ytai learn` output and `learn --json` issues; it does not move legacy folders backwards or block progress by itself.
`ytai learn <folder>` prints the stage, an artifact checklist, lesson progress, and the next action.
`ytai learn <folder> --json` prints only `{ stage, artifacts, lessons, issues, review, nextAction }`; `nextAction.kind` is `cli` (run a command) or `llm` (write a file).
`ytai learn <folder> --check` validates the learning artifacts and exits with code 1 on errors.
`ytai learn <folder> --done <topic-id>` marks a topic's lesson done.
With `--dry-run`, `topics`, `plan`, `teach`, `quiz`, `score`, and `learn --done` validate and print the file or progress update they would make without writing prompt files or changing `learning/progress.json`.
Regenerating a lesson prompt for a completed topic resets that topic to pending while preserving its quiz scores and next review time.

### Retention: quiz and review

After a lesson is marked done, `ytai quiz` extends the same round-trip contract to retention.

```bash
ytai quiz ./videos/video-folder             # same as --due
ytai quiz ./videos/video-folder --due       # most overdue topic, else first unquizzed
ytai quiz ./videos/video-folder <topic-id>  # quiz one topic directly (lesson must be done)
ytai score ./videos/video-folder <topic-id> 85
```

`ytai quiz` writes `learning/quizzes/<nn>-<id>-quiz-input.md`, where `<nn>` is the topic's lesson number in teaching order.
The prompt embeds the lesson verbatim when `learning/lessons/<nn>-<id>.md` exists (otherwise it quizzes from the topic summary and transcript excerpt), plus the topic JSON and the topic's transcript excerpt.
It instructs the LLM to act as a strict oral examiner: ask 3 to 5 questions one at a time, never reveal an answer before the learner attempts it, grade against the video evidence citing timestamps, and announce a 0 to 100 score with its rubric.
The conversation is the exam room: unlike the other `*-input.md` files, no LLM output file is expected, and only the final score persists.
`ytai score <folder> <topic-id> <score>` records that score (an integer from 0 to 100, for a topic whose lesson is done), appends it to `learning/progress.json`, and prints the next review time and next action.
With `--dry-run`, it validates the score and reports the next review time without changing `learning/progress.json`.

Scheduling is simple spaced repetition: a score of 80 or higher passes.
A pass schedules the next review `2^(n-1)` days out for a trailing streak of `n` consecutive passes (1, 2, 4, ... days), capped at 60 days.
A score below 80 resets the next review to 1 day.
`progress.json` stays schema version 1: entries gain optional `scores` and `nextReviewAt` fields, and files written before quizzes existed remain valid.

Without an explicit topic id, `ytai quiz` (bare or `--due`) picks the most overdue due-for-review topic first, otherwise the first done-but-never-quizzed topic in teaching order, and errors when nothing is due and every done topic has been quizzed.

`ytai learn` surfaces the review queue.
The human output prints `Reviews: N due, M never quizzed` and suggests `Quiz next: ytai quiz <folder> --due` whenever either count is non-zero.
`ytai learn --json` includes a `review` block, `{ due: [{ id, nextReviewAt, lastScore }], unquizzed: [...] }`, with `due` sorted most overdue first.
Once the stage is `complete`, `nextAction` becomes `ytai quiz <folder> --due` while any review is due or any done topic is still unquizzed: after the last lesson, ytai steers the loop into first quizzes, then rests until reviews come due.

## Prompting an AI Agent

When asking an AI agent to analyze a prepared video folder, point it at the
whole folder and ask it to inspect the visual artifacts, not just the generated
Markdown prompt. `ytai prepare` prints this prompt after it finishes:

```text
Please analyze this ytai video folder and produce a detailed, evidence-based summary.

Start with analysis/summary-input.md. Then inspect analysis/visual-context.md,
frames/scout/contact_sheet.jpg, and any relevant individual images in
frames/scout/. Use transcript.srt or transcript.vtt for timestamped evidence.
If present, also inspect analysis/temporal-context.md and frames/scout/temporal/
for ordered frame groups.
Pay special attention to visual material such as charts, slides, diagrams,
screenshots, UI demos, and text shown on screen.

When summarizing, combine transcript evidence with visual evidence. Cite
timestamps where possible. If a visual frame changes or clarifies the transcript,
mention that explicitly.
```

For best results, make sure the agent can open image files in `frames/scout/`.
If it only reads `analysis/summary-input.md`, the output may still be mostly
transcript-based.

`ytai ingest` prints a shorter version that tells you to run `ytai scout` and
`ytai summarize` first, because ingest alone has not created the visual scout or
summary context files yet.

For the learning workflow, point the agent at `ytai learn <folder> --json` after `prepare`.
The JSON status tells the agent the current stage and the exact next command to run or artifact file to write.

## Development

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm dev --help
```

The CLI is intentionally small: `commander` for routing, Node `child_process.spawn` with argument arrays for external commands, and focused TypeScript modules under `src/lib`.
