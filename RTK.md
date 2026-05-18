# RTK Instructions

RTK is the Rust Token Killer CLI proxy from `rtk-ai/rtk`. It reduces noisy command output for agent workflows.

## Setup

Official RTK docs recommend verifying the correct binary with:

```bash
rtk --version
rtk gain
```

Install on macOS with:

```bash
brew install rtk-ai/tap/rtk
```

For Codex CLI project instructions, RTK documents:

```bash
rtk init --codex
```

That command creates or patches `AGENTS.md`. This project keeps `AGENTS.md` small and points back to this file.

## Usage Guidance

When RTK is available, prefer `rtk` for high-output development commands such as tests, build output, diffs, and broad searches. If RTK is unavailable or a command is not supported by RTK, run the normal command.

Examples:

```bash
rtk pnpm test
rtk pnpm build
rtk git diff
rtk rg "pattern"
```

Use `RTK_DISABLED=1` for a one-off raw command when the unfiltered output is required.
