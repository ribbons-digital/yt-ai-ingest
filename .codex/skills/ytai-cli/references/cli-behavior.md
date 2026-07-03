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

`ytai clip` uses `yt-dlp --download-sections` with normalized timestamps. `--force-keyframes` maps to `--force-keyframes-at-cuts`.

`ytai frames` accepts either `--around TIMESTAMP` or repeated `--range START-END` values. It writes a `frames_manifest.json` after successful extraction.

Frame modes:

- `select`: one `ffmpeg` command and continuous `frame_%05d.jpg` output.
- `seek`: separate `ffmpeg` commands and `range_001/frame_%04d.jpg` output.
- `auto`: `seek` for one range, `select` for nearby ranges, and `seek` for far-apart ranges in videos at least one hour long.

`ytai scout` samples an ingested source video at a fixed interval, writes frames to `frames/scout/`, builds `frames/scout/contact_sheet.jpg`, and writes `analysis/scout-manifest.json` plus `analysis/visual-context.md`.

`ytai summarize` and `ytai ask` are local-only placeholders. They write Markdown context files under `analysis/` and do not call OpenAI, Gemini, or other AI providers. If visual scout files exist, they are included in the generated context.
