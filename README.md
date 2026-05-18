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
ytai ingest "YOUTUBE_URL"
ytai clip "YOUTUBE_URL" --from 03:20 --to 05:10
ytai clip "YOUTUBE_URL" --from 03:20 --to 05:10 --force-keyframes
ytai frames ./videos/video-folder --around 12:30
ytai frames ./videos/video-folder --around 12:30 --window 20 --fps 2
ytai summarize ./videos/video-folder
ytai ask ./videos/video-folder "What are the key implementation steps?"
```

Global flags:

```bash
ytai --dry-run frames ./videos/video-folder --around 12:30
ytai --verbose ingest "YOUTUBE_URL"
```

## Output Structure

`ytai ingest` writes to `videos/YYYY-MM-DD_video-title_videoid/`:

```text
source.mp4
audio.wav
transcript.srt
transcript.vtt
metadata.info.json
description.txt
thumbnail.jpg
frames/
clips/
analysis/
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

## AI Context Files

`ytai summarize` and `ytai ask` do not call an AI provider yet. They create local prompt inputs:

```text
analysis/summary-input.md
analysis/question-input.md
```

These files include metadata, description, transcript excerpts, and frame manifests. Future integrations can add OpenAI or Gemini calls on top of these context builders.

## Development

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm dev --help
```

The CLI is intentionally small: `commander` for routing, Node `child_process.spawn` with argument arrays for external commands, and focused TypeScript modules under `src/lib`.
