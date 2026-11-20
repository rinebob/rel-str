import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CANARY_STATUS_PATH,
  runCredentialCanary,
  type CanaryStatusDoc,
} from "../../../functions/src/paper-trading/engine/passes/rh-credential-canary";

const T0 = 1_800_000_000_000;

function makeDeps(over: {
  probeError?: unknown;
  written?: CanaryStatusDoc[];
}) {
  const written: CanaryStatusDoc[] = over.written ?? [];
  let ticks = 0;
  return {
    deps: {
      probe: async () => {
        if (over.probeError) throw over.probeError;
      },
      writeDoc: async (d: CanaryStatusDoc) => {
        written.push(d);
      },
      uid: 'test-uid',
      now: () => T0 + ticks++ * 250,
    },
    written,
  };
}

describe("runCredentialCanary", () => {
  it("successful probe → ok doc with latency, no error field", async () => {
    const { deps, written } = makeDeps({});
    const doc = await runCredentialCanary(deps);
    assert.equal(doc.state, "ok");
    assert.equal(doc.checkedAt, new Date(T0).toISOString());
    assert.equal(doc.latencyMs, 250);
    assert.equal(doc.error, undefined);
    assert.equal(doc.userId, 'test-uid'); // st-config per-user read rule
    assert.deepEqual(written, [doc]);
  });

  it("REAUTHORIZATION_REQUIRED message → reauth_required (alarm state)", async () => {
    const { deps, written } = makeDeps({
      probeError: new Error(
        "Failed to refresh stored Robinhood credential: REAUTHORIZATION_REQUIRED. Re-run the local OAuth bootstrap, then upload-rh-credential.",
      ),
    });
    const doc = await runCredentialCanary(deps);
    assert.equal(doc.state, "reauth_required");
    assert.match(doc.error!, /REAUTHORIZATION_REQUIRED/);
    assert.equal(written.length, 1);
  });

  it("MISCONFIGURED message → reauth_required (also alarm-worthy — user action)", async () => {
    const { deps } = makeDeps({
      probeError: new Error(
        "Failed to refresh stored Robinhood credential: MISCONFIGURED. Re-run the local OAuth bootstrap, then upload-rh-credential.",
      ),
    });
    const doc = await runCredentialCanary(deps);
    assert.equal(doc.state, "reauth_required");
  });

  it("missing credential → reauth_required — user-action failures must alarm", async () => {
    const { deps } = makeDeps({
      probeError: new Error(
        "No stored Robinhood credential. Run the local OAuth bootstrap, then upload-rh-credential.",
      ),
    });
    const doc = await runCredentialCanary(deps);
    assert.equal(doc.state, "reauth_required");
  });

  it("KMS-path persistent failures alarm by error name — misconfig is not transient (#1639)", async () => {
    // The KMS repo's deterministic misconfig surface: missing key name,
    // malformed doc, undecryptable payload. All need a human — a 'transient'
    // write would retry daily forever with no fail marker and no banner.
    for (const name of [
      "KmsUnavailableError",
      "MalformedCredentialDocError",
      "InvalidCredentialBundleError",
    ]) {
      const err = new Error("simulated persistent failure");
      err.name = name;
      const { deps } = makeDeps({ probeError: err });
      const doc = await runCredentialCanary(deps);
      assert.equal(doc.state, "reauth_required", name);
    }
  });

  it("gRPC config failures (revoked IAM / disabled key) alarm — not transient", async () => {
    for (const code of ["PERMISSION_DENIED", "FAILED_PRECONDITION"]) {
      const { deps } = makeDeps({
        probeError: new Error(`7 ${code}: caller lacks permission`),
      });
      const doc = await runCredentialCanary(deps);
      assert.equal(doc.state, "reauth_required", code);
    }
  });

  it("transient/network error → transient (no alarm)", async () => {
    for (const err of [
      new Error("Failed to refresh stored Robinhood credential: TEMPORARILY_UNAVAILABLE."),
      new Error("connect ECONNREFUSED 127.0.0.1"),
      "string failure",
    ]) {
      const { deps } = makeDeps({ probeError: err });
      const doc = await runCredentialCanary(deps);
      assert.equal(doc.state, "transient", String(err));
    }
  });

  it("a failing writeDoc still propagates — the doc write is the durability seam", async () => {
    const { deps } = makeDeps({ written: undefined });
    deps.writeDoc = async () => {
      throw new Error("firestore down");
    };
    await assert.rejects(runCredentialCanary(deps), /firestore down/);
  });

  it("status doc lives on st-config — rh-agent-credentials denies client reads", () => {
    assert.equal(CANARY_STATUS_PATH, "st-config/rhCredentialCanary");
  });
});
