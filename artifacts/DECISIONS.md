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

---

## D12 — Every LSP-backed feature degrades to nothing

**Decision.** No server installed, a server that crashed, a request that timed
out: `completion()` returns `[]`, `hover()` returns `null`, diagnostics stay
empty. Nothing surfaces as an error.

**Why.** A machine with no language servers is the *common* case, not the
exception — that is the whole premise of "the machine owns the toolchains". The
editor has to be fully usable there. An error toast for a missing `pyright` would
fire on every keystroke.

**Consequence.** `LspManager.ask()` catches everything. That is deliberate, and
the reason each layer beneath it (client, framing) is separately tested: the
manager cannot distinguish a bug from an absent server, so the bugs have to be
caught lower down.

---

## D13 — Full-text document sync, not incremental

**Decision.** `textDocument/didChange` sends the whole buffer.

**Why.** Incremental sync would require the editor to track and translate edit
ranges into LSP's UTF-16 offsets on every keystroke — a meaningful amount of
error-prone bookkeeping. For scratch-sized files, shipping the whole text is
cheaper than maintaining that. Every server supports full sync.

**Revisit if.** Opening large files from a workspace becomes a common flow and
the per-keystroke cost shows up.

---

## D14 — LSP framing buffers bytes, never decoded strings

**Decision.** `MessageDecoder` accumulates `Uint8Array` and slices by byte
offset.

**Why.** `Content-Length` counts **bytes**. Buffering decoded strings and slicing
by character silently corrupts every message containing a non-ASCII character —
and servers put non-ASCII in diagnostic text routinely. There is a test using
`型 error ✓` specifically to hold this line.

---

## D15 — Requests are always timed out

**Decision.** Every `LspClient.request` has a deadline (5 s default) and rejects
when it passes. In-flight requests are also failed when the server process exits.

**Why.** An unsettled promise is the worst failure mode available: the feature
appears to hang, with nothing to report and nothing to retry. A server that stops
answering must degrade the feature, not the editor.

---

## D16 — Grammar data lives apart from the tokenizer

**Decision.** `lib/grammars.ts` holds the per-language word lists; `lib/highlight.ts`
stays the scanner. A `grammar()` helper supplies C-family defaults so a new
language is a few lines of keywords.

**Why.** The tokenizer is logic worth reading carefully; the grammars are a
table that will be appended to for years. Mixing them makes the interesting file
mostly data. The split also let the 24 added languages arrive without touching
the scanner at all — except for two genuine scanner bugs the new languages
exposed (block-before-line comment ordering, and triple-quoted strings).

## D17 — Unknown languages fall back to plain text

**Decision.** `languageFor()` returns `plainText`, not `typescript`, for a name
with no grammar.

**Why.** The previous fallback coloured Fortran's `program` and Erlang's `case`
using TypeScript's keyword list. Confidently wrong highlighting is worse than
none: it tells the reader the tool understands a language it does not. Plain
text still highlights strings, numbers, and punctuation, which is most of the
readability benefit anyway.

---

## D18 — Expansion and "children arrived" are separate actions

**Decision.** `workspaceReducer` has `expand`, `loading`, and `children` as three
distinct actions rather than one async "expand".

**Why.** The intermediate state — expanded, scan in flight, no children yet — is
a real state the view has to render, and it is the only place a spinner belongs.
Collapsing the three into one action would make that state unrepresentable and
force the view to infer it.

---

## D19 — Closing a tab moves focus left

**Decision.** After closing tab *n*, focus goes to `min(n, last)`.

**Why.** Focusing whatever slid into the closed slot means the tab under your
cursor changes identity without you moving — you close one thing and are
suddenly editing another. Moving left keeps the neighbour you were next to.

---

## D20 — Reducers return the same object when nothing changed

**Decision.** Every reducer branch returns `state` itself for a no-op, and
`updateTab` preserves identity when its updater does.

**Why.** These feed React. An `edit` action carrying identical text firing on
every keystroke would otherwise re-render the tab bar, the status bar, and the
tree. Tests assert identity (`toBe`), not just equality, because equality would
pass while the performance property silently broke.

