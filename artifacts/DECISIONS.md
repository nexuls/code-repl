# Decisions

Append-only. Newest last. Supersede by adding an entry, never by editing one.

---

## D1 — Bun as the runtime

**Decision.** Target Bun, not Node.

**Why.** `Bun.spawn` gives streaming stdio with no extra dependency, `bun test`
needs no test-runner config, and `bun build --compile` produces a single-file
binary — which is how a terminal tool wants to be distributed. OpenTUI's native
renderer is also best-supported on Bun.

**Rejected.** Node + tsx: more moving parts for the same result, and a worse
story for shipping a standalone binary.

---

## D2 — A hand-written highlighter instead of Tree-sitter

**Decision.** `lib/highlight.ts` is a ~400-line hand-rolled tokenizer.

**Why.** OpenTUI bundles Tree-sitter grammars only for JS/TS/Markdown/Zig.
"Any language installed on the machine" means the highlighter must cover
languages with no bundled grammar, and asking the user to install grammars
contradicts the project's "no toolchain management" rule. A per-line regex
tokenizer is good enough for a scratch REPL and costs nothing to add a language
to.

**Rejected.** Tree-sitter via `docs/reference/tree-sitter` — better fidelity,
but grammar acquisition is exactly the problem we refuse to own.

**Revisit if.** LSP semantic tokens turn out to be widely available, in which
case the server can supply highlighting for languages it already handles.

---

## D3 — `core/` may not import UI

**Decision.** A hard rule, stated in AGENTS.md, that nothing under `src/core/`
imports `@opentui/*` or anything from `src/components/`.

**Why.** The interesting logic — detection, process orchestration, LSP framing —
is exactly the part that is miserable to test through a renderer. Keeping it
UI-free means those tests are plain function calls.

**Rejected.** Colocating a language's detection with its UI picker: fewer files,
but the detection then can only be exercised by mounting a terminal.

---

## D4 — Scratch files live outside the workspace

**Decision.** Runs write to `$TMPDIR/code-repl-<pid>/`, never into the folder
the user opened.

**Why.** A REPL that litters `main.tmp.go` into someone's repository — or worse,
overwrites a real file whose name collides — is a tool people stop trusting.
Keeping scratch state in one removable directory also makes cleanup a single
`rm -rf` on exit.
