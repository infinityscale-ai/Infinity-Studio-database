import test from "node:test";
import assert from "node:assert/strict";

import {
  SETTINGS_SEARCH_INDEX,
  filterSettingsSearch,
} from "../../../components/studio/settings/settings-search";

test("filterSettingsSearch returns empty list for blank query", () => {
  assert.deepEqual(filterSettingsSearch(""), []);
  assert.deepEqual(filterSettingsSearch("   "), []);
});

test("filterSettingsSearch matches titles case-insensitively", () => {
  const ids = filterSettingsSearch("VIM").map((e) => e.id);
  assert.ok(ids.includes("vim-mode"));
});

test("filterSettingsSearch matches keywords and descriptions", () => {
  const ids = filterSettingsSearch("zebra").map((e) => e.id);
  assert.ok(ids.includes("alternating-rows"));
});

test("filterSettingsSearch requires every token to match", () => {
  const ids = filterSettingsSearch("sql tabs").map((e) => e.id);
  assert.ok(ids.includes("sql-use-tabs"));
  assert.ok(!ids.includes("sql-tab-width"));
});

test("filterSettingsSearch matches section names", () => {
  const ids = filterSettingsSearch("security").map((e) => e.id);
  const securityIds = SETTINGS_SEARCH_INDEX.filter((e) => e.section === "security").map((e) => e.id);
  assert.ok(securityIds.length > 0);
  for (const id of securityIds) assert.ok(ids.includes(id), id);
});

test("SETTINGS_SEARCH_INDEX has unique ids", () => {
  const ids = SETTINGS_SEARCH_INDEX.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});
