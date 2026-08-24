# Memory

Hard-won facts. Things that cost time to discover and would cost it again.

## OpenTUI

- The terminal is a grid of **cells**, not pixels. A column index is only a
  display position if every character is one cell wide — hence tabs are expanded
  to spaces at load time and wide glyphs (CJK, emoji) will still desynchronise
  the cursor. Anything touching columns must go through the same normaliser.
- `useKeyboard` subscribes **globally**. Two mounted components both handling
  `"up"` will both fire. Every keyboard-handling component must early-return on
  `!focused`.
- Mouse event `x`/`y` are global renderer cells. Local coordinates are
  `event.x - event.currentTarget.x`, and `currentTarget` changes as the event
  bubbles — read it before doing arithmetic.
- OpenTUI synthesises no `click`. A click arrives as `down` then `up`; a double
  click is two such pairs with no click-count field. Multi-click intent must be
  timed by hand (OpenTUI's own selection code uses a 500 ms / 1-cell window).
- `ScrollBox` culls offscreen children by default, which means their
  `renderBefore`/`renderAfter` hooks do not run. Never put layout or state in a
  render hook.
- `renderer.destroy()` also unmounts the React root, but the code that *created*
  the renderer still owns calling it on every exit path, signals included.

## Highlighting

- Multi-line constructs (block comments, template literals) mean the tokenizer
  cannot be per-line. It scans the whole document once, then buckets tokens by
  line, so the editor can still render only the visible window.

## Editor

- An effect that calls `onChange` must not list `onChange` in its deps: an
  unstable parent callback identity re-fires the effect, which updates the
  parent, which re-creates the callback. The dep array deliberately omits it.

## Toolchains

- Version flags are wildly inconsistent: `--version` for most, `-version` for
  `java`, `version` for `go` and `zig`, `-v` for `lua` and `perl`. Each toolchain
  carries its own `versionArgs`.
- Many tools print their version banner to **stderr**, not stdout (`java
  -version`, `lua -v`). The probe reads both and takes the first non-empty one.
- Java 11+ can run a single `.java` file directly (`java Main.java`), which
  bypasses the rule that a public class name must match its file name. That form
  is preferred over `javac` + `java` precisely because scratch files have
  generated names.
- `go run` and `zig run` and `nim r` compile into their own caches, so those
  languages need one step, not two — the compile/run split is a property of the
  toolchain, not the language.
- `dotnet run` requires a project directory, so C# detection targets scripting
  hosts (`dotnet-script`, `csi`, `mono`) instead.
- The version probe must have a timeout. A misconfigured install that hangs on
  `--version` would otherwise hang startup, since detection runs before first
  paint.

## Processes

- End-of-stream is **not** the end of a process. Orphaned grandchildren keep the
  parent's pipes open, so a run must key off `close`/exit and treat the output
  drain as a bounded courtesy.
- An `AbortSignal` listener registered *after* the first `await` can miss an
  abort that arrives in between. In `runStep` the listener goes in before the
  spawn settles, and the kill is repeated once there is a live pid to signal.
  The symptom was a `cancel()` called synchronously after `run()` being ignored
  until the timeout fired.
- `TextDecoder` must be used with `{ stream: true }` when decoding pipe chunks.
  A multi-byte character split across two reads otherwise decodes as two
  replacement characters.
- A child killed by a signal reports `code === null` on `close`; the signal name
  arrives separately. It is mapped to the shell's `128 + signo` convention so the
  exit code stays a number.

## Filesystem

- A `Dirent` for a symlink reports neither `isFile()` nor `isDirectory()`, so
  links must be `stat`'d to be classified. A broken link is skipped entirely —
  showing it as a file produces a tab that can never open.
- Binary detection is a NUL byte in the first 4 KB, which is what `git` and
  `grep` use. Cheap, and no false positives on real source.
- Decoding is deliberately non-fatal: a file that is mostly UTF-8 with one bad
  byte is still worth reading with replacement characters. Only a NUL earns a
  refusal.

## LSP

- `Content-Length` is a **byte** count. Reassembly must buffer bytes; decoding
  first and slicing by character breaks any message with non-ASCII text.
- A pipe can deliver a message one byte at a time, or three messages in one
  chunk. The decoder is tested at both extremes.
- `textDocument/completion` legitimately returns *either* a bare array *or* a
  `CompletionList`. Both are in the spec; both must be handled.
- Servers order candidates through `sortText`, which is frequently nothing like
  alphabetical — it is how "the member you probably want" reaches the top. Sort
  by `sortText` and fall back to `label`, never sort by label alone.
- The protocol's `languageId` is not always the obvious name: shell scripts are
  `shellscript`, not `bash`. Each server spec carries its own mapping.
- A server request *to* the client must be answered even if we do not implement
  it — some servers stall waiting. Unknown server-initiated requests get a
  `null` result.
- A second `didOpen` for an already-open document is rejected by some servers.
  Re-opening is translated into a `didChange` resync instead.
- `Position.character` is a **UTF-16 code-unit** offset, not a byte or grapheme
  offset. Relevant the moment a line contains an emoji.

## Highlighting, continued

- The block-comment opener must be tested **before** the line-comment opener.
  In several languages the block form extends the line form — Lua `--[[` over
  `--`, Julia `#=` over `#`, Nim `#[` over `#` — so checking the line form first
  swallows the opener and the block runs to end of file.
- `"""` must be matched before `"`, or a docstring scans as an empty string
  followed by an unterminated one, which mis-colours the whole remaining file.
- The fallback grammar for an unknown language is deliberately *not* TypeScript.
  Highlighting an unrecognised language with someone else's keyword list is
  confidently wrong; plain text with working strings and numbers is honest.

## OpenTUI, continued

- `mockInput.pressKey` takes a `KeyCodes` value, not a key name string.
  `pressKey("down")` silently does nothing.
- A lone ESC byte is ambiguous with the start of an escape sequence, so the
  parser holds it briefly before deciding it is the Escape key. A test that
  presses ESC and asserts immediately will see nothing; it needs a short wait.
- Biome's `a11y` rules assume a DOM and flag `onMouseDown` on `<box>` as an
  interactive-static-element violation. The domain is disabled in `biome.json`.
- A `biome-ignore` for `useExhaustiveDependencies` must sit directly above the
  `useEffect(` line — not above the dependency array — or it is reported as an
  unused suppression.
- `testRender` accepts a `ReactNode`, so a helper that takes one must not wrap
  it in a fragment; Biome flags the useless fragment and typing the helper as
  `ReactElement` then rejects legitimate `ReactNode` callers.

## Terminal input

- Ctrl+Space arrives as a **NUL byte** (`U+0000`), not as a named key with a
  ctrl modifier. Writing that byte literally into a source file makes the file
  binary to `grep` and invisible to most tooling — it must be an escape.
- OpenTUI's underline is `TextAttributes.UNDERLINE` (8). Use the exported enum
  rather than a hand-written bit; the numbering is not obvious from the name.

## Java

- `java Main.java` single-file source mode **compiles in-process** and needs the
  `jdk.compiler` module. A JRE-only install has `java` on PATH, starts happily,
  and then dies with `InternalError: Module jdk.compiler not in boot Layer`.
  Detecting `java` alone is therefore not enough: the toolchain requires `javac`
  as the proxy for "this is a JDK", even though the run plan never invokes it.
  Found by the integration suite; a unit test now pins it.
