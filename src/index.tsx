import { createCliRenderer, TextAttributes } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer } from "@opentui/react";

function App() {
	const renderer = useRenderer();

	useKeyboard((key) => {
		if (key.name === "q" || (key.ctrl && key.name === "c")) {
			renderer.destroy();
			process.exit(0);
		}
	});

	return (
		<box alignItems="center" justifyContent="center" flexGrow={1}>
			<box justifyContent="center" alignItems="flex-end">
				<ascii-font font="tiny" text="OpenTUI" />
				<text attributes={TextAttributes.DIM}>What will you build?</text>
			</box>
		</box>
	);
}

const renderer = await createCliRenderer({
	screenMode: "alternate-screen",
	exitOnCtrlC: false,
});
createRoot(renderer).render(<App />);