---

## D21 — `App` is the only place state meets IO

**Decision.** Reducers decide what the session becomes, `core/` performs the
effect, and `App` sequences the two. No component performs IO; no reducer
awaits anything.

**Why.** It gives every layer a single reason to change and makes the awkward
part — "read the file, *then* dispatch what was read" — visible in one file
instead of scattered through the tree. It is also what lets 40 reducer tests run
with no filesystem.

---

## D22 — Quitting with unsaved buffers asks first

**Decision.** Ctrl+C / Ctrl+Q with dirty buffers opens a modal confirmation, and
the confirmation does not default to quitting.

**Why.** Losing unsaved work to a mistyped Ctrl+C is the only unrecoverable
thing this app can do. Everything else — a bad run, a wrong language, a closed
pane — costs seconds.

**Consequence.** The renderer is created with `exitOnCtrlC: false`, so the app
must handle every exit path itself, including signals and uncaught errors.

---

## D23 — The tree pane is dropped on a narrow terminal

**Decision.** Below 70 columns the file tree is not rendered, regardless of the
toggle.

**Why.** 28 columns of file names out of 60 leaves an editor too narrow to read
code in. Degrading the secondary pane is better than degrading both.

---

## D24 — Each tab gets its own editor instance

**Decision.** `<CodeEditor key={tab.id} />`.

**Why.** The editor owns cursor position, scroll offset, and undo history.
Sharing one instance across tabs would carry all three between buffers —
switching to another file and finding the cursor mid-line where it was in the
previous one, with the previous file's undo stack behind it.

**Cost.** Switching tabs remounts, discarding scroll and undo for the tab being
left. Worth revisiting if that becomes annoying; correctness first.

---

## D25 — The editor owns the completion popup; the host owns the items

**Decision.** `CodeEditor` takes a `completionProvider(line, column)` callback,
and owns the popup, the keys, and the insertion. `App` wires the callback to
`LspManager`.

**Why.** Accepting a completion is an *edit*, and the editor is the only thing
that knows the cursor, the partial word, and the undo stack. Lifting the popup
out would mean pushing all three back down through props. Keeping the source of
items out means the editor has no LSP dependency beyond the protocol's data
types, and tests drive it with a plain async function.

---

## D26 — Accepting a completion replaces the word, not the cursor position

**Decision.** The popup records the column the partial word started at, and
accepting replaces from there.

**Why.** Inserting at the cursor turns `con` + `console` into `conconsole`. The
anchor is captured when the popup opens, so it stays correct as you keep typing.
A test asserts exactly this string.

---

## D27 — Completion responses are versioned

**Decision.** Each request takes a monotonic token; a response whose token is no
longer current is dropped.

**Why.** Completion is requested on nearly every keystroke and servers answer out
of order. Without the guard, a slow response for a prefix you have already moved
past reopens the popup under stale items — the classic "the suggestion list keeps
flickering back" bug.

---

## D28 — Diagnostics keep the syntax colour and add an underline

**Decision.** The underline is a separate attribute mask applied over the token
colours, not a colour override.

**Why.** Recolouring an errored range destroys the syntax highlighting exactly
where you are trying to read carefully. The gutter mark also *replaces* the
gutter's trailing space rather than widening it, so a diagnostic appearing does
not reflow the whole document sideways — there is a test comparing the code's
start column with and without.

---

## D29 — An integration suite runs the real toolchains, and skips what is absent

**Decision.** `tests/integration.test.ts` detects what the machine has and
actually compiles and runs each installed language's template. Absent languages
`skip`, they do not fail.

**Why.** Unit tests prove a run plan is *built* correctly. Only this proves the
plan is *right*: that `rustc` accepts those flags, that a compiled binary lands
where the second step looks for it, that Java's single-file mode tolerates a
generated file name. A registry entry can be perfectly well-formed and still not
run — which is exactly what it found on its first run (see D30). Failing on a
machine without Go would make the suite useless, so absence is a skip.

