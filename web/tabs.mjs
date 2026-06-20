export function createTabStore(initial = {}) {
  let nextId = 1;
  let activeId = null;
  const tabs = [];
  const recentPaths = Array.isArray(initial.recentPaths) ? [...initial.recentPaths] : [];

  function snapshot() {
    return {
      activeId,
      activeTab: tabs.find((tab) => tab.id === activeId) ?? null,
      recentPaths: [...recentPaths],
      tabs: tabs.map((tab) => ({ ...tab }))
    };
  }

  function remember(path) {
    const index = recentPaths.indexOf(path);
    if (index !== -1) {
      recentPaths.splice(index, 1);
    }
    recentPaths.unshift(path);
  }

  return {
    close(id) {
      const index = tabs.findIndex((tab) => tab.id === id);
      if (index === -1) {
        return snapshot();
      }

      if (tabs[index].dirty) {
        return { ...snapshot(), blockedCloseId: id };
      }

      tabs.splice(index, 1);
      if (activeId === id) {
        activeId = tabs[index]?.id ?? tabs[index - 1]?.id ?? null;
      }
      return snapshot();
    },
    forceClose(id) {
      const index = tabs.findIndex((tab) => tab.id === id);
      if (index === -1) {
        return snapshot();
      }

      tabs.splice(index, 1);
      if (activeId === id) {
        activeId = tabs[index]?.id ?? tabs[index - 1]?.id ?? null;
      }
      return snapshot();
    },
    markSaved(id, document) {
      const tab = tabs.find((tab) => tab.id === id);
      if (tab) {
        tab.conflicted = false;
        tab.html = document.html;
        tab.source = document.source;
        tab.savedSource = document.source;
        tab.version = document.version ?? tab.version;
        tab.dirty = false;
      }
      return snapshot();
    },
    markConflicted(id, version) {
      const tab = tabs.find((tab) => tab.id === id);
      if (tab && version !== tab.version) {
        tab.conflicted = true;
        tab.externalVersion = version;
      }
      return snapshot();
    },
    markReloaded(id, document) {
      const tab = tabs.find((tab) => tab.id === id);
      if (tab) {
        tab.conflicted = false;
        tab.dirty = false;
        tab.externalVersion = null;
        tab.html = document.html;
        tab.savedSource = document.source;
        tab.source = document.source;
        tab.version = document.version ?? tab.version;
      }
      return snapshot();
    },
    clearConflict(id) {
      const tab = tabs.find((tab) => tab.id === id);
      if (tab) {
        tab.conflicted = false;
        tab.externalVersion = null;
      }
      return snapshot();
    },
    open(document) {
      const tab = {
        conflicted: false,
        dirty: false,
        externalVersion: null,
        id: nextId++,
        path: document.path,
        mode: "view",
        savedSource: document.source,
        source: document.source,
        title: document.path.split(/[\\/]/).pop() || document.path,
        html: document.html,
        version: document.version ?? ""
      };
      tabs.push(tab);
      activeId = tab.id;
      remember(tab.path);
      return snapshot();
    },
    setMode(id, mode) {
      const tab = tabs.find((tab) => tab.id === id);
      if (tab) {
        tab.mode = mode;
      }
      return snapshot();
    },
    setRecentPaths(paths) {
      recentPaths.splice(0, recentPaths.length);
      paths
        .filter((path) => typeof path === "string" && !recentPaths.includes(path))
        .forEach((path) => recentPaths.push(path));
      return snapshot();
    },
    snapshot,
    switchTo(id) {
      if (tabs.some((tab) => tab.id === id)) {
        activeId = id;
      }
      return snapshot();
    },
    updateSource(id, source) {
      const tab = tabs.find((tab) => tab.id === id);
      if (tab) {
        tab.source = source;
        tab.dirty = source !== tab.savedSource;
      }
      return snapshot();
    }
  };
}
