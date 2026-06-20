import { EditorView, basicSetup, markdown } from "./vendor/codemirror.mjs";
import {
  findMatches,
  nextMatchIndex,
  scrollRatio,
  scrollTopForRatio
} from "./document-tools.mjs";
import mermaid from "./vendor/mermaid/mermaid.esm.min.mjs";
import { createTabStore } from "./tabs.mjs";

const dirtyCancel = document.getElementById("dirty-cancel");
const dirtyDiscard = document.getElementById("dirty-discard");
const dirtyMessage = document.getElementById("dirty-message");
const dirtyModal = document.getElementById("dirty-modal");
const dirtySave = document.getElementById("dirty-save");
const findCount = document.getElementById("find-count");
const findInput = document.getElementById("find");
const findNext = document.getElementById("find-next");
const findPrev = document.getElementById("find-prev");
const modeSelect = document.getElementById("mode");
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
let cleanupScrollSync = null;
let editorView = null;
let findIndex = -1;
let findQuery = "";
let mermaidId = 0;
let previewRefresh = null;
let renderedPreview = null;

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
  cleanupScrollSync?.();
  cleanupScrollSync = null;
  clearTimeout(previewRefresh);
  previewRefresh = null;
  renderedPreview = null;
}

function updateControls(state) {
  const hasTab = Boolean(state.activeTab);
  modeSelect.disabled = !hasTab;
  modeSelect.value = state.activeTab?.mode ?? "view";
  saveButton.disabled = !state.activeTab?.dirty;
  updateFindControls(state);
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

function configureRemoteImages(root = viewer) {
  root.querySelectorAll("img[data-remote-src]").forEach((image) => {
    if (remoteImages.checked) {
      image.src = image.dataset.remoteSrc;
      image.classList.remove("is-blocked");
    } else {
      image.src = image.dataset.placeholderSrc || "";
      image.classList.add("is-blocked");
    }
  });
}

function configureLocalImages(root = viewer) {
  root.querySelectorAll("img[data-local-src]").forEach((image) => {
    image.src = image.dataset.localSrc;
  });

  root.querySelectorAll("img.broken-image[data-placeholder-src]").forEach((image) => {
    image.src = image.dataset.placeholderSrc;
  });
}

function highlightCodeBlocks(root = viewer) {
  root.querySelectorAll("pre code").forEach((code) => {
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

async function renderMermaidBlocks(root = viewer) {
  const blocks = root.querySelectorAll("pre[lang='mermaid'] code, code.language-mermaid");

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

async function decorateViewer(root = viewer) {
  highlightCodeBlocks(root);
  await renderMermaidBlocks(root);
  configureLocalImages(root);
  configureRemoteImages(root);
}

function activeFindMatches(state) {
  return state.activeTab ? findMatches(state.activeTab.source, findQuery) : [];
}

function updateFindControls(state) {
  const hasTab = Boolean(state.activeTab);
  const matches = activeFindMatches(state);
  if (matches.length && findIndex < 0) {
    findIndex = 0;
  }
  if (findIndex >= matches.length) {
    findIndex = matches.length - 1;
  }

  findInput.disabled = !hasTab;
  findPrev.disabled = !hasTab || matches.length === 0;
  findNext.disabled = !hasTab || matches.length === 0;
  findCount.textContent = findQuery ? `${matches.length ? findIndex + 1 : 0}/${matches.length}` : "";
}

function clearFindHighlights(root) {
  root.querySelectorAll("mark.find-match").forEach((mark) => {
    mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
  });
  root.normalize();
}

function applyFindHighlights(root) {
  clearFindHighlights(root);
  if (!findQuery) {
    return;
  }

  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.nodeValue && !node.parentElement?.closest(".cm-editor, .mermaid-diagram, script, style")) {
      nodes.push(node);
    }
  }

  const needle = findQuery.toLowerCase();
  let matchNumber = 0;
  let currentMark = null;

  nodes.forEach((node) => {
    const text = node.nodeValue;
    const lower = text.toLowerCase();
    let cursor = 0;
    let index = lower.indexOf(needle);
    if (index === -1) {
      return;
    }

    const fragment = document.createDocumentFragment();
    while (index !== -1) {
      fragment.append(document.createTextNode(text.slice(cursor, index)));
      const mark = document.createElement("mark");
      mark.className = matchNumber === findIndex ? "find-match current" : "find-match";
      mark.textContent = text.slice(index, index + findQuery.length);
      if (matchNumber === findIndex) {
        currentMark = mark;
      }
      fragment.append(mark);
      cursor = index + findQuery.length;
      matchNumber += 1;
      index = lower.indexOf(needle, cursor);
    }
    fragment.append(document.createTextNode(text.slice(cursor)));
    node.replaceWith(fragment);
  });

  currentMark?.scrollIntoView({ block: "center", inline: "nearest" });
}

function applyEditorFind(state) {
  if (!editorView || !findQuery) {
    return;
  }

  const matches = activeFindMatches(state);
  const match = matches[findIndex];
  if (match) {
    editorView.dispatch({
      selection: { anchor: match.from, head: match.to },
      scrollIntoView: true
    });
  }
}

function refreshFindDisplay(state = tabs.snapshot()) {
  updateFindControls(state);
  applyEditorFind(state);
  if (renderedPreview) {
    applyFindHighlights(renderedPreview);
  }
}

function moveFind(direction) {
  const state = tabs.snapshot();
  const matches = activeFindMatches(state);
  findIndex = nextMatchIndex(matches.length, findIndex, direction);
  refreshFindDisplay(state);
}

function bindScrollSync(first, second) {
  let syncing = false;

  const sync = (from, to) => {
    if (syncing) {
      return;
    }

    syncing = true;
    requestAnimationFrame(() => {
      to.scrollTop = scrollTopForRatio(
        to.scrollHeight,
        to.clientHeight,
        scrollRatio(from.scrollTop, from.scrollHeight, from.clientHeight)
      );
      setTimeout(() => {
        syncing = false;
      }, 0);
    });
  };

  const syncFirst = () => sync(first, second);
  const syncSecond = () => sync(second, first);
  first.addEventListener("scroll", syncFirst);
  second.addEventListener("scroll", syncSecond);

  return () => {
    first.removeEventListener("scroll", syncFirst);
    second.removeEventListener("scroll", syncSecond);
  };
}

async function renderPreview(tab, root) {
  root.innerHTML = tab.dirty
    ? await tauri.core.invoke("render_markdown_preview", {
        path: tab.path,
        source: tab.source
      })
    : tab.html;
  renderedPreview = root;
  await decorateViewer(root);
  applyFindHighlights(root);
}

function queuePreviewRefresh(tab, root) {
  clearTimeout(previewRefresh);
  previewRefresh = setTimeout(async () => {
    if (!root.isConnected) {
      return;
    }

    const ratio = scrollRatio(root.scrollTop, root.scrollHeight, root.clientHeight);
    try {
      await renderPreview(tab, root);
      root.scrollTop = scrollTopForRatio(root.scrollHeight, root.clientHeight, ratio);
    } catch (error) {
      showError(String(error));
    }
  }, 120);
}

function renderEditor(tab, parent = viewer, onChange) {
  parent.replaceChildren();
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
          onChange?.(state.activeTab, state);
        }
      })
    ],
    parent
  });
  applyEditorFind(tabs.snapshot());
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
    viewer.className = "viewer editor-host";
    renderEditor(state.activeTab);
    refreshFindDisplay(state);
    return;
  }

  if (state.activeTab.mode === "dual") {
    viewer.className = "viewer dual-pane-host";
    viewer.replaceChildren();
    const editorPane = document.createElement("section");
    editorPane.className = "dual-editor";
    const previewPane = document.createElement("section");
    previewPane.className = "dual-preview";
    viewer.append(editorPane, previewPane);

    renderEditor(state.activeTab, editorPane, (tab) => queuePreviewRefresh(tab, previewPane));
    try {
      await renderPreview(state.activeTab, previewPane);
    } catch (error) {
      showError(String(error));
      return;
    }
    cleanupScrollSync = bindScrollSync(editorView.scrollDOM, previewPane);
    refreshFindDisplay(tabs.snapshot());
    return;
  }

  viewer.className = "viewer";
  try {
    await renderPreview(state.activeTab, viewer);
  } catch (error) {
    showError(String(error));
    return;
  }
  refreshFindDisplay(state);
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
modeSelect.addEventListener("change", async () => {
  const tab = tabs.snapshot().activeTab;
  if (tab) {
    await showState(tabs.setMode(tab.id, modeSelect.value));
  }
});
findInput.addEventListener("input", () => {
  findQuery = findInput.value;
  findIndex = findQuery ? 0 : -1;
  refreshFindDisplay();
});
findInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    moveFind(event.shiftKey ? -1 : 1);
  }
});
findPrev.addEventListener("click", () => moveFind(-1));
findNext.addEventListener("click", () => moveFind(1));
saveButton.addEventListener("click", saveActiveTab);
document.addEventListener("keydown", async (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    await saveActiveTab();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    findInput.focus();
    findInput.select();
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