---

## D30 — A file's indent style is preserved across a save

**Decision.** `fileTab` normalises tabs to spaces *and* records the file's style;
`save` reapplies it. `savedText` holds the normalised text, so a tab-indented
file opens clean.

**Why.** Found by opening this repo's own tab-indented source in the app: the tab
showed as dirty the instant it opened, and pressing ctrl+s would have rewritten
every line with spaces. The editor cannot hold literal tabs — a column index
would stop equalling a screen column — so the conversion has to be undone on the
way out rather than avoided.

**Limit.** Only *leading* whitespace round-trips. A tab used mid-line for
alignment becomes spaces. Documented, tested, and much rarer than indentation.

---

## D31 — A completion request waits for its own edit to reach the server

**Decision.** Typing queues a flag; the request is issued from an effect that
runs after the one which pushes the new text to the host.

**Why.** Found by driving the real app against `typescript-language-server`:
typing `.` and asking immediately queries a document the server has not been told
about, so it completes against the previous text — you get the global scope
instead of the members of the thing you just dotted.

**Also.** The queued flag deliberately carries *no position*. A key handler's
cursor is the pre-edit one, and a paste can move the cursor arbitrarily far; the
draining effect reads the settled cursor instead.

---

## D32 — A completion item's `textEdit` range is authoritative

**Decision.** When an item has a `textEdit`, replace *its* range. The word anchor
is only the fallback for items that have none.

**Why.** Found live: completing after a dot produced `greeting..at`. tsserver's
edit range covers the dot and its `newText` reinstates it, so applying that text
at our own anchor duplicates it. A range naming another line falls back rather
than corrupting the buffer.

---

## D33 — The layering rules are a test, not a paragraph

**Decision.** `tests/architecture.test.ts` asserts the AGENTS.md rules: no
`@opentui`, React, component, or app-state import under `core/`; no hex literal
in a component; a doc comment on every exported symbol in `core/`.

**Why.** Boundaries stated only in prose erode one convenient import at a time,
and the cost is invisible until the day something in `core/` can no longer be
tested without a terminal. Each rule was verified by introducing the violation
and watching it fail.

**Exemption.** Re-exports need no doc of their own — the symbol is documented
where it is defined, and a copy at the barrel would only drift.

---

## D34 — ctrl+s prompts rather than apologising

**Decision.** Saving a buffer with no path opens a name prompt, defaulting to the
opened folder (or the working directory).

**Why.** ctrl+s is advertised in the status bar and the help overlay, and in a
REPL most buffers are scratch buffers. The previous behaviour printed "scratch
buffer has no path — open a folder to save into it", which was both a dead end
and untrue: opening a folder would not have helped, because there was still no
way to name the file. An advertised key that never works is a defect.

**Scope.** A line editor, not a file browser. The tree already exists for
choosing a directory; what is missing at that moment is a name.

---

## D35 — Ctrl+C dismisses an overlay; it does not quit

**Decision.** While any overlay is open, Ctrl+C closes it. Quitting requires a
second press with nothing open, and still goes through the dirty-buffer
confirmation.

**Why.** "Cancel this prompt" is what the reflex means, and the buffer that
opened the save prompt is dirty by definition — exiting on it would discard the
very work the prompt exists to keep. The earlier behaviour quit outright,
skipping the confirmation entirely.

---

## D36 — Save-as refuses rather than clobbering

**Decision.** Saving to a path that already exists, or that another tab already
holds, reports and declines.

**Why.** Every scratch buffer is titled `scratch.<ext>`, so accepting the default
name twice would silently destroy the first — and there is no undo for that. Two
tabs on one path is the other half: it splits diagnostics between them and
breaks LSP sync as soon as either is closed.

---

## D37 — A save records the text it actually wrote

**Decision.** The `saved` action carries the written text, and `savedText` is set
from it rather than from the buffer's current contents.

**Why.** Writing is async. An edit made while the write is in flight was never
saved; marking it clean drops the dirty marker and loses it at quit. The write
and the clean-marking now refer to the same snapshot.
