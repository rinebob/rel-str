import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const repoRootUrl = new URL("../../", import.meta.url);
const functionsGitignoreUrl = new URL("functions/.gitignore", repoRootUrl);
const functionsPackageUrl = new URL("functions/package.json", repoRootUrl);
const functionsEntrypointUrl = new URL("functions/src/index.ts", repoRootUrl);
const functionsBundleUrl = new URL("functions/lib/index.js", repoRootUrl);
const firestoreRulesUrl = new URL("firestore.rules", repoRootUrl);
const firestoreIndexesUrl = new URL("firestore.indexes.json", repoRootUrl);
const collectionConstantsUrl = new URL("src/app/core/common/constants.ts", repoRootUrl);
const sourceArchiveUrl = new URL(
  "docs/implementations/RH-AGENT-LEGACY-CLAUDE-BRIDGE-SOURCE-ARCHIVE-2607-01.md",
  repoRootUrl,
);
const sourceArchiveSha256 = "a00475631a67969220080f8d7b3a495cea219925d1652677ba10c5164ea5bae2";
const retiredImplementationUrls = [
  new URL("functions/src/rh-agent", repoRootUrl),
  new URL("functions/src/rh-agent-cloud-function/rh-agent-executor.ts", repoRootUrl),
  new URL("functions/lib/rh-agent", repoRootUrl),
  new URL("src/app/features/rh-agent/services/trade-bridge-client.service.ts", repoRootUrl),
  new URL("src/app/features/rh-agent/services/trade-bridge-client.service.spec.ts", repoRootUrl),
  new URL("src/app/features/rh-agent/components/execution-panel", repoRootUrl),
  new URL("src/app/features/rs", repoRootUrl),
];
const retiredRuntimeMarkers = [
  "rhExecuteTrade",
  "rhGetAccountSummary",
  "rh-agent-executor",
  "ANTHROPIC_API_KEY",
  "Trade Bridge Server",
  "Claude Code",
];

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\n$/, "");
}

describe("RH Agent MCP deployment boundary", () => {
  it("keeps the archived legacy implementation out of source and generated output", () => {
    for (const implementationUrl of retiredImplementationUrls) {
      assert.equal(existsSync(implementationUrl), false);
    }

    const entrypoint = readFileSync(functionsEntrypointUrl, "utf-8");
    for (const marker of retiredRuntimeMarkers) {
      assert.equal(entrypoint.includes(marker), false, `Functions entrypoint contains retired marker: ${marker}`);
    }

    if (existsSync(functionsBundleUrl)) {
      const bundle = readFileSync(functionsBundleUrl, "utf-8");
      for (const marker of retiredRuntimeMarkers) {
        assert.equal(bundle.includes(marker), false, `Functions bundle contains retired marker: ${marker}`);
      }
    }
  });

  it("removes the retired client-writable trade persistence surface", () => {
    const firestoreRules = readFileSync(firestoreRulesUrl, "utf-8");
    const firestoreIndexes = readFileSync(firestoreIndexesUrl, "utf-8");
    const collectionConstants = readFileSync(collectionConstantsUrl, "utf-8");

    assert.equal(firestoreRules.includes("rh-agent-trades"), false);
    assert.doesNotMatch(firestoreRules, /match\s+\/\{path=\*\*\}\/trades\/\{tradeId\}/);
    assert.equal(firestoreIndexes.includes('"collectionGroup": "trades"'), false);
    assert.equal(collectionConstants.includes("RH_TRADES"), false);
  });

  it("keeps both source archive snapshots byte-exact", () => {
    const archive = normalizeText(readFileSync(sourceArchiveUrl, "utf-8"));
    const sectionPattern = /^## `([^`]+)`\n\n```[^\n]*\n([\s\S]*?)\n```$/gm;
    const sections: { reference: string; source: string }[] = [];
    let match: RegExpExecArray | null;

    while ((match = sectionPattern.exec(archive)) !== null) {
      sections.push({ reference: match[1], source: match[2] });
    }

    assert.equal(sections.filter(({ reference }) => !reference.startsWith("44b9ca3:")).length, 24);
    assert.equal(sections.filter(({ reference }) => reference.startsWith("44b9ca3:")).length, 22);
    assert.equal(createHash("sha256").update(JSON.stringify(sections)).digest("hex"), sourceArchiveSha256);
  });

  it("cleans generated Functions output before every build", () => {
    const packageJson = JSON.parse(readFileSync(functionsPackageUrl, "utf-8")) as {
      scripts?: Record<string, string>;
    };

    assert.equal(packageJson.scripts?.prebuild, "npm run clean");
    assert.match(packageJson.scripts?.clean ?? "", /rmSync\('lib'/);
  });

  it("keeps known legacy OAuth credential artifacts ignored", () => {
    const rules = new Set(readFileSync(functionsGitignoreUrl, "utf-8")
      .split(/\r?\n/)
      .map((rule) => rule.trim()));

    assert.equal(rules.has(".rh-tokens.json"), true);
    assert.equal(rules.has("auth-url.txt"), true);
  });
});
