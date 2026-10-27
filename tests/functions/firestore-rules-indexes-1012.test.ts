import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// #1012 — security rules + composite indexes for the canonical st-* roots.
// Content-level assertions on firestore.rules / firestore.indexes.json
// (same pattern as rh-agent-mcp-boundary.test.ts — no emulator needed).

const repoRootUrl = new URL("../../", import.meta.url);
const firestoreRulesUrl = new URL("firestore.rules", repoRootUrl);
const firestoreIndexesUrl = new URL("firestore.indexes.json", repoRootUrl);

interface IndexField {
  fieldPath: string;
  order?: string;
  arrayConfig?: string;
}
interface IndexEntry {
  collectionGroup: string;
  queryScope: string;
  fields: IndexField[];
}

const rules = readFileSync(firestoreRulesUrl, "utf-8");
const indexes = JSON.parse(readFileSync(firestoreIndexesUrl, "utf-8")) as {
  indexes: IndexEntry[];
};

/** Composite index exists with exactly these fields in this order, each
 *  carrying a non-default direction/config. Entries like `"symbol"` require
 *  ASCENDING; `"barDate:DESC"` or `"runIds:CONTAINS"` pin the direction. */
function hasIndex(collectionGroup: string, fields: string[]): boolean {
  const want = fields.map((f) => {
    const [fieldPath, dir] = f.split(":");
    return { fieldPath, dir: dir ?? "ASC" };
  });
  return indexes.indexes.some(
    (idx) =>
      idx.collectionGroup === collectionGroup &&
      idx.fields.length === want.length &&
      idx.fields.every((f, i) => {
        const actual = f.order ?? f.arrayConfig ?? "";
        return f.fieldPath === want[i].fieldPath && actual.startsWith(want[i].dir);
      }),
  );
}

/** A match block exists for the given path (literal `match /path`). */
function hasMatch(path: string): boolean {
  return rules.includes(`match /${path}`);
}

