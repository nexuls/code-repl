# code-repl

A terminal code REPL. Write a snippet in any language installed on your machine,
press one key, watch it run. Plus a file tree, tabs, and LSP-backed completion
and diagnostics.

```
┌ scratch.py ───────────────────────────────────────────────────────┐
│  1 def greet(name):                                               │
│  2     return f"hello, {name}"                                    │
│  3                                                                │
│  4 print(greet("world"))                                          │
│ INSERT  python                                    Ln 4/4, Col 21  │
└───────────────────────────────────────────────────────────────────┘
┌ ok · 34ms ────────────────────────────────────────────────────────┐
│ hello, world                                                      │
└───────────────────────────────────────────────────────────────────┘
 Python                       ^R run  ^S save  ^P lang  ^/ help
```

## Install and run

Requires [Bun](https://bun.sh).

```bash
bun install
bun run dev            # empty scratch buffer
bun run dev -- app.py  # open a file
bun run dev -- ~/src   # open a folder
```

## The one rule

**code-repl never installs anything.** It does not download a compiler, vendor
an interpreter, or fetch a language server. It looks at what is already on your
`PATH` and works with that.

A language whose toolchain is missing is shown greyed out in the picker
(`ctrl+p`), not hidden — so you can tell "code-repl doesn't support this" apart
from "this machine doesn't have it".

Thirty languages are in the registry, most with several candidate toolchains
tried in order:

| | |
|---|---|
| **Scripting** | Python · Ruby · Perl · PHP · Lua · R · Julia |
| **JS family** | TypeScript (bun / deno / tsx / ts-node) · JavaScript (node / bun / deno) |
| **Compiled** | C (cc / gcc / clang) · C++ · Rust · Go · Zig · Nim · Swift · Dart |
| **JVM/.NET** | Java · Kotlin · Scala · Clojure · C# |
| **Functional** | Haskell · OCaml · Elixir |
| **Shell** | Bash · Zsh · Fish |
| **Data** | JSON (validate and format with `jq`) |

Language servers follow the same rule: `pyright`, `gopls`, `rust-analyzer`,
`clangd`, `typescript-language-server` and two dozen more are used if present.
If none is installed, completion returns nothing and the editor is otherwise
unaffected — that is the expected case, not an error.

## Keys

| | |
|---|---|
| `ctrl+r` | run the buffer |
| `ctrl+e` | cancel a running program |
| `ctrl+l` | clear the output pane |
| `ctrl+n` / `ctrl+w` | new / close buffer |
| `ctrl+s` | save |
| `alt+←` / `alt+→` | previous / next buffer |
| `ctrl+p` | change language |
| `ctrl+b` / `ctrl+j` | toggle file tree / output |
| `shift+tab` | cycle pane focus |
| `ctrl+space` | completions |
| `ctrl+z` / `ctrl+y` | undo / redo |
| `ctrl+q` | quit |

The mouse works throughout: click to place the cursor, click a tab to switch or
its `×` to close, click the tree to expand or open, and scroll any pane.

## How it runs your code

Your buffer is written to `$TMPDIR/code-repl-<pid>/<tab>/` — never into the
folder you opened — then compiled and executed there. Output is streamed as it
arrives, runs are killed at a timeout, and the scratch tree is removed on exit.

## Development

```bash
bun run check     # biome + tsc --noEmit
bun test          # unit, component, and end-to-end tests
bun run check:fix # autofix
```

`tests/integration.test.ts` detects your installed toolchains and actually
compiles and runs each language's template; anything absent is skipped.

See [AGENTS.md](AGENTS.md) for architecture and conventions, and
[artifacts/](artifacts/) for the design log — `ARCHITECTURE.md`, `DECISIONS.md`
(why things are the way they are), and `MEMORY.md` (hard-won platform facts).
