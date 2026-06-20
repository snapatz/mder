import { EditorView, basicSetup, markdown } from "./vendor/codemirror.mjs";
import {
  findMatches,
  findMatchesInTexts,
  isCurrentPreviewRender,
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
const dirtyTitle = document.getElementById("dirty-title");
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
let appCloseRequested = false;
let appState = {};
let appWindow = null;
let cleanupScrollSync = null;
let editorView = null;
let findIndex = -1;
let findQuery = "";
let mermaidId = 0;
let previewRefresh = null;
let previewRenderId = 0;
let renderedPreview = null;
let saveStateTimer = null;
let stateReady = false;
let watchTimer = null;

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
  previewRenderId += 1;
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
    button.textContent = `${tab.conflicted ? "! " : ""}${tab.dirty ? "* " : ""}${tab.title}`;
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
    item.className = `tab-item${tab.dirty ? " dirty" : ""}${tab.conflicted ? " conflicted" : ""}`;
    item.append(button, close);
    tabList.append(item);
  });
}

function applyTheme() {
  document.body.dataset.theme = theme.value;
}

function isDocumentMode(value) {
  return value === "view" || value === "edit" || value === "dual";
}

function isTheme(value) {
  return [...theme.options].some((option) => option.value === value);
}

function normalizeWindowState(windowState) {
  const width = Math.round(Number(windowState?.width));
  const height = Math.round(Number(windowState?.height));
  if (width < 320 || height < 240) {
    return null;
  }
  return { width, height };
}

function markdownPaths(paths) {
  return Array.isArray(paths)
    ? paths.filter((path) => typeof path === "string" && path.toLowerCase().endsWith(".md"))
    : [];
}

async function loadStoredAppState() {
  try {
    return await tauri.core.invoke("load_app_state");
  } catch {
    return {};
  }
}

function applyStoredPreferences() {
  if (isTheme(appState.theme)) {
    theme.value = appState.theme;
  }
  remoteImages.checked = Boolean(appState.remoteImages);
  tabs.setRecentPaths(appState.recentPaths ?? []);
  applyTheme();
  renderRecent(tabs.snapshot());
}

function activeScrollContainer() {
  if (renderedPreview?.isConnected) {
    return renderedPreview;
  }
  if (editorView?.scrollDOM?.isConnected) {
    return editorView.scrollDOM;
  }
  return viewer;
}

function saveActiveDocumentState() {
  const tab = tabs.snapshot().activeTab;
  if (!tab) {
    return;
  }

  const currentDocument = appState.documents?.[tab.path] ?? {};
  appState = {
    ...appState,
    documents: {
      ...(appState.documents ?? {}),
      [tab.path]: {
        ...currentDocument,
        mode: tab.mode,
        scrollTop: activeScrollContainer()?.scrollTop ?? currentDocument.scrollTop ?? 0
      }
    }
  };
}

function restoreActiveScroll(state) {
  const tab = state.activeTab;
  const scrollTop = appState.documents?.[tab?.path]?.scrollTop;
  if (!tab || typeof scrollTop !== "number" || scrollTop <= 0) {
    return;
  }

  requestAnimationFrame(() => {
    activeScrollContainer().scrollTop = scrollTop;
  });
}

function restoreActiveDocumentMode(state) {
  const tab = state.activeTab;
  const mode = appState.documents?.[tab?.path]?.mode;
  if (tab && isDocumentMode(mode)) {
    return tabs.setMode(tab.id, mode);
  }
  return state;
}

async function currentWindowState() {
  try {
    return normalizeWindowState(await appWindow?.outerSize?.()) ?? normalizeWindowState(appState.window);
  } catch {
    return normalizeWindowState(appState.window);
  }
}

async function restoreWindowSize() {
  const size = normalizeWindowState(appState.window);
  if (!size || !appWindow?.setSize) {
    return;
  }

  try {
    if (tauri.dpi?.PhysicalSize) {
      await appWindow.setSize(new tauri.dpi.PhysicalSize(size.width, size.height));
    } else {
      await appWindow.setSize({ Physical: size });
    }
  } catch {
    // Invalid persisted window state should not block opening Markdown Documents.
  }
}

