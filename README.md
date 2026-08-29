# Editz

A browser-based media toolkit. Thirty-odd single-purpose tools for video, audio and
images, plus one multi-track editor, sharing one engine.

Built for people on expensive mobile data and unreliable connections. That is an
architectural constraint, not a tagline: work happens on the user's device wherever it
possibly can, and when it can't, we say so — in megabytes — before they commit.

## Where things live

| Path                      | What it is                                                        |
| ------------------------- | ----------------------------------------------------------------- |
| `apps/web`                | Next.js app. Every tool page is generated from the registry.       |
| `packages/tool-registry`  | Manifests + types. The single source of truth for what a tool is.  |
| `packages/engine-core`    | Operation types, the FFmpeg compiler, `decideExecution()`.         |
| `packages/engine-client`  | ffmpeg.wasm runner in a Web Worker. (M2)                           |
| `packages/engine-server`  | Native FFmpeg runner and progress parsing. (M3)                    |
| `packages/ui`             | Shared controls and design tokens.                                 |
| `packages/db`             | Drizzle schema. (M3)                                               |
| `packages/config`         | tsconfig presets, eslint flat config, Tailwind theme.              |

## The two rules

**Adding a tool means adding a manifest.** Not a route, not a page component, not an
upload widget. If you are about to copy a page to make a second tool, the abstraction is
wrong — fix the abstraction.

**An operation is defined once.** `buildOps()` returns engine-agnostic `Operation[]`;
`engine-core` compiles that to an FFmpeg argv array; the client and server runners both
consume that argv. Trim is never implemented twice.

## Running it

```bash
pnpm install
pnpm dev
```

Node 22 (see `.nvmrc`). Copy `.env.example` to `.env.local` first.

```bash
pnpm typecheck   # tsc --noEmit across the workspace
pnpm test        # vitest
pnpm build       # production build
pnpm copy:audit  # lists tool pages whose SEO copy is still below the 150-word floor
```

### The FFmpeg suites

`packages/engine-core` has two suites that run compiled commands through a real
FFmpeg and read the output back with ffprobe. They skip themselves when no
binary is found, and say so in the report rather than vanishing — a green run
with them skipped is not a green run.

```bash
pnpm --filter @editz/tool-registry exec vitest run
```

To run them, put `ffmpeg` and `ffprobe` on `PATH`, or point at them directly:

```bash
FFMPEG_PATH=/path/to/ffmpeg FFPROBE_PATH=/path/to/ffprobe pnpm --filter @editz/engine-core test:ffmpeg
```

Fixtures are generated with `lavfi` at run time. Nothing binary is committed.

## Milestone status

- [x] **M1** — Skeleton. Registry, all manifests, generated landing pages, tokens, the
      data meter. No processing.
- [ ] **M2** — Client engine. `engine-core` compiler, ffmpeg.wasm in a Worker, four tools
      end-to-end in-browser.
- [ ] **M3** — Server engine. Postgres, R2, BullMQ, worker, SSE progress.
- [ ] **M4** — Accounts, quotas, watermarking, billing.
- [ ] **M5** — AI subtitles and African-language translation.
- [ ] **M6** — Multi-track editor.
- [ ] **M7** — The long tail.

## Notes for anyone touching this

- TypeScript strict. No `any` without a comment saying why.
- FFmpeg arguments are arrays. Never build a shell string from user input.
- No file is retained past 24 hours, and the UI says so plainly.
- Cross-origin isolation headers go on tool routes only — they break third-party embeds
  everywhere else.
- Performance is SEO. The budget for a tool landing page is ~120KB of JS, measured on 3G.
  The ~30MB ffmpeg.wasm core loads only after a file is chosen, and is cached forever
  after.
