import mermaid from "./vendor/mermaid/mermaid.esm.min.mjs";

const openButton = document.getElementById("open");
const pathLabel = document.getElementById("path");
const remoteImages = document.getElementById("remote-images");
const theme = document.getElementById("theme");
const viewer = document.getElementById("viewer");

const tauri = window.__TAURI__;
let mermaidId = 0;

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  theme: "neutral"
});

function showError(message) {
  viewer.className = "viewer error";
  viewer.textContent = message;
}

function applyTheme() {
  document.body.dataset.theme = theme.value;
}

function configureRemoteImages() {
  viewer.querySelectorAll("img[data-remote-src]").forEach((image) => {
    if (remoteImages.checked) {
      image.src = image.dataset.remoteSrc;
      image.classList.remove("is-blocked");
    } else {
      image.src = image.dataset.placeholderSrc || "";
      image.classList.add("is-blocked");
    }
  });
}

function configureLocalImages() {
  viewer.querySelectorAll("img[data-local-src]").forEach((image) => {
    image.src = image.dataset.localSrc;
  });

  viewer.querySelectorAll("img.broken-image[data-placeholder-src]").forEach((image) => {
    image.src = image.dataset.placeholderSrc;
  });
}

function highlightCodeBlocks() {
  viewer.querySelectorAll("pre code").forEach((code) => {
    if (code.classList.contains("language-mermaid")) {
      return;
    }

    const lang = code.parentElement.getAttribute("lang");
    if (lang && /^[a-z0-9_+-]+$/i.test(lang)) {
      code.classList.add(`language-${lang.toLowerCase()}`);
    }

    window.hljs?.highlightElement(code);
  });
}

async function renderMermaidBlocks() {
  const blocks = viewer.querySelectorAll("pre[lang='mermaid'] code, code.language-mermaid");

  for (const code of blocks) {
    const pre = code.closest("pre");
    const container = pre ?? code;
    const diagram = document.createElement("div");
    diagram.className = "mermaid-diagram";

    try {
      const result = await mermaid.render(`mder-mermaid-${mermaidId++}`, code.textContent);
      diagram.innerHTML = result.svg;
      container.replaceWith(diagram);
    } catch {
      container.classList.add("mermaid-error");
    }
  }
}

async function decorateViewer() {
  highlightCodeBlocks();
  await renderMermaidBlocks();
  configureLocalImages();
  configureRemoteImages();
}

async function openMarkdownDocument(path) {
  try {
    viewer.className = "viewer loading";
    viewer.textContent = "Loading...";
    const document = await tauri.core.invoke("open_markdown_document", { path });
    pathLabel.textContent = document.path;
    viewer.className = "viewer";
    viewer.innerHTML = document.html;
    await decorateViewer();
  } catch (error) {
    showError(String(error));
  }
}

openButton.addEventListener("click", async () => {
  const path = await tauri.dialog.open({
    multiple: false,
    filters: [{ name: "Markdown", extensions: ["md"] }]
  });

  if (path) {
    await openMarkdownDocument(path);
  }
});

theme.addEventListener("change", applyTheme);
remoteImages.addEventListener("change", configureRemoteImages);
viewer.addEventListener(
  "error",
  (event) => {
    if (event.target instanceof HTMLImageElement) {
      event.target.classList.add("broken-image");
    }
  },
  true
);

window.addEventListener("DOMContentLoaded", async () => {
  applyTheme();
  const paths = await tauri.core.invoke("initial_markdown_paths");

  if (paths.length > 0) {
    await openMarkdownDocument(paths[0]);
  }
});
