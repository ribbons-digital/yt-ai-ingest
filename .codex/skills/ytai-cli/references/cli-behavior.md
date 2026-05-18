# ytai CLI Behavior

`ytai ingest` creates `videos/YYYY-MM-DD_safe-title_videoid/` and attempts to produce:

- `source.mp4`
- `audio.wav`
- `transcript.vtt`
- `transcript.srt`
- `metadata.info.json`
- `description.txt`
- `thumbnail.jpg`
- `frames/`, `clips/`, and `analysis/`

`ytai clip` uses `yt-dlp --download-sections` with normalized timestamps. `--force-keyframes` maps to `--force-keyframes-at-cuts`.

`ytai frames` accepts either `--around TIMESTAMP` or repeated `--range START-END` values. It writes a `frames_manifest.json` after successful extraction.

Frame modes:

- `select`: one `ffmpeg` command and continuous `frame_%05d.jpg` output.
- `seek`: separate `ffmpeg` commands and `range_001/frame_%04d.jpg` output.
- `auto`: `seek` for one range, `select` for nearby ranges, and `seek` for far-apart ranges in videos at least one hour long.

`ytai summarize` and `ytai ask` are local-only placeholders. They write Markdown context files under `analysis/` and do not call OpenAI, Gemini, or other AI providers.
