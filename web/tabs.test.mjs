import assert from "node:assert/strict";
import { test } from "node:test";
import { createTabStore } from "./tabs.mjs";

test("opens, switches, and closes markdown tabs", () => {
  const tabs = createTabStore();
  const first = tabs.open({ path: "C:\\docs\\one.md", html: "<h1>One</h1>" }).activeId;
  const second = tabs.open({ path: "C:\\docs\\two.md", html: "<h1>Two</h1>" }).activeId;

  assert.equal(tabs.snapshot().tabs.length, 2);
  assert.equal(tabs.snapshot().activeTab.path, "C:\\docs\\two.md");

  tabs.switchTo(first);
  assert.equal(tabs.snapshot().activeTab.html, "<h1>One</h1>");

  tabs.close(first);
  assert.equal(tabs.snapshot().tabs.length, 1);
  assert.equal(tabs.snapshot().activeId, second);
  assert.deepEqual(tabs.snapshot().recentPaths, ["C:\\docs\\two.md", "C:\\docs\\one.md"]);
});
