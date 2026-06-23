# ytai

`ytai` is a local YouTube AI-ingestion CLI. It uses `yt-dlp` and `ffmpeg` to create predictable folders of video, audio, transcript, metadata, frame, and AI prompt assets.

## Install

```bash
pnpm install
pnpm build
pnpm link --global
```

Prerequisites:

```bash
brew install yt-dlp ffmpeg
```

## Commands

```bash
ytai prepare "YOUTUBE_URL"
ytai prepare "YOUTUBE_URL" --transcript-only
ytai prepare "YOUTUBE_URL" --rate-limit
ytai prepare "YOUTUBE_URL" --cookies-from-browser chrome
ytai prepare "YOUTUBE_URL" --resume
ytai prepare "YOUTUBE_URL" --enhanced-scout
ytai prepare "YOUTUBE_URL" --scout-interval 30 --scout-columns 5
ytai ingest "YOUTUBE_URL"
ytai ingest "YOUTUBE_URL" --transcript-only
ytai ingest "YOUTUBE_URL" --rate-limit
ytai ingest "YOUTUBE_URL" --cookies-from-browser chrome
ytai resume ./videos/video-folder
ytai resume ./videos/video-folder --rate-limit --cookies-from-browser chrome
ytai clip "YOUTUBE_URL" --from 03:20 --to 05:10
ytai clip "YOUTUBE_URL" --from 03:20 --to 05:10 --force-keyframes
ytai frames ./videos/video-folder --around 12:30
ytai frames ./videos/video-folder --around 12:30 --window 20 --fps 2
ytai scout ./videos/video-folder
ytai scout ./videos/video-folder --interval 30 --columns 5
ytai scout ./videos/video-folder --enhanced
ytai summarize ./videos/video-folder
ytai ask ./videos/video-folder "What are the key implementation steps?"
```

Global flags:

```bash
ytai --dry-run frames ./videos/video-folder --around 12:30
ytai --verbose ingest "YOUTUBE_URL"
```

Default output is concise and hides raw `yt-dlp` / `ffmpeg` logs behind friendly
status lines. Use `--verbose` when you need to debug the underlying commands or
see full tool output.

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

Interactive `prepare` and `ingest` runs prompt for the final video folder before
writing assets. Press Enter to accept the generated default, or enter a custom
folder path. Home-relative paths such as `~/Movies/my-video` are expanded before
any later workflow steps run.

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

## Transcript Handling

`ytai` always extracts the full transcript (`.vtt` / `.srt`) during ingest. When `summarize` generates `analysis/summary-input.md`, the transcript section works as follows:

| Transcript size | Behavior |
|-----------------|----------|
| ≤ 16K characters | Full raw transcript included verbatim |
| > 16K characters | Parsed into **5-minute timestamped chunks** covering the entire video duration |

This ensures the AI agent can see content from the **full video**, not just the opening minutes. Each chunk includes a time range (e.g., `10:00 → 15:00`) and the raw transcript text for that period — critical for investment analysis where stock targets and risk management often appear in the latter half.

## Anti-429 Options

When YouTube rate-limits downloads (HTTP 429), use these flags:

```bash
# Slow down requests
ytai prepare "URL" --rate-limit

# Use authenticated cookies (biggest 429 reduction)
ytai prepare "URL" --cookies-from-browser chrome

# Skip video entirely — only fetch transcript and metadata
ytai prepare "URL" --transcript-only

# Resume a partial ingest (only fills missing assets)
ytai prepare "URL" --resume
ytai resume ./videos/partial-folder --cookies-from-browser chrome
```

## Output Structure

`ytai ingest` writes to `videos/YYYY-MM-DD_video-title_videoid/`:

```text
source.mp4                      # video (may be missing on rate-limit)
audio.wav                       # extracted audio (only if video exists)
transcript.vtt                  # full YouTube transcript
transcript.srt                  # converted transcript
description.txt                 # video description
metadata.info.json              # yt-dlp metadata
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
```

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

## Development

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm dev --help
```

The CLI is intentionally small: `commander` for routing, Node `child_process.spawn` with argument arrays for external commands, and focused TypeScript modules under `src/lib`.