describe("firestore.rules — canonical st-* coverage (#1012)", () => {
  it("keeps the default-deny wildcard as the last rule", () => {
    const lastMatch = rules.lastIndexOf("match /{document=**}");
    assert.notEqual(lastMatch, -1, "default-deny wildcard missing");
    assert.match(rules.slice(lastMatch), /allow read, write: if false;/);
    // No match block may follow the catch-all.
    assert.equal(rules.indexOf("match /", lastMatch + 10), -1, "match block after default deny");
  });

  it("covers every canonical root exported by shared/st-collections.ts", () => {
    const expected = [
      "st-symbols",
      "st-signals",
      "st-runs",
      "st-order-tickets",
      "st-position-groups",
      "st-strategy-instances",
      "st-config",
      "st-symbol-lists",
      "st-backtest-runs",
      "st-backtest-permutations",
      "st-options-replay-runs",
      "st-options-contract-lists",
    ];
    for (const root of expected) {
      assert.ok(hasMatch(`${root}/{`), `missing match block for /${root}/`);
    }
    // Anchored roots — match via their items path / anchor doc.
    assert.ok(hasMatch("st-paper-trading/{anchor}/items/{docId}"), "missing st-paper-trading items rule");
    assert.ok(hasMatch("st-portfolio/{anchor}"), "missing st-portfolio anchor rule");
  });

  it("keeps backend-written roots read-only for clients", () => {
    // st-signals / st-runs(+jobs) / st-paper-trading / st-backtest-permutations
    // deny all client writes.
    const readOnly = [
      /match \/st-signals\/\{docId\}\s*\{\s*allow read: if request\.auth != null;\s*allow write: if false;/,
      /match \/st-paper-trading\/\{anchor\}\/items\/\{docId\}\s*\{\s*allow read: if request\.auth != null;\s*allow write: if false;/,
      /match \/st-backtest-permutations\/\{docId\}\s*\{\s*allow read: if request\.auth != null;\s*allow write: if false;/,
      /match \/st-options-replay-runs\/\{runId\}\s*\{\s*allow read: if request\.auth != null;\s*allow write: if false;/,
      /match \/st-options-contract-lists\/\{docId\}\s*\{\s*allow read: if request\.auth != null;\s*allow write: if false;/,
    ];
    for (const pattern of readOnly) {
      assert.match(rules, pattern);
    }
    // st-runs exposes the jobs subcollection read-only as well.
    assert.ok(hasMatch("st-runs/{runId}"), "missing st-runs match block");
    assert.match(rules, /match \/st-runs\/[\s\S]*?match \/jobs\/\{jobId\}/);
  });

  it("scopes user-owned roots by userId on create and update", () => {
    const userScoped = ["st-order-tickets", "st-strategy-instances", "st-symbol-lists"];
    for (const root of userScoped) {
      const block = rules.match(new RegExp(`match \\/${root}\\/\\{[^}]+\\} \\{[\\s\\S]*?\\n    \\}`));
      assert.ok(block, `no match block found for ${root}`);
      assert.match(block[0], /allow create: if request\.auth != null && request\.auth\.uid == request\.resource\.data\.userId/);
      assert.match(block[0], /allow update: if request\.auth != null && request\.auth\.uid == resource\.data\.userId/);
    }
    // Position groups are backend-written — user-scoped read only.
    const groups = rules.match(/match \/st-position-groups\/\{docId\} \{[\s\S]*?\}/);
    assert.ok(groups, "no st-position-groups block");
    assert.match(groups[0], /request\.auth\.uid == resource\.data\.userId/);
    assert.match(groups[0], /allow write: if false;/);
  });

  it("splits st-config singletons from per-user trading-config docs", () => {
    const block = rules.match(/match \/st-config\/\{docId\} \{[\s\S]*?\n    \}/);
    assert.ok(block, "no st-config block");
    assert.match(block[0], /docId in \['status', 'autoPaper'\]/);
    assert.match(block[0], /request\.auth\.uid == request\.resource\.data\.userId/);
  });

  it("allows authed CRUD on st-scanner proposals + latest-runs anchors only (#1254)", () => {
    const block = rules.match(/match \/st-scanner\/\{anchor\}\/items\/\{docId\} \{[\s\S]*?\n    \}/);
    assert.ok(block, "no st-scanner block");
    assert.match(block[0], /allow read: if request\.auth != null;/);
    assert.match(
      block[0],
      /allow create, update, delete: if anchor in \['proposals', 'latest-runs'\] && request\.auth != null;/,
    );
  });

  it("keeps the portfolio get/list split on the renamed st-portfolio root", () => {
    const block = rules.match(/match \/st-portfolio\/\{anchor\} \{[\s\S]*?\n    \}/);
    assert.ok(block, "no st-portfolio block");
    assert.match(block[0], /allow get: if/);
    assert.match(block[0], /allow list: if/);
    assert.match(block[0], /anchor == 'buckets' \|\| anchor == 'attributions'/);
  });
});

describe("firestore.indexes.json — canonical st-* coverage (#1012)", () => {
  it("indexes st-signals by marketDate/status", () => {
    assert.ok(hasIndex("st-signals", ["marketDate", "status"]), "missing st-signals (marketDate,status)");
  });

  it("carries the legacy signal-path index surface onto st-signals", () => {
    // Per-symbol timeline (was implicit under symbols/{sym}/signal-history).
    assert.ok(hasIndex("st-signals", ["symbol", "barDate:DESC"]), "missing st-signals (symbol,barDate DESC)");
    // Per-symbol marketDate range scans (was signal-history (date,symbol)).
    assert.ok(hasIndex("st-signals", ["symbol", "marketDate"]), "missing st-signals (symbol,marketDate)");
    // Mirrors the legacy `signals` collectionGroup (timeframe,marketDate).
    assert.ok(hasIndex("st-signals", ["timeframe", "marketDate:DESC"]), "missing st-signals (timeframe,marketDate DESC)");
    // Mirrors the legacy `run-ids` collectionGroup (runId,marketDate).
    assert.ok(hasIndex("st-signals", ["runIds:CONTAINS", "marketDate:DESC"]), "missing st-signals (runIds contains,marketDate DESC)");
  });

  it("indexes st-order-tickets by mode/state/origin refs", () => {
    assert.ok(hasIndex("st-order-tickets", ["mode", "state"]), "missing tickets (mode,state)");
    assert.ok(
      hasIndex("st-order-tickets", ["mode", "state", "origin.positionGroupId"]),
      "missing tickets (mode,state,origin.positionGroupId)",
    );
    assert.ok(hasIndex("st-order-tickets", ["userId", "state"]), "missing tickets (userId,state) for FE lists");
  });

  it("carries the occurrence-decisions fold-in index surface onto tickets", () => {
    // Decisions fold into tickets (#1017): decisions-by-run and
    // tickets-by-signal lineage lookups keep their userId scoping.
    assert.ok(hasIndex("st-order-tickets", ["userId", "origin.runId"]), "missing tickets (userId,origin.runId)");
    assert.ok(hasIndex("st-order-tickets", ["userId", "origin.signalId"]), "missing tickets (userId,origin.signalId)");
    assert.ok(hasIndex("st-order-tickets", ["userId", "terms.symbol"]), "missing tickets (userId,terms.symbol)");
  });

  it("indexes trades items by positionGroupId + contract fields", () => {
    assert.ok(
      hasIndex("items", ["positionGroupId", "expiration", "optionType", "strike"]),
      "missing items (positionGroupId,expiration,optionType,strike)",
    );
    // listTradesBySignal — signalId + source equality (live #1005 retry path).
    assert.ok(hasIndex("items", ["signalId", "source"]), "missing items (signalId,source)");
  });

  it("indexes st-position-groups for the user-scoped list view", () => {
    assert.ok(hasIndex("st-position-groups", ["userId", "createdAt:DESC"]), "missing groups (userId,createdAt DESC)");
  });

  it("mirrors the FE composite queries onto the renamed roots", () => {
    // signal.service: enabled==true AND createdAt>=cutoff.
    assert.ok(hasIndex("st-symbols", ["enabled", "createdAt"]), "missing st-symbols (enabled,createdAt)");
    // symbol-list view: userId==uid AND name ordering (mirrors legacy symbol-lists).
    assert.ok(hasIndex("st-symbol-lists", ["userId", "name"]), "missing st-symbol-lists (userId,name)");
    // backtest-run.service: runId==x orderBy completedAt desc.
    assert.ok(
      hasIndex("st-backtest-permutations", ["runId", "completedAt:DESC"]),
      "missing st-backtest-permutations (runId,completedAt DESC)",
    );
    // selection-replay detail view: per-run contract lists by symbol (#1276).
    assert.ok(
      hasIndex("st-options-contract-lists", ["runId", "symbol"]),
      "missing st-options-contract-lists (runId,symbol)",
    );
  });
});
