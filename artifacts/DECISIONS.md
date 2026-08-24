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

---

## D5 — Unavailable languages are shown, not hidden

**Decision.** `detectLanguage` returns a `DetectedLanguage` for every language in
the registry, with `toolchain: undefined` when nothing is installed.

**Why.** A picker that silently omits Rust because `rustc` is missing is
indistinguishable from one that has never heard of Rust. Showing it greyed out
tells the user the tool supports it and the machine does not, which is
actionable.

**Consequence.** Every consumer must check `isAvailable()` before building a run
plan.

---

## D6 — Toolchains are ordered lists, and the first complete one wins

**Decision.** A language declares several toolchains; detection takes the first
whose `requires` are *all* on `PATH`.

**Why.** TypeScript can be run by `bun`, `deno`, `tsx`, or `ts-node`, and C by
`cc`, `gcc`, or `clang`. Ordering encodes preference (fastest / most standard
first) while a machine with only the last one still works. `requires` being a
list rather than a single binary is what makes Java's `javac`+`java` pair
expressible without a special case.

---

## D7 — Child processes are spawned detached, and killed by process group

**Decision.** `execute.ts` uses `node:child_process.spawn` with
`detached: true` and kills with `process.kill(-pid)`.

**Why.** Killing only the direct child is not enough. A snippet run through a
shell — or any program that forks — leaves grandchildren alive, and those
grandchildren inherit the stdout/stderr pipes. The first implementation waited
for end-of-stream to decide a step was over, and a `sh` script containing
`sleep 30` hung the whole run past its own timeout. Making the child a
process-group leader is the only way to reach what it spawned.

**Also.** Exit — not end-of-stream — is the authoritative end of a step. The
output drain gets a bounded 100 ms grace afterwards and no more.

**Rejected.** `Bun.spawn`: no `detached` option, so there is no way to create the
process group. This is the one place `core/` reaches for a Node API over a Bun
one.

---

## D8 — Failures are results, not exceptions

**Decision.** `startRun` throws only `NoToolchainError`. A compile error, a
crash, a timeout, and a missing binary all resolve as a `RunResult` with a
status.

**Why.** For a REPL, a compile error *is* the output the user asked for. Making
it an exception would force every caller to convert it back into something
displayable. Only "this machine fundamentally cannot run this language" is a
programming error on the caller's part, so only that throws.

---

## D9 — The file tree scans one level at a time

**Decision.** `scanDirectory` reads a single directory. A directory's children
are `undefined` until it is expanded.

**Why.** Opening a folder must be instant, and a recursive scan of a monorepo is
seconds of IO for rows nobody will look at. Laziness also bounds memory on a tree
with a pathological depth.

**Consequence.** `children: undefined` (not scanned) and `children: []`
(genuinely empty) mean different things, and the view depends on the difference
to show a loading state exactly once. Tests assert it.

---

## D10 — Tree updates share structure

**Decision.** `replaceChildren` rebuilds only the nodes between the root and the
changed node, and short-circuits on a path prefix check.

**Why.** The tree is React state. Rebuilding every node on every expansion would
re-render every row of a large tree; sharing untouched branches means identity
changes exactly where content changed, so memoised rows stay memoised.

---

## D11 — Unreadable input is a value, not an exception

**Decision.** `scanDirectory` returns a node carrying `error`; `loadFile` returns
a discriminated refusal with `reason: "too-large" | "binary" | "unreadable"`.

**Why.** These are ordinary conditions in a file browser — you click a `.png`,
you hit a permission-denied folder. The tab can say "binary file" and the tree
can mark one folder as failed, without an error path that blanks the pane. The
size and NUL-byte checks happen *before* anything reaches a buffer, because
splitting 200 MB into an array of lines would freeze the terminal.
