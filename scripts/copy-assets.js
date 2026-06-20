const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const vendor = path.join(root, "web", "vendor");

fs.rmSync(vendor, { recursive: true, force: true });
fs.mkdirSync(vendor, { recursive: true });

fs.copyFileSync(
  path.join(root, "node_modules", "@highlightjs", "cdn-assets", "highlight.min.js"),
  path.join(vendor, "highlight.min.js")
);
fs.copyFileSync(
  path.join(root, "node_modules", "@highlightjs", "cdn-assets", "styles", "github.min.css"),
  path.join(vendor, "highlight.css")
);
fs.cpSync(
  path.join(root, "node_modules", "mermaid", "dist"),
  path.join(vendor, "mermaid"),
  { recursive: true }
);

esbuild.buildSync({
  bundle: true,
  format: "esm",
  stdin: {
    contents: [
      'export { basicSetup, EditorView } from "codemirror";',
      'export { markdown } from "@codemirror/lang-markdown";'
    ].join("\n"),
    resolveDir: root
  },
  outfile: path.join(vendor, "codemirror.mjs")
});
