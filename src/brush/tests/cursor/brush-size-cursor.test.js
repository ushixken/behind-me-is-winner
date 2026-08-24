"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const src = fs.readFileSync(
  path.join(__dirname, "..", "..", "brush-size-cursor.js"),
  "utf8",
);

test("brush cursor consumes high-rate raw pointer input", () => {
  assert.match(src, /addEventListener\("pointerrawupdate",\s*track,\s*true\)/);
});

test("pen raw cursor path uses newest coalesced sample immediately", () => {
  assert.match(src, /function newestCoalescedPositionEvent\(event\)/);
  assert.match(src, /event\.getCoalescedEvents\(\)/);
  assert.match(src, /return events\[events\.length - 1\] \|\| event/);
  assert.match(src, /function shouldUseImmediatePenPosition\(event\)/);
  assert.match(src, /event\.pointerType !== "pen"/);
  assert.match(src, /event\.type === "pointerrawupdate"/);
  assert.match(src, /setImmediateRawPosition\(\)/);
});

test("pen raw cursor path bypasses spike filter and stale pointermove overwrite", () => {
  const immediateStart = src.indexOf("function setImmediateRawPosition()");
  const immediateEnd = src.indexOf("\n  function prepare", immediateStart);
  const immediate = src.slice(immediateStart, immediateEnd);
  assert.doesNotMatch(immediate, /filteredPosition\(/);
  assert.match(immediate, /suspectX = null/);
  assert.match(immediate, /applyCursorPosition\(renderX, renderY, true/);
  assert.match(src, /skipStalePenMovePosition/);
  assert.match(src, /performance\.now\(\) - lastPenRawWallTime < 50/);
});

test("production cursor positioning remains simple left/top", () => {
  assert.doesNotMatch(src, /BrushCursorDebugCompositorPosition/);
  assert.doesNotMatch(src, /BrushCursorDebugImmediateRawPosition/);
  assert.match(src, /function applyCursorPosition\(x, y, immediate, eventTime\)/);
  assert.match(src, /cursorCanvas\.style\.left = x \+ "px"/);
  assert.match(src, /cursorCanvas\.style\.top = y \+ "px"/);
  assert.match(src, /styleMode: "leftTop"/);
});

test("pen pointermove fallback remains available when raw input is absent", () => {
  const start = src.indexOf("function shouldUseImmediatePenPosition(event)");
  const end = src.indexOf("\n  function prepare", start);
  const body = src.slice(start, end);
  assert.match(body, /event\.type === "pointerrawupdate"/);
  assert.match(body, /event\.type !== "pointermove"/);
  assert.match(body, /return false/);
  assert.match(body, /return true/);
});

test("raw events still schedule RAF for redraw and visibility work", () => {
  assert.match(src, /if \(!cursorRaf\)\s*cursorRaf = requestAnimationFrame/);
  assert.match(src, /cursorRaf = 0;\s*update\(false, frameTime\)/);
});

test("all four custom paint cursor renderers draw the white center point", () => {
  assert.match(src, /function drawCenterDot\(c\)/);
  assert.match(src, /fillStyle = "#ffffff"/);
  for (const name of ["drawPoint", "drawCross", "drawCircle", "drawShape"]) {
    const start = src.indexOf("function " + name + "("),
      next = src.indexOf("\n  function ", start + 10);
    assert.match(
      src.slice(start, next < 0 ? src.length : next),
      /drawCenterDot\(c\)/,
      name,
    );
  }
});
