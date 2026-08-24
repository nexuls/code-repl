# Progress

Legend: `[x]` done · `[~]` in progress · `[ ]` not started

## Phase 0 — Foundations
- [x] Bun + OpenTUI React project scaffold
- [x] Biome lint/format gate
- [x] Dependency-free incremental highlighter (`lib/highlight.ts`)
- [x] Theme tokens (`lib/theme.ts`)
- [x] `CodeEditor` — cursor, scroll, undo/redo, indent, paste
- [x] AGENTS.md + CLAUDE.md symlink
- [x] `artifacts/` established

## Phase 1 — Language detection
- [x] Language registry — 30 languages, toolchains in preference order
- [x] PATH probing + version resolution, memoised per process
- [x] Tests (16)

## Phase 2 — Run pipeline
- [x] Scratch directory lifecycle (`$TMPDIR/code-repl-<pid>/<slot>/`)
- [x] Compile-then-execute with streaming output
- [x] Timeout + cancellation via process-group kill
- [x] Tests (20)

## Phase 3 — Workspace
- [x] Lazy directory scan with ignore rules, symlink resolution, error nodes
- [x] Structural-sharing tree updates + flatten-to-rows
- [x] File read/write with binary and size guards
- [x] Tests (28)

## Phase 4 — LSP
- [ ] JSON-RPC stdio client
- [ ] Server lifecycle manager
- [ ] Completion / hover / diagnostics
- [ ] Tests

## Phase 5 — UI
- [ ] `TabBar`
- [ ] `FileTree`
- [ ] `OutputPanel`
- [ ] `StatusBar`
- [ ] `CompletionPopup`
- [ ] `LanguagePicker`
- [ ] App shell wiring, pane focus, global keymap

## Phase 6 — Polish
- [ ] Editor mouse support (click-to-position, drag-select, wheel)
- [ ] Diagnostics in the gutter and underlined inline
- [ ] Command palette
- [ ] Frame-level UI tests

## Notes
Nothing is deferred silently — anything cut gets an entry in DECISIONS.md
explaining why.
