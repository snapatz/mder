import { EditorView, basicSetup, markdown } from "./vendor/codemirror.mjs";
import mermaid from "./vendor/mermaid/mermaid.esm.min.mjs";
import { createTabStore } from "./tabs.mjs";

const dirtyCancel = document.getElementById("dirty-cancel");
const dirtyDiscard = document.getElementById("dirty-discard");
const dirtyMessage = document.getElementById("dirty-message");
const dirtyModal = document.getElementById("dirty-modal");
const dirtySave = document.getElementById("dirty-save");
const modeToggle = document.getElementById("mode-toggle");
const openButton = document.getElementById("open");
const pathLabel = document.getElementById("path");
const recent = document.getElementById("recent");
const remoteImages = document.getElementById("remote-images");
const saveButton = document.getElementById("save");
const tabList = document.getElementById("tabs");
const theme = document.getElementById("theme");
const viewer = document.getElementById("viewer");

const tauri = window.__TAURI__;
const tabs = createTabStore();
let editorView = null;
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

function destroyEditor() {
  editorView?.destroy();
  editorView = null;
}

function updateControls(state) {
  const hasTab = Boolean(state.activeTab);
  modeToggle.disabled = !hasTab;
  saveButton.disabled = !state.activeTab?.dirty;
  modeToggle.textContent = state.activeTab?.mode === "edit" ? "Viewer" : "Editor";
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
    button.textContent = `${tab.dirty ? "* " : ""}${tab.title}`;
    button.addEventListener("click", () => showTab(tab.id));

    const close = document.createElement("button");
    close.className = "tab-close";
    close.type = "button";
    close.title = `Close ${tab.title}`;
    close.textContent = "x";
    close.addEventListener("click", async (event) => {
      event.stopPropagation();
      await closeTab(tab.id);
    });

    const item = document.createElement("span");
    item.className = tab.dirty ? "tab-item dirty" : "tab-item";
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

function renderEditor(tab) {
  viewer.className = "viewer editor-host";
  viewer.replaceChildren();
  editorView = new EditorView({
    doc: tab.source,
    extensions: [
      basicSetup,
      markdown(),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const state = tabs.updateSource(tab.id, update.state.doc.toString());
          renderTabs(state);
          updateControls(state);
        }
      })
    ],
    parent: viewer
  });
  editorView.focus();
}

async function showState(state) {
  destroyEditor();
  renderTabs(state);
  renderRecent(state);
  updateControls(state);

  if (!state.activeTab) {
    pathLabel.textContent = "";
    viewer.className = "viewer empty";
    viewer.textContent = "Open a Markdown Document.";
    return;
  }

  pathLabel.textContent = state.activeTab.path;
  if (state.activeTab.mode === "edit") {
    renderEditor(state.activeTab);
    return;
  }

  viewer.className = "viewer";
  viewer.innerHTML = state.activeTab.html;
  await decorateViewer();
}

async function showTab(id) {
  await showState(tabs.switchTo(id));
}

function promptDirtyTab(tab) {
  dirtyMessage.textContent = `${tab.title} has unsaved changes.`;
  dirtyModal.hidden = false;

  return new Promise((resolve) => {
    const finish = (choice) => {
      dirtyModal.hidden = true;
      dirtySave.removeEventListener("click", save);
      dirtyDiscard.removeEventListener("click", discard);
      dirtyCancel.removeEventListener("click", cancel);
      resolve(choice);
    };
    const save = () => finish("save");
    const discard = () => finish("discard");
    const cancel = () => finish("cancel");

    dirtySave.addEventListener("click", save);
    dirtyDiscard.addEventListener("click", discard);
    dirtyCancel.addEventListener("click", cancel);
  });
}

async function saveTab(tab) {
  try {
    const document = await tauri.core.invoke("save_markdown_document", {
      path: tab.path,
      source: tab.source
    });
    await showState(tabs.markSaved(tab.id, document));
    return document;
  } catch (error) {
    showError(String(error));
    return null;
  }
}

async function saveActiveTab() {
  const tab = tabs.snapshot().activeTab;
  if (tab?.dirty) {
    await saveTab(tab);
  }
}

async function closeTab(id) {
  const nextState = tabs.close(id);
  if (!nextState.blockedCloseId) {
    await showState(nextState);
    return true;
  }

  const tab = nextState.tabs.find((tab) => tab.id === nextState.blockedCloseId);
  const choice = await promptDirtyTab(tab);
  if (choice === "cancel") {
    await showState(tabs.snapshot());
    return false;
  }
  if (choice === "save") {
    if (!(await saveTab(tab))) {
      return false;
    }
  }
  await showState(tabs.forceClose(tab.id));
  return true;
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
modeToggle.addEventListener("click", async () => {
  const tab = tabs.snapshot().activeTab;
  if (tab) {
    await showState(tabs.setMode(tab.id, tab.mode === "edit" ? "view" : "edit"));
  }
});
saveButton.addEventListener("click", saveActiveTab);
document.addEventListener("keydown", async (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    await saveActiveTab();
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

async function closeDirtyTabsForApp() {
  while (true) {
    const dirtyTab = tabs.snapshot().tabs.find((tab) => tab.dirty);
    if (!dirtyTab) {
      return true;
    }

    await showTab(dirtyTab.id);
    const closed = await closeTab(dirtyTab.id);
    if (!closed) {
      return false;
    }
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  applyTheme();
  const appWindow = tauri.window?.getCurrentWindow?.();
  await appWindow?.onCloseRequested(async (event) => {
    if (tabs.snapshot().tabs.some((tab) => tab.dirty)) {
      event.preventDefault();
      if (await closeDirtyTabsForApp()) {
        await appWindow.close();
      }
    }
  });

  await tauri.event.listen("tauri://drag-drop", async (event) => {
    await openMarkdownPaths(event.payload.paths ?? []);
  });
  await tauri.event.listen("mder-open-paths", async (event) => {
    await openMarkdownPaths(event.payload);
  });

  const paths = await tauri.core.invoke("initial_markdown_paths");

  await openMarkdownPaths(paths);
});
