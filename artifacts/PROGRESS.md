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
- [x] Byte-accurate `Content-Length` framing (`lsp/framing.ts`)
- [x] JSON-RPC stdio client with per-request timeouts (`lsp/client.ts`)
- [x] Server registry — 30 servers across 24 languages
- [x] Lifecycle manager, lazy per-language start, full-text sync
- [x] Completion / hover / diagnostics, all degrading to nothing
- [x] Tests (30), driven against a real fake-server child process

## Phase 4.5 — Highlighting breadth
- [x] Grammars for all 30 registry languages (`lib/grammars.ts`)
- [x] Triple-quoted strings; block-before-line comment ordering
- [x] Plain-text fallback for unknown languages
- [x] Tests (30)

## Phase 5 — UI
- [x] State reducers: `tabs.ts`, `workspace.ts`, `session.ts` (+40 tests)
- [x] Theme tokens for every pane; shared cell helpers (`lib/text.ts`)
- [x] `TabBar` — dirty markers, click to select, click to close
- [x] `FileTree` — windowed rows, lazy expansion, loading and error marks
- [x] `OutputPanel` — stream colours, chunk joining, ANSI stripping, sticky tail
- [x] `StatusBar` — language, toolchain presence, run result, priority layout
- [x] `LanguagePicker` — uninstalled languages shown but unselectable
- [x] `HelpOverlay` — the keymap, discoverable
- [x] App shell wiring, pane focus, global keymap, quit confirmation
- [x] Entry point: argv, signals, terminal restoration on every exit path
- [x] Tests: 26 component frame tests + 5 whole-app smoke tests
- [x] `CompletionPopup`

## Phase 6 — Polish
- [x] Editor mouse support: click to position, drag to follow, wheel to scroll
- [x] Diagnostics: gutter marks, inline underlines, message under the cursor
- [x] Completion: ctrl+space and `.`, stale-response guard, word replacement
- [x] Frame-level UI tests (26 component + 21 editor/LSP + 5 whole-app)
- [ ] Range text selection in the editor (drag currently moves the caret only)
- [ ] Hover tooltips (`LspManager.hover` exists; nothing renders it)
- [ ] Command palette

## Phase 7 — End-to-end verification
- [x] Integration suite that detects and actually runs every installed language
- [x] Real failure paths: runtime error, compile error, timeout, stdin
- [x] Verified on this machine: TypeScript, JavaScript, Python, Go, Rust, C,
      C++, Lua, Perl, Bash, Zsh, JSON all compile/run and print. The rest skip.

## Phase 8 — Driving the real app
Ran the app under tmux against real toolchains and a real language server, which
found four bugs no test had:
- [x] Typing into an overlay also typed into the buffer (`useKeyboard` is global,
      and the pane behind the overlay was still focused)
- [x] Opening a tab-indented file marked it dirty, and saving would have
      reindented it with spaces
- [x] Completion on `.` queried the server before it had been told about the dot
- [x] Accepting a member completion produced `greeting..at`
All four now have regression tests, each verified to fail without the fix.

## Phase 9 — Enforcement and the save gap
- [x] `tests/architecture.test.ts` enforces the layering rules in AGENTS.md:
      nothing under `core/` imports `@opentui`, React, a component, or app state;
      no component hardcodes a hex colour; every exported symbol in `core/` is
      documented. Verified by mutation — each rule fails when violated.
- [x] Documented the 26 exported contracts in `core/` that were missing docs.
- [x] `ctrl+s` on a scratch buffer now prompts for a name instead of printing an
      apology. It was advertised in the status bar and the help overlay while
      doing nothing for most buffers.

## Phase 10 — Review follow-up
A high-effort review of the save-as work found eight issues, all real, all fixed:
- [x] Save-as silently overwrote an existing file
- [x] Save-as could put two tabs on one path, splitting diagnostics
- [x] The chosen name did not change the buffer's language
- [x] `openDocument` re-ran on every save, reverting the server to stale text
- [x] The saved file never appeared in the tree
- [x] Ctrl+C in a prompt quit outright, discarding dirty buffers
- [x] A tab was marked clean with text that was never written
- [x] The doc-comment rule skipped every `export async function`

## Notes
Nothing is deferred silently — anything cut gets an entry in DECISIONS.md
explaining why.