function buildAppState(windowState) {
  saveActiveDocumentState();
  const state = tabs.snapshot();
  const documents = { ...(appState.documents ?? {}) };

  state.tabs.forEach((tab) => {
    const currentDocument = documents[tab.path] ?? {};
    documents[tab.path] = {
      ...currentDocument,
      mode: tab.mode,
      scrollTop: tab.id === state.activeId ? activeScrollContainer().scrollTop : currentDocument.scrollTop ?? 0
    };
  });

  return {
    theme: theme.value,
    remoteImages: remoteImages.checked,
    recentPaths: state.recentPaths,
    openPaths: state.tabs.map((tab) => tab.path),
    activePath: state.activeTab?.path ?? null,
    window: windowState,
    documents
  };
}

async function saveAppStateNow() {
  if (!stateReady) {
    return;
  }

  clearTimeout(saveStateTimer);
  saveStateTimer = null;
  appState = buildAppState(await currentWindowState());
  await tauri.core.invoke("save_app_state", { state: appState });
}

function scheduleSaveState() {
  if (!stateReady) {
    return;
  }

  clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(() => {
    saveAppStateNow().catch(() => {});
  }, 250);
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
  if (!state.activeTab) {
    return [];
  }

  if (state.activeTab.mode !== "edit" && renderedPreview) {
    return findMatchesInTexts(
      previewTextNodes(renderedPreview).map((node) => node.nodeValue ?? ""),
      findQuery
    );
  }

  return findMatches(state.activeTab.source, findQuery);
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

function previewTextNodes(root) {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.nodeValue && !node.parentElement?.closest(".cm-editor, .mermaid-diagram, script, style")) {
      nodes.push(node);
    }
  }
  return nodes;
}

function applyFindHighlights(root) {
  clearFindHighlights(root);
  if (!findQuery) {
    return;
  }

  const nodes = previewTextNodes(root);
  let matchNumber = 0;
  let currentMark = null;

  nodes.forEach((node) => {
    const text = node.nodeValue;
    const matches = findMatches(text, findQuery);
    if (matches.length === 0) {
      return;
    }

    let cursor = 0;
    const fragment = document.createDocumentFragment();
    matches.forEach((match) => {
      fragment.append(document.createTextNode(text.slice(cursor, match.from)));
      const mark = document.createElement("mark");
      mark.className = matchNumber === findIndex ? "find-match current" : "find-match";
      mark.textContent = text.slice(match.from, match.to);
      if (matchNumber === findIndex) {
        currentMark = mark;
      }
      fragment.append(mark);
      cursor = match.to;
      matchNumber += 1;
    });
    fragment.append(document.createTextNode(text.slice(cursor)));
    node.replaceWith(fragment);
  });

  currentMark?.scrollIntoView({ block: "center", inline: "nearest" });
}

