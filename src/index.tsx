import { createCliRenderer, parseColor, StyledText } from "@opentui/core";
import {
	createRoot,
	useKeyboard,
	useRenderer,
	useTerminalDimensions,
} from "@opentui/react";
import { useState } from "react";
import { CodeEditor } from "./components/CodeEditor";
import { darkTheme } from "./lib/theme";

const SAMPLE = `// code-repl — type to see live highlighting
import { createCliRenderer } from "@opentui/core"

interface Task {
  id: number
  label: string
  done: boolean
}

const TAGS = /#[a-z][\\w-]*/g

export function summarize(tasks: Task[]): string {
  const open = tasks.filter((task) => !task.done)
  if (open.length === 0) return "all clear"

  /* Template literals keep their own highlighting,
     including \${interpolated} expressions. */
  return \`\${open.length} open of \${tasks.length}: \${open
    .map((task) => task.label.match(TAGS)?.join(" ") ?? task.label)
    .join(", ")}\`
}

const renderer = await createCliRenderer({ exitOnCtrlC: false })
console.log(summarize([{ id: 1, label: "ship #tui", done: false }]))
`;

function App() {
	const renderer = useRenderer();
	const { width, height } = useTerminalDimensions();
	const [dirty, setDirty] = useState(false);
	const [saved, setSaved] = useState(false);

	useKeyboard((key) => {
		if (key.ctrl && key.name === "c") {
			renderer.destroy();
			process.exit(0);
		}
	});

	return (
		<box
			flexDirection="column"
			width={width}
			height={height}
			backgroundColor={darkTheme.background}
		>
			<CodeEditor
				value={SAMPLE}
				language="typescript"
				filename={`editor.ts${dirty ? " •" : ""}`}
				width={width}
				height={height - 1}
				onChange={() => {
					setDirty(true);
					setSaved(false);
				}}
				onSave={() => setSaved(true)}
			/>
			<text
				content={
					new StyledText([
						{
							__isChunk: true,
							text: saved
								? " saved  ·  ctrl+z undo  ·  ctrl+k delete line  ·  ctrl+d duplicate  ·  ctrl+c quit "
								: " ctrl+s save  ·  ctrl+z undo  ·  ctrl+k delete line  ·  ctrl+d duplicate  ·  ctrl+c quit ",
							fg: parseColor(saved ? darkTheme.token.string : darkTheme.muted),
							bg: parseColor(darkTheme.background),
						},
					])
				}
				wrapMode="none"
			/>
		</box>
	);
}

const renderer = await createCliRenderer({
	screenMode: "alternate-screen",
	exitOnCtrlC: false,
	useMouse: true,
	enableMouseMovement: true,
});
createRoot(renderer).render(<App />);
