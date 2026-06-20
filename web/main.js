import mermaid from "./vendor/mermaid/mermaid.esm.min.mjs";
import { createTabStore } from "./tabs.mjs";

const openButton = document.getElementById("open");
const pathLabel = document.getElementById("path");
const recent = document.getElementById("recent");
const remoteImages = document.getElementById("remote-images");
const tabList = document.getElementById("tabs");
const theme = document.getElementById("theme");
const viewer = document.getElementById("viewer");

const tauri = window.__TAURI__;
const tabs = createTabStore();
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

function renderRecent(state) {
  recent.replaceChildren(new Option("Recent", ""));
  state.recentPaths.forEach((path) => {
    recent.add(new Option(path.split(/[\\/]/).pop() || path, path));
  });
  recent.value = "";
}

function renderTabs(state) {
  tabList.replaceChildren();

  state.tabs.forEach((tab) => {
    const button = document.createElement("button");
    button.className = tab.id === state.activeId ? "tab active" : "tab";
    button.type = "button";
    button.title = tab.path;
    button.textContent = tab.title;
    button.addEventListener("click", () => showTab(tab.id));

    const close = document.createElement("button");
    close.className = "tab-close";
    close.type = "button";
    close.title = `Close ${tab.title}`;
    close.textContent = "x";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      showState(tabs.close(tab.id));
    });

    const item = document.createElement("span");
    item.className = "tab-item";
    item.append(button, close);
    tabList.append(item);
  });
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

async function showState(state) {
  renderTabs(state);
  renderRecent(state);

  if (!state.activeTab) {
    pathLabel.textContent = "";
    viewer.className = "viewer empty";
    viewer.textContent = "Open a Markdown Document.";
    return;
  }

  pathLabel.textContent = state.activeTab.path;
  viewer.className = "viewer";
  viewer.innerHTML = state.activeTab.html;
  await decorateViewer();
}

async function showTab(id) {
  await showState(tabs.switchTo(id));
}

async function openMarkdownDocument(path) {
  try {
    viewer.className = "viewer loading";
    viewer.textContent = "Loading...";
    const document = await tauri.core.invoke("open_markdown_document", { path });
    await showState(tabs.open(document));
  } catch (error) {
    showError(String(error));
  }
}

async function openMarkdownPaths(paths) {
  if (!Array.isArray(paths)) {
    return;
  }

  for (const path of paths.filter(
    (path) => typeof path === "string" && path.toLowerCase().endsWith(".md")
  )) {
    await openMarkdownDocument(path);
  }
}

openButton.addEventListener("click", async () => {
  const paths = await tauri.dialog.open({
    multiple: true,
    filters: [{ name: "Markdown", extensions: ["md"] }]
  });

  if (Array.isArray(paths)) {
    await openMarkdownPaths(paths);
  } else if (paths) {
    await openMarkdownDocument(paths);
  }
});

theme.addEventListener("change", applyTheme);
remoteImages.addEventListener("change", configureRemoteImages);
recent.addEventListener("change", async () => {
  if (recent.value) {
    await openMarkdownDocument(recent.value);
  }
});
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
  await tauri.event.listen("tauri://drag-drop", async (event) => {
    await openMarkdownPaths(event.payload.paths ?? []);
  });
  await tauri.event.listen("mder-open-paths", async (event) => {
    await openMarkdownPaths(event.payload);
  });

  const paths = await tauri.core.invoke("initial_markdown_paths");

  await openMarkdownPaths(paths);
});