function applyEditorFind(state) {
  if (!editorView || !findQuery || state.activeTab?.mode !== "edit") {
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

async function renderPreview(tab, root, renderId = ++previewRenderId) {
  const source = tab.source;
  const html = tab.dirty
    ? await tauri.core.invoke("render_markdown_preview", {
        path: tab.path,
        source
      })
    : tab.html;

  if (!root.isConnected || !isCurrentPreviewRender(renderId, previewRenderId, source, tab.source)) {
    return false;
  }

  root.innerHTML = html;
  renderedPreview = root;
  await decorateViewer(root);
  if (!root.isConnected || !isCurrentPreviewRender(renderId, previewRenderId, source, tab.source)) {
    return false;
  }
  applyFindHighlights(root);
  return true;
}

function queuePreviewRefresh(tab, root) {
  clearTimeout(previewRefresh);
  const renderId = ++previewRenderId;
  previewRefresh = setTimeout(async () => {
    if (!root.isConnected) {
      return;
    }

    const ratio = scrollRatio(root.scrollTop, root.scrollHeight, root.clientHeight);
    try {
      if (await renderPreview(tab, root, renderId)) {
        refreshFindDisplay(tabs.snapshot());
        root.scrollTop = scrollTopForRatio(root.scrollHeight, root.clientHeight, ratio);
      }
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

  pathLabel.textContent = state.activeTab.conflicted
    ? `${state.activeTab.path} - changed on disk`
    : state.activeTab.path;
  if (state.activeTab.mode === "edit") {
    viewer.className = "viewer editor-host";
    renderEditor(state.activeTab);
    refreshFindDisplay(state);
    restoreActiveScroll(state);
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
    cleanupScrollSync = bindScrollSync(editorView.scrollDOM, previewPane);
    try {
      if (!(await renderPreview(state.activeTab, previewPane))) {
        return;
      }
    } catch (error) {
      showError(String(error));
      return;
    }
    refreshFindDisplay(tabs.snapshot());
    restoreActiveScroll(tabs.snapshot());
    return;
  }

  viewer.className = "viewer";
  try {
    if (!(await renderPreview(state.activeTab, viewer))) {
      return;
    }
  } catch (error) {
    showError(String(error));
    return;
  }
  refreshFindDisplay(state);
  restoreActiveScroll(state);
}

async function showStateForChangedTab(state, id) {
  if (state.activeId === id) {
    saveActiveDocumentState();
    await showState(state);
  } else {
    renderTabs(state);
    renderRecent(state);
    updateControls(state);
  }
}

async function showTab(id) {
  saveActiveDocumentState();
  await showState(tabs.switchTo(id));
  scheduleSaveState();
}

function promptChoice({ title, message, primary, secondary, cancel }) {
  dirtyTitle.textContent = title;
  dirtyMessage.textContent = message;
  dirtySave.textContent = primary;
  dirtyDiscard.textContent = secondary;
  dirtyCancel.textContent = cancel;
  dirtyModal.hidden = false;

  return new Promise((resolve) => {
    const finish = (choice) => {
      dirtyModal.hidden = true;
      dirtySave.removeEventListener("click", save);
      dirtyDiscard.removeEventListener("click", discard);
      dirtyCancel.removeEventListener("click", cancelChoice);
      resolve(choice);
    };
    const save = () => finish("primary");
    const discard = () => finish("secondary");
    const cancelChoice = () => finish("cancel");

    dirtySave.addEventListener("click", save);
    dirtyDiscard.addEventListener("click", discard);
    dirtyCancel.addEventListener("click", cancelChoice);
  });
}

function promptDirtyTab(tab) {
  return promptChoice({
    title: "Unsaved changes",
    message: `${tab.title} has unsaved changes.`,
    primary: "Save",
    secondary: "Don't Save",
    cancel: "Cancel"
  });
}

function promptConflict(tab) {
  return promptChoice({
    title: "File changed on disk",
    message: `${tab.title} changed outside mder while you had unsaved edits.`,
    primary: "Reload from Disk",
    secondary: "Keep My Edits",
    cancel: "Cancel"
  });
}

async function saveTab(tab) {
  try {
    if (!tab.conflicted) {
      const version = await tauri.core.invoke("markdown_document_version", { path: tab.path });
      if (version !== tab.version) {
        const state = tabs.markConflicted(tab.id, version);
        await showState(state);
        tab = state.tabs.find((candidate) => candidate.id === tab.id);
      }
    }

    if (tab.conflicted) {
      const choice = await promptConflict(tab);
      if (choice === "cancel") {
        await showState(tabs.snapshot());
        return null;
      }
      if (choice === "primary") {
        const document = await tauri.core.invoke("open_markdown_document", { path: tab.path });
        await showState(tabs.markReloaded(tab.id, document));
        return null;
      }
      tab = tabs.clearConflict(tab.id).tabs.find((candidate) => candidate.id === tab.id);
    }

    const document = await tauri.core.invoke("save_markdown_document", {
      path: tab.path,
      source: tab.source
    });
    await showState(tabs.markSaved(tab.id, document));
    scheduleSaveState();
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
  if (tabs.snapshot().activeId === id) {
    saveActiveDocumentState();
  }

  const nextState = tabs.close(id);
  if (!nextState.blockedCloseId) {
    await showState(nextState);
    scheduleSaveState();
    return true;
  }

  const tab = nextState.tabs.find((tab) => tab.id === nextState.blockedCloseId);
  const choice = await promptDirtyTab(tab);
  if (choice === "cancel") {
    await showState(tabs.snapshot());
    return false;
  }
  if (choice === "primary") {
    if (!(await saveTab(tab))) {
      return false;
    }
  }
  await showState(tabs.forceClose(tab.id));
  scheduleSaveState();
  return true;
}

async function openMarkdownDocument(path, { silent = false } = {}) {
  try {
    if (!silent) {
      viewer.className = "viewer loading";
      viewer.textContent = "Loading...";
    }
    const document = await tauri.core.invoke("open_markdown_document", { path });
    saveActiveDocumentState();
    await showState(restoreActiveDocumentMode(tabs.open(document)));
    scheduleSaveState();
    return true;
  } catch (error) {
    if (!silent) {
      showError(String(error));
    }
    return false;
  }
}

async function openMarkdownPaths(paths, options = {}) {
  for (const path of markdownPaths(paths)) {
    await openMarkdownDocument(path, options);
  }
}

async function checkExternalChanges() {
  for (const tab of tabs.snapshot().tabs) {
    try {
      const version = await tauri.core.invoke("markdown_document_version", { path: tab.path });
      if (version === tab.version || version === tab.externalVersion) {
        continue;
      }

      if (tab.dirty) {
        await showStateForChangedTab(tabs.markConflicted(tab.id, version), tab.id);
      } else {
        const document = await tauri.core.invoke("open_markdown_document", { path: tab.path });
        await showStateForChangedTab(tabs.markReloaded(tab.id, document), tab.id);
      }
    } catch {
      // ponytail: deletion UX is separate; keep the tab open if stat/read fails.
    }
  }
}

function startWatchingOpenDocuments() {
  watchTimer ??= setInterval(checkExternalChanges, 1500);
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

theme.addEventListener("change", () => {
  applyTheme();
  scheduleSaveState();
});
remoteImages.addEventListener("change", () => {
  configureRemoteImages();
  scheduleSaveState();
});
recent.addEventListener("change", async () => {
  if (recent.value) {
    await openMarkdownDocument(recent.value);
  }
});
modeSelect.addEventListener("change", async () => {
  const tab = tabs.snapshot().activeTab;
  if (tab) {
    saveActiveDocumentState();
    await showState(tabs.setMode(tab.id, modeSelect.value));
    scheduleSaveState();
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
viewer.addEventListener("scroll", scheduleSaveState, true);

async function resolveDirtyTabsForAppClose() {
  const discarded = new Set();

  while (true) {
    const dirtyTab = tabs.snapshot().tabs.find((tab) => tab.dirty && !discarded.has(tab.id));
    if (!dirtyTab) {
      return true;
    }

    await showTab(dirtyTab.id);
    const choice = await promptDirtyTab(dirtyTab);
    if (choice === "cancel") {
      return false;
    }
    if (choice === "primary" && !(await saveTab(dirtyTab))) {
      return false;
    }
    if (choice === "secondary") {
      discarded.add(dirtyTab.id);
    }
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  appWindow = tauri.window?.getCurrentWindow?.();
  appState = await loadStoredAppState();
  applyStoredPreferences();
  await restoreWindowSize();
  await appWindow?.onResized(() => scheduleSaveState());
  await appWindow?.onCloseRequested(async (event) => {
    if (appCloseRequested) {
      return;
    }

    event.preventDefault();
    if (tabs.snapshot().tabs.some((tab) => tab.dirty)) {
      if (!(await resolveDirtyTabsForAppClose())) {
        return;
      }
    }

    await saveAppStateNow().catch(() => {});
    appCloseRequested = true;
    await appWindow.close();
  });

  await tauri.event.listen("tauri://drag-drop", async (event) => {
    await openMarkdownPaths(event.payload.paths ?? []);
  });
  await tauri.event.listen("mder-open-paths", async (event) => {
    await openMarkdownPaths(event.payload);
  });

  const paths = await tauri.core.invoke("initial_markdown_paths");
  const startupPaths = markdownPaths(paths);
  const restorePaths = markdownPaths(appState.openPaths);

  await openMarkdownPaths(startupPaths.length ? startupPaths : restorePaths, {
    silent: startupPaths.length === 0
  });

  if (startupPaths.length === 0 && appState.activePath) {
    const tab = tabs.snapshot().tabs.find((tab) => tab.path === appState.activePath);
    if (tab) {
      await showTab(tab.id);
    }
  }

  stateReady = true;
  if (startupPaths.length > 0) {
    scheduleSaveState();
  }
  startWatchingOpenDocuments();
});
