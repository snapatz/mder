export function createTabStore() {
  let nextId = 1;
  let activeId = null;
  const tabs = [];
  const recentPaths = [];

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

      tabs.splice(index, 1);
      if (activeId === id) {
        activeId = tabs[index]?.id ?? tabs[index - 1]?.id ?? null;
      }
      return snapshot();
    },
    open(document) {
      const tab = {
        id: nextId++,
        path: document.path,
        title: document.path.split(/[\\/]/).pop() || document.path,
        html: document.html
      };
      tabs.push(tab);
      activeId = tab.id;
      remember(tab.path);
      return snapshot();
    },
    snapshot,
    switchTo(id) {
      if (tabs.some((tab) => tab.id === id)) {
        activeId = id;
      }
      return snapshot();
    }
  };
}
