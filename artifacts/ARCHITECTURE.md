# Architecture

## One-paragraph summary

`index.tsx` parses argv, creates the OpenTUI renderer, and mounts `App`. `App`
owns all mutable session state through reducers in `app/state/` and decides which
pane has focus. Everything that touches the outside world — the filesystem, child
processes, language servers — lives under `core/` as async, UI-free modules that
`App` calls and whose results it folds back into state. Components under
`components/` are handed state and callbacks; they compute layout and styling but
never spawn a process or read a file.

## Layer rules

```
        ┌──────────────────────────────────────────┐
        │ index.tsx        argv, renderer, exit    │
        └────────────────────┬─────────────────────┘
                             │ mounts
        ┌────────────────────▼─────────────────────┐
        │ app/App.tsx      layout, focus, keymap   │
        │ app/state/*      pure reducers           │
        └───────┬───────────────────────┬──────────┘
                │ renders               │ awaits
        ┌───────▼──────────┐   ┌────────▼─────────────────┐
        │ components/*     │   │ core/*                   │
        │ OpenTUI React    │   │ plain TS, no UI imports  │
        └───────┬──────────┘   └────────┬─────────────────┘
                │ both use              │
        ┌───────▼───────────────────────▼─────────┐
        │ lib/*   theme, highlight, logger        │
        └─────────────────────────────────────────┘
```

Imports point **downward only**. `core/` importing from `components/` or
`@opentui/*` is a bug; it is what makes the domain logic testable without a
terminal.

## Module responsibilities

### `core/languages/`

- `registry.ts` — the static table of supported languages. Each entry declares
  its id, display name, file extensions, comment syntax, the candidate binaries
  that could run it, how to build a run command, and which language servers to
  try. Data only; no execution.
- `detect.ts` — probes `PATH` for each candidate binary, resolves versions, and
  produces a `DetectedLanguage[]`. Results are cached for the session because a
  toolchain does not appear mid-run, and probing ~20 binaries is not free.

### `core/runner/`

- `scratch.ts` — owns the session scratch root. Allocates per-language scratch
  files, guarantees the directory exists, and removes the tree on exit.
- `execute.ts` — runs a `RunPlan` (an optional compile step, then an execute
  step), streams stdout/stderr as they arrive, enforces a timeout, and reports
  the exit status and wall time. Cancellable.

### `core/lsp/`

- `protocol.ts` — the subset of LSP types actually consumed. Hand-written rather
  than pulled from `vscode-languageserver-types` so `core/` stays dependency-free.
- `client.ts` — LSP JSON-RPC framing over a child process's stdio: request /
  response correlation, notifications, and the `Content-Length` header codec.
- `manager.ts` — one server per language, started lazily on first use of a
  buffer in that language, shut down with the app. Translates editor events
  (open, change, close) into LSP notifications and completion/hover/diagnostic
  requests into typed results.

### `core/fs/`

- `tree.ts` — lazy directory scanning with ignore rules, sorted
  directories-first. Nodes are flattened for rendering so the tree view can be a
  simple virtualised list.
- `files.ts` — reading and writing buffers, with binary-file and size guards.

### `app/state/`

Reducers over serialisable state. `tabs.ts` holds the open buffers and the
active index; `workspace.ts` holds the opened root and expansion set;
`session.ts` composes them plus pane focus and the runner's last result.

## Key data flows

**Run a buffer.** Keypress → `App` builds a `RunPlan` from the buffer's language
and the detected toolchain → `core/runner/scratch` writes the source → 
`core/runner/execute` spawns → each output chunk is appended to the output
pane's state → exit status lands in the status bar.

**Completion.** Editor reports a cursor position → `App` asks
`core/lsp/manager` → manager sends `textDocument/completion` to the language's
server → items are mapped to a plain shape → the completion popup renders over
the editor. If no server is running for that language, the request short-circuits
to an empty list and the popup never appears.

**Open a folder.** argv or a command → `core/fs/tree` scans one level →
`workspace` state stores the node → expanding a directory scans that level only.
Nothing recurses eagerly, so opening a huge repo is still instant.
