import assert from "node:assert/strict";
import { test } from "node:test";
import { createTabStore } from "./tabs.mjs";

test("opens, switches, and closes markdown tabs", () => {
  const tabs = createTabStore();
  const first = tabs.open({
    path: "C:\\docs\\one.md",
    html: "<h1>One</h1>",
    source: "# One"
  }).activeId;
  const second = tabs.open({
    path: "C:\\docs\\two.md",
    html: "<h1>Two</h1>",
    source: "# Two"
  }).activeId;

  assert.equal(tabs.snapshot().tabs.length, 2);
  assert.equal(tabs.snapshot().activeTab.path, "C:\\docs\\two.md");

  tabs.switchTo(first);
  assert.equal(tabs.snapshot().activeTab.html, "<h1>One</h1>");

  tabs.close(first);
  assert.equal(tabs.snapshot().tabs.length, 1);
  assert.equal(tabs.snapshot().activeId, second);
  assert.deepEqual(tabs.snapshot().recentPaths, ["C:\\docs\\two.md", "C:\\docs\\one.md"]);
});

test("tracks dirty edits and blocks dirty close until forced or saved", () => {
  const tabs = createTabStore();
  const id = tabs.open({ path: "C:\\docs\\one.md", html: "<h1>One</h1>", source: "# One" }).activeId;

  tabs.setMode(id, "edit");
  tabs.updateSource(id, "# One\n\nEdited.");
  assert.equal(tabs.snapshot().activeTab.dirty, true);
  assert.equal(tabs.close(id).blockedCloseId, id);
  assert.equal(tabs.snapshot().tabs.length, 1);

  tabs.markSaved(id, {
    path: "C:\\docs\\one.md",
    html: "<h1>One</h1><p>Edited.</p>",
    source: "# One\n\nEdited."
  });
  assert.equal(tabs.snapshot().activeTab.dirty, false);
  tabs.close(id);
  assert.equal(tabs.snapshot().tabs.length, 0);
});

test("preserves dirty source while switching viewer editor and dual pane modes", () => {
  const tabs = createTabStore();
  const id = tabs.open({ path: "C:\\docs\\one.md", html: "<h1>One</h1>", source: "# One" }).activeId;

  tabs.setMode(id, "edit");
  tabs.updateSource(id, "# One\n\nChanged.");
  tabs.setMode(id, "dual");
  tabs.setMode(id, "view");

  assert.equal(tabs.snapshot().activeTab.mode, "view");
  assert.equal(tabs.snapshot().activeTab.source, "# One\n\nChanged.");
  assert.equal(tabs.snapshot().activeTab.dirty, true);
});
