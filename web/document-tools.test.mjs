import assert from "node:assert/strict";
import { test } from "node:test";
import { findMatches, nextMatchIndex, scrollRatio, scrollTopForRatio } from "./document-tools.mjs";

test("finds plain text matches case-insensitively", () => {
  assert.deepEqual(findMatches("Alpha beta alpha", "ALPHA"), [
    { from: 0, to: 5 },
    { from: 11, to: 16 }
  ]);
  assert.deepEqual(findMatches("abc", ""), []);
});

test("moves between find matches with wraparound", () => {
  assert.equal(nextMatchIndex(3, -1, 1), 0);
  assert.equal(nextMatchIndex(3, 2, 1), 0);
  assert.equal(nextMatchIndex(3, 0, -1), 2);
  assert.equal(nextMatchIndex(0, 0, 1), -1);
});

test("maps scroll positions by approximate document ratio", () => {
  assert.equal(scrollRatio(50, 300, 100), 0.25);
  assert.equal(scrollTopForRatio(500, 100, 0.25), 100);
  assert.equal(scrollRatio(0, 100, 100), 0);
});
