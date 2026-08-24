# AGENTS.md — code-repl

Terminal-UI code REPL. Write a snippet in any language installed on the machine,
press one key, see it run. Plus a file tree, multiple tabs, and LSP-backed
completion, diagnostics, and hover.

## Non-negotiables

1. **The machine owns the toolchains.** code-repl never installs, downloads, or
   vendors a compiler, interpreter, or language server. It *detects* what is on
   `PATH` and degrades gracefully when something is missing. A language with no
   runtime found is shown greyed out, not hidden.
2. **`src/core/` is UI-free.** No `@opentui/*` import may appear under
   `src/core/`. Domain logic there is plain TypeScript, unit-testable without a
   renderer. UI lives in `src/components/` and `src/app/`.
3. **Nothing blocks the render loop.** Detection, process execution, and LSP
   traffic are all async and streamed. A slow `rustc` must never freeze a
   keystroke.
4. **Scratch files stay in the scratch root** (`$TMPDIR/code-repl-<pid>/`), are
   created lazily, and are removed on exit. Never write a scratch file into the
   user's opened folder.

## Layout

```
src/
  index.tsx            Entry point: argv, renderer bootstrap, exit paths.
  app/
    App.tsx            Root layout + global keymap. Owns pane focus.
    state/             Reducers. Pure functions over serialisable state.
  core/                Domain logic. NO UI IMPORTS. See rule 2.
    languages/         Language registry + toolchain detection.
    runner/            Scratch dirs, process spawn, output streaming.
    lsp/               JSON-RPC client, server lifecycle, capability mapping.
    fs/                Directory scanning, ignore rules, file IO.
  components/          OpenTUI React components. Presentational where possible.
  lib/                 Cross-cutting helpers: theme, highlighter, logger.
artifacts/             Architecture notes, progress log, design memory.
tests/                 `bun test`. Core logic gets unit tests; UI gets
                       `testRender` frame assertions.
```

## Conventions

- **Runtime**: Bun. `bun run dev` starts the app with watch mode.
- **Formatting/lint**: Biome, tabs, double quotes. Run `bun run check:fix`
  before committing; CI-equivalent gate is `bun run check && bun test`.
  `check` runs Biome **and** `tsc --noEmit` — Biome does not typecheck, and a
  type error will otherwise sail straight through a green lint run.
- **Types**: `strict`. No `any` in committed code — use `unknown` plus a
  narrowing guard.
- **Comments**: explain *why*, not *what*. A comment restating the next line is
  noise. Every exported symbol gets a doc comment covering its contract and its
  failure mode.
- **Colours**: never hardcode a hex value in a component. Add a token to
  `src/lib/theme.ts` and reference it, so themes stay swappable.
- **State**: reducers are pure and live in `src/app/state/`. Side effects
  (spawning, IO) go in `src/core/` behind an async function the reducer's caller
  awaits.

## Commits

Atomic — one logical change per commit, always leaving the tree green
(`bun run check && bun test`). Conventional-commit prefixes: `feat:`, `fix:`,
`refactor:`, `test:`, `docs:`, `chore:`.

## Keeping artifacts current

`artifacts/` is the project's memory and must be updated **in the same commit**
as the change it describes:

- `artifacts/ARCHITECTURE.md` — module boundaries and data flow. Update when a
  module is added or a boundary moves.
- `artifacts/PROGRESS.md` — what is done, in flight, and next. Update every
  session.
- `artifacts/DECISIONS.md` — append-only log of design decisions with their
  rationale and the alternatives rejected. Never rewrite history here; add a
  superseding entry instead.
- `artifacts/MEMORY.md` — hard-won facts: platform quirks, LSP oddities,
  toolchain gotchas. Things that would otherwise be rediscovered painfully.

## Gotchas

- OpenTUI renders **cells, not pixels**. Column indices must equal display
  cells, so tabs are expanded to spaces on load (`splitLines`).
- `useKeyboard` is global, not per-component. Components guard on their own
  `focused` prop or they will all react to the same keypress.
- Mouse coordinates from OpenTUI are global; subtract `currentTarget.x/y` for
  local cells.
- An unstable `onChange` identity in an effect's dep array will loop through the
  parent's state update. Keep callbacks out of deps deliberately, with a
  `biome-ignore` and a reason.
