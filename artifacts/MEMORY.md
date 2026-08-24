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
