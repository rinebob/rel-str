import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  CredentialRepositoryBusyError,
  CredentialRevisionConflictError,
  type RefreshLease,
  type RefreshLeasePort,
} from "../../functions/src/rh-agent-mcp/auth/credential-repository";
import type { RobinhoodCredentialBundle, RobinhoodCredentialRepository } from "../../functions/src/rh-agent-mcp/index";
import { RepositoryOAuthProvider } from "../../functions/src/rh-agent-mcp/auth/repository-oauth-provider";
import {
  refreshStoredCredential,
  StoredCredentialReauthorizationRequiredError,
} from "../../functions/src/rh-agent-mcp/auth/stored-credential-refresh";
import {
  EncryptedFileCredentialRepository,
} from "../../functions/src/rh-agent-mcp/auth/encrypted-file-credential-repository";
import {
  TransactionalCredentialDocumentBackend,
  type CredentialDocStore,
} from "../../functions/src/rh-agent-mcp/auth/kms-firestore-credential-repository";
import { createFileRefreshLease } from "../../functions/src/rh-agent-mcp/auth/file-refresh-lease";
import {
  sealLocalSourceIfCopied,
  StaleUploadError,
  uploadCredentialBundle,
} from "../../functions/src/rh-agent-mcp/auth/upload-credential-bundle";
import {
  InMemoryCredentialRepository,
  oauthResponse,
  storedCredential,
} from "./rh-agent-mcp-token-refresh-fixtures";

const NOW = new Date("2026-11-22T20:00:00.000Z");

function expiredBundle(refreshToken: string): RobinhoodCredentialBundle {
  return storedCredential({
    accessToken: `synthetic-access-${refreshToken}`,
    refreshToken,
    lastTokenResponseAt: "2026-11-22T18:00:00.000Z",
  });
}

/** Lease-capable in-memory repo — the D2 regression seam's repo side. */
class LeasableRepo extends InMemoryCredentialRepository {
  holder: string | null = null;
  acquireCalls = 0;
  readonly refreshLease: RefreshLeasePort = {
    currentRevision: async (): Promise<number | null> => this.current()?.revision ?? null,
    acquire: async (holderId: string): Promise<RefreshLease | null> => {
      this.acquireCalls += 1;
      if (this.holder !== null) {
        return null;
      }
      this.holder = holderId;
      return { holderId };
    },
    release: async (lease: RefreshLease): Promise<void> => {
      if (this.holder === lease.holderId) {
        this.holder = null;
      }
    },
  };
}

function providerFor(repository: RobinhoodCredentialRepository): RepositoryOAuthProvider {
  return new RepositoryOAuthProvider(repository, {
    redirectUrl: "http://127.0.0.1:0/callback",
    openAuthorizationUrl: async () => {
      throw new Error("browser must not open");
    },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("credential refresh lease (1658 — D2 regression seam)", () => {
  it("serializes two concurrent refreshes — the loser waits and adopts without POSTing", async () => {
    const repository = new LeasableRepo(expiredBundle("synthetic-rt-A"));
    const postBodies: string[] = [];
    const gate = deferred<Response>();
    const fetchFn = async (_input: string | URL | Request, init?: RequestInit) => {
      postBodies.push(String(init?.body ?? ""));
      return gate.promise;
    };

    const winner = refreshStoredCredential(providerFor(repository), {
      now: NOW,
      fetchFn,
      sleepFn: async () => undefined,
    });
    // Let the winner acquire the lease and reach the POST gate.
    await new Promise((r) => setImmediate(r));

    const loser = refreshStoredCredential(providerFor(repository), {
      now: NOW,
      fetchFn,
      leaseWaitMs: 2_000,
      leasePollMs: 1,
      // setImmediate yields a macrotask — a bare microtask sleep would starve
      // the event loop and the winner's gate.resolve would never run.
      sleepFn: () => new Promise((r) => setImmediate(r)),
    });
    await new Promise((r) => setImmediate(r));

    gate.resolve(oauthResponse({
      access_token: "synthetic-access-rotated",
      refresh_token: "synthetic-rt-B",
      expires_in: 7_200,
      token_type: "Bearer",
    }));

    const [winnerResult, loserResult] = await Promise.all([winner, loser]);

    assert.equal(postBodies.length, 1, "loser must never POST a stale refresh token");
    assert.ok(postBodies[0]!.includes("synthetic-rt-A"), "only the pre-rotation grant is presented");
    assert.equal(winnerResult.adoptedWinner, undefined);
    assert.equal(winnerResult.refreshTokenRotated, true);
    assert.equal(loserResult.adoptedWinner, true);
    assert.equal(repository.current()?.tokens?.refresh_token, "synthetic-rt-B");
  });

  it("adopts without POST when the grant rotated between caller's check and lease acquisition", async () => {
    const repository = new LeasableRepo(expiredBundle("synthetic-rt-A"));
    const provider = providerFor(repository);
    // Provider's cached baseline = rt-A — this is the grant the caller decided to refresh.
    await provider.tokens();
    // A concurrent instance rotated rt-A -> rt-B before we got the lease.
    await repository.store(
      { ...expiredBundle("synthetic-rt-B"), tokens: { access_token: "synthetic-access-B", refresh_token: "synthetic-rt-B", expires_in: 7_200, token_type: "Bearer" } },
      7,
    );
    let posts = 0;

    const result = await refreshStoredCredential(provider, {
      now: NOW,
      fetchFn: async () => {
        posts += 1;
        return oauthResponse({ access_token: "x", refresh_token: "y", expires_in: 1, token_type: "Bearer" });
      },
    });

    assert.equal(posts, 0);
    assert.equal(result.adoptedWinner, true);
    assert.equal((await provider.tokens())?.refresh_token, "synthetic-rt-B");
  });

  it("throws CredentialRepositoryBusyError when a live lease never produces a write", async () => {
    const repository = new LeasableRepo(expiredBundle("synthetic-rt-A"));
    await repository.refreshLease.acquire("someone-else", 60_000);
    const callsBeforeRefresh = repository.acquireCalls;

    await assert.rejects(
      refreshStoredCredential(providerFor(repository), {
        now: NOW,
        fetchFn: async () => {
          throw new Error("must not POST while the lease is foreign");
        },
        leaseWaitMs: 5,
        leasePollMs: 1,
        sleepFn: async () => undefined,
      }),
      (error: unknown) => error instanceof CredentialRepositoryBusyError,
    );
    assert.equal(repository.acquireCalls, callsBeforeRefresh + 2, "one acquire + one retry after the wait times out");
  });

  it("still throws StoredCredentialReauthorizationRequiredError when no grant exists", async () => {
    const repository = new LeasableRepo(null);
    await assert.rejects(
      refreshStoredCredential(providerFor(repository), { now: NOW }),
      (error: unknown) => error instanceof StoredCredentialReauthorizationRequiredError,
    );
  });

  it("non-capable repositories keep the legacy unguarded path", async () => {
    const repository = new InMemoryCredentialRepository(expiredBundle("synthetic-rt-A"));
    assert.equal((repository as RobinhoodCredentialRepository).refreshLease, undefined);
    let posts = 0;
    const result = await refreshStoredCredential(providerFor(repository), {
      now: NOW,
      fetchFn: async () => {
        posts += 1;
        return oauthResponse({
          access_token: "synthetic-access-rotated",
          refresh_token: "synthetic-rt-B",
          expires_in: 7_200,
          token_type: "Bearer",
        });
      },
    });
    assert.equal(posts, 1);
    assert.equal(result.refreshTokenRotated, true);
  });

  it("falls through to its own refresh when the waited-on bump did not rotate the rt", async () => {
    const repository = new LeasableRepo(expiredBundle("synthetic-rt-A"));
    await repository.refreshLease.acquire("foreign-nonrefresh", 60_000);
    let posts = 0;
    const result = await refreshStoredCredential(providerFor(repository), {
      now: NOW,
      fetchFn: async () => {
        posts += 1;
        return oauthResponse({
          access_token: "synthetic-access-rotated",
          refresh_token: "synthetic-rt-B",
          expires_in: 7_200,
          token_type: "Bearer",
        });
      },
      leaseWaitMs: 2_000,
      leasePollMs: 1,
      // First poll: the foreign holder lands a non-refresh write (revision
      // bumps, rt unchanged) and releases — the loser must not adopt.
      sleepFn: async () => {
        if (repository.holder === "foreign-nonrefresh") {
          const cur = repository.current()!;
          await repository.store(
            { ...cur, clientInformation: { client_id: "non-refresh-write" } },
            cur.revision,
          );
          await repository.refreshLease.release({ holderId: "foreign-nonrefresh" });
        }
      },
    });
    assert.equal(posts, 1, "a non-rotation bump is not adoptable — the loser refreshes itself");
    assert.equal(result.adoptedWinner, undefined);
    assert.equal(result.refreshTokenRotated, true);
    assert.equal(repository.current()?.tokens?.refresh_token, "synthetic-rt-B");
    assert.equal(repository.acquireCalls, 3, "setup acquire + one denied acquire + one retry acquire");
  });

  it("throws reauth-required when the waited-on winner's grant vanished (adopt-null)", async () => {
    const repository = new LeasableRepo(expiredBundle("synthetic-rt-A"));
    await repository.refreshLease.acquire("foreign-winner", 60_000);
    await assert.rejects(
      refreshStoredCredential(providerFor(repository), {
        now: NOW,
        fetchFn: async () => {
          throw new Error("must not POST — the grant is gone");
        },
        leaseWaitMs: 2_000,
        leasePollMs: 1,
        // First poll: the winner's write lands as a deletion — the revision
        // moved but reloadBundle finds nothing to adopt.
        sleepFn: async () => {
          if (repository.holder === "foreign-winner") {
            await repository.delete();
            await repository.refreshLease.release({ holderId: "foreign-winner" });
          }
        },
      }),
      (error: unknown) => error instanceof StoredCredentialReauthorizationRequiredError,
    );
  });
});

describe("KMS lease doc semantics (1658)", () => {
  function memoryDocStore(): CredentialDocStore & { peek(path: string): Record<string, unknown> | undefined } {
    const docs = new Map<string, Record<string, unknown>>();
    return {
      peek: (path) => docs.get(path),
      get: async (path) => ({
        exists: docs.has(path),
        data: () => docs.get(path),
      }),
      delete: async (path) => {
        docs.delete(path);
      },
      runTransaction: async (update) =>
        update({
          get: async (path) => ({
            exists: docs.has(path),
            data: () => docs.get(path),
          }),
          set: (path, data) => {
            docs.set(path, data);
          },
          delete: (path) => {
            docs.delete(path);
          },
        }),
    };
  }

  function backend() {
    return new TransactionalCredentialDocumentBackend(memoryDocStore());
  }

  it("grants the lease on an absent doc and denies it while live-held", async () => {
    const b = backend();
    const first = await b.acquire("holder-1", 60_000);
    assert.ok(first);
    assert.equal(first.holderId, "holder-1");
    assert.equal(await b.acquire("holder-2", 60_000), null);
  });

  it("denies a second holder while live-held, and grants it after release", async () => {
    const b = backend();
    await b.acquire("holder-1", 60_000);
    const second = await b.acquire("holder-2", 60_000);
    assert.equal(second, null, "live lease must deny a second holder");
    await b.release({ holderId: "holder-1" });
    assert.ok(await b.acquire("holder-2", 60_000), "released lease must be takeable");
  });

  it("release frees the lease; a mismatched holder cannot release it", async () => {
    const b = backend();
    const lease = await b.acquire("holder-1", 60_000);
    assert.ok(lease);
    await b.release({ holderId: "intruder" });
    assert.equal(await b.acquire("holder-2", 60_000), null, "intruder release must not free the lease");
    await b.release(lease);
    const next = await b.acquire("holder-2", 60_000);
    assert.ok(next);
  });

  it("expired TTL lets a new holder take over", async () => {
    const b = backend();
    await b.acquire("holder-1", -5_000); // expired past the skew grace when written
    const second = await b.acquire("holder-2", 60_000);
    assert.ok(second, "expired lease must be takeable");
  });

  it("does not report a lease when a txn retry finds a competing live holder", async () => {
    // Firestore re-invokes the update function when the read-set is
    // invalidated mid-transaction. If attempt 1 wrote the lease but attempt 2
    // sees someone else's live lease, acquire must return null — reporting
    // the lease would let two holders POST the same refresh token.
    const docs = new Map<string, Record<string, unknown>>();
    const LEASE = "rh-agent-credentials/refresh-lease";
    let invocations = 0;
    const store: CredentialDocStore = {
      get: async (path) => ({
        exists: docs.has(path),
        data: () => docs.get(path),
      }),
      delete: async (path) => {
        docs.delete(path);
      },
      runTransaction: async (update) => {
        const txn = {
          get: async (path: string) => ({
            exists: docs.has(path),
            data: () => docs.get(path),
          }),
          set: (path: string, data: Record<string, unknown>) => {
            docs.set(path, data);
          },
          delete: (path: string) => {
            docs.delete(path);
          },
        };
        let result = await update(txn);
        if (invocations === 0) {
          // Concurrent commit lands between attempts — inject a live foreign lease.
          docs.set(LEASE, { holderId: "rival", expiresAtEpochMs: Date.now() + 60_000 });
          result = await update(txn);
        }
        invocations += 1;
        return result;
      },
    };
    const b = new TransactionalCredentialDocumentBackend(store);
    const lease = await b.acquire("holder-1", 60_000);
    assert.equal(lease, null, "retry that sees a live rival must not claim the slot");
    assert.equal(docs.get(LEASE)?.["holderId"], "rival", "rival lease must survive");
  });

  it("currentRevision reads the doc revision without decrypting", async () => {
    const store = memoryDocStore();
    const b = new TransactionalCredentialDocumentBackend(store);
    assert.equal(await b.currentRevision(), null);
    await b.store("ciphertext-abc", 5, null);
    assert.equal(await b.currentRevision(), 5);
  });

  it("compare-and-delete conflicts when the doc revision moved under the caller (F3)", async () => {
    const store = memoryDocStore();
    const b = new TransactionalCredentialDocumentBackend(store);
    await b.store("ciphertext-abc", 5, null);
    await assert.rejects(b.delete(4), CredentialRevisionConflictError);
    assert.equal(await b.currentRevision(), 5, "conflicted delete leaves the doc intact");
    await b.delete(5);
    assert.equal(await b.currentRevision(), null);
  });
});

describe("file-repository refresh lease (1658)", () => {
  const passthroughCipher = {
    encrypt: async (p: string) => p,
    decrypt: async (c: string) => c,
  };

  async function withRepo<T>(fn: (repo: EncryptedFileCredentialRepository, dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), "rh-lease-"));
    try {
      const repo = new EncryptedFileCredentialRepository(join(dir, "credentials.dpapi"), passthroughCipher);
      return await fn(repo, dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("grants once, denies while held, frees on release", async () => {
    await withRepo(async (repo) => {
      const lease = await repo.refreshLease!.acquire("h1", 60_000);
      assert.ok(lease);
      assert.equal(await repo.refreshLease!.acquire("h2", 60_000), null);
      await repo.refreshLease!.release(lease);
      assert.ok(await repo.refreshLease!.acquire("h2", 60_000));
    });
  });

  it("takes over an expired refresh lease", async () => {
    await withRepo(async (repo) => {
      await repo.refreshLease!.acquire("h1", -1); // already expired when written
      const lease = await repo.refreshLease!.acquire("h2", 60_000);
      assert.ok(lease, "expired refresh lock must be takeable");
    });
  });

  it("store() still works while the refresh lease is held (separate locks — no deadlock)", async () => {
    await withRepo(async (repo) => {
      const lease = await repo.refreshLease!.acquire("h1", 60_000);
      assert.ok(lease);
      const stored = await repo.store(expiredBundle("synthetic-rt-A"), null);
      assert.equal(stored.revision, 1);
      await repo.refreshLease!.release(lease);
    });
  });
});

describe("file refresh lease — lock internals (1658)", () => {
  const lockFor = (dir: string): string => join(dir, "credentials.dpapi.refresh.lock");
  const markerFor = (dir: string): string => join(lockFor(dir), "holder");

  async function withDir<T>(fn: (dir: string, lease: ReturnType<typeof createFileRefreshLease>) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), "rh-lease-"));
    try {
      return await fn(dir, createFileRefreshLease(lockFor(dir), async () => null));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("writes the holder marker atomically as parseable JSON", async () => {
    await withDir(async (dir, lease) => {
      assert.ok(await lease.acquire("h1", 60_000));
      const marker = JSON.parse(await readFile(markerFor(dir), "utf8")) as {
        holderId: string;
        expiresAtEpochMs: number;
      };
      assert.equal(marker.holderId, "h1");
      assert.ok(marker.expiresAtEpochMs > Date.now());
    });
  });

  it("denies acquisition while a markerless lock dir is fresh (mid-acquire window)", async () => {
    await withDir(async (dir, lease) => {
      await mkdir(lockFor(dir), { recursive: true }); // crashed between mkdir and marker write
      assert.equal(await lease.acquire("h2", 60_000), null);
    });
  });

  it("takes over a markerless lock dir once it has gone stale", async () => {
    await withDir(async (dir, lease) => {
      await mkdir(lockFor(dir), { recursive: true });
      const past = new Date(Date.now() - 120_000);
      await utimes(lockFor(dir), past, past); // crash window closed
      assert.ok(await lease.acquire("h2", 60_000), "stale markerless dir must be takeable");
    });
  });

  it("takes over a corrupt marker and replaces it with a valid one", async () => {
    await withDir(async (dir, lease) => {
      await mkdir(lockFor(dir), { recursive: true });
      await writeFile(markerFor(dir), "garbage-not-json", "utf8");
      const won = await lease.acquire("h2", 60_000);
      assert.ok(won, "corrupt marker reads expired → takeover");
      const marker = JSON.parse(await readFile(markerFor(dir), "utf8")) as { holderId: string };
      assert.equal(marker.holderId, "h2");
    });
  });

  it("never produces two winners when racers take over an expired lock", async () => {
    await withDir(async (dir, lease) => {
      assert.ok(await lease.acquire("h1", -1)); // already expired
      // A racer can legitimately lose by error — a contender may rename
      // aside its half-built markerless dir mid-mkdir, so a writeMarker
      // ENOENT is a loss signal, not a fault. The invariant that matters
      // for grant safety: two live holders never emerge.
      const settle = (p: Promise<RefreshLease | null>) => p.catch(() => null);
      const [a, b] = await Promise.all([
        settle(lease.acquire("h2", 60_000)),
        settle(lease.acquire("h3", 60_000)),
      ]);
      assert.ok([a, b].filter((x) => x !== null).length <= 1, "at most one winner");
    });
  });

  it("release by a foreign holderId leaves the live lock intact", async () => {
    await withDir(async (_dir, lease) => {
      assert.ok(await lease.acquire("h1", 60_000));
      await lease.release({ holderId: "intruder" });
      assert.equal(await lease.acquire("h2", 60_000), null, "lock still held by h1");
    });
  });

  it("release is a no-op when the marker vanished — never deletes a lock dir it cannot attribute", async () => {
    await withDir(async (dir, lease) => {
      assert.ok(await lease.acquire("h1", 60_000));
      await rm(markerFor(dir)); // marker gone before release runs
      await lease.release({ holderId: "h1" });
      await stat(lockFor(dir)); // survives — a fresh foreign holder is not clobbered
    });
  });

  it("acquire restores the moved dir when its marker differs from what was observed", async () => {
    await withDir(async (dir) => {
      // A real expired lock must exist so acquire takes the EEXIST →
      // stale-takeover path; the injected reads then simulate a foreign
      // holder landing between the check and the rename-aside.
      const stale = createFileRefreshLease(lockFor(dir), async () => null);
      assert.ok(await stale.acquire("h1", -1));
      const lease = createFileRefreshLease(lockFor(dir), async () => null, {
        readMarker: async (d) =>
          d === lockFor(dir)
            ? { raw: "expired-marker", holderId: "h1", expiresAt: 0 }
            : { raw: "foreign-live-marker", holderId: "h-fresh", expiresAt: Date.now() + 60_000 },
      });
      assert.equal(await lease.acquire("h2", 60_000), null, "must not claim a swapped-out lock");
      await stat(lockFor(dir)); // restored to the live path, not stranded at .stale
    });
  });

  it("acquire restores the moved dir when the moved-marker read throws", async () => {
    await withDir(async (dir) => {
      const stale = createFileRefreshLease(lockFor(dir), async () => null);
      assert.ok(await stale.acquire("h1", -1));
      const lease = createFileRefreshLease(lockFor(dir), async () => null, {
        readMarker: async (d) => {
          if (d === lockFor(dir)) {
            return { raw: "expired-marker", holderId: "h1", expiresAt: 0 };
          }
          throw new Error("EPERM transient read failure");
        },
      });
      await assert.rejects(lease.acquire("h2", 60_000), /EPERM/);
      await stat(lockFor(dir)); // put back — not left stranded under a private name
    });
  });

  it("release restores the lock when the moved marker does not match what was attributed", async () => {
    await withDir(async (dir) => {
      const real = createFileRefreshLease(lockFor(dir), async () => null);
      assert.ok(await real.acquire("h1", 60_000));
      const realMarker = await readFile(markerFor(dir), "utf8");
      // Between the attribution read and the rename-aside the dir swapped
      // to a foreign holder — release must put it back, not rm it.
      const lease = createFileRefreshLease(lockFor(dir), async () => null, {
        readMarker: async (d) =>
          d === lockFor(dir)
            ? { raw: realMarker, holderId: "h1", expiresAt: Date.now() + 60_000 }
            : { raw: "foreign-marker", holderId: "h-x", expiresAt: Date.now() + 60_000 },
      });
      await lease.release({ holderId: "h1" });
      assert.equal(await readFile(markerFor(dir), "utf8"), realMarker, "foreign lock restored intact");
    });
  });

  it("release is a no-op on an expired marker — leaves it for the takeover path (F1)", async () => {
    await withDir(async (dir) => {
      const real = createFileRefreshLease(lockFor(dir), async () => null);
      assert.ok(await real.acquire("h1", -1), "seed an expired lock");
      await real.release({ holderId: "h1" });
      // An expired marker is takeover-bait — release must not move it
      // aside (a successor completing takeover in the gap would be
      // stranded). It survives intact for acquire's takeover path.
      await stat(markerFor(dir));
    });
  });

  it("acquire parks an un-restorable moved dir as .orphan when the live path is re-occupied (F2)", async () => {
    await withDir(async (dir) => {
      const stale = createFileRefreshLease(lockFor(dir), async () => null);
      assert.ok(await stale.acquire("h1", -1));
      // Observed read → expired; moved read → foreign (a fresh holder
      // landed) AND a third contender occupies lockPath so restore fails.
      const lease = createFileRefreshLease(lockFor(dir), async () => null, {
        readMarker: async (d) => {
          if (d === lockFor(dir)) {
            return { raw: "expired-marker", holderId: "h1", expiresAt: 0 };
          }
          await mkdir(lockFor(dir));
          await writeFile(markerFor(dir), "contender-live-marker", "utf8");
          return { raw: "fresh-foreign-marker", holderId: "h-fresh", expiresAt: Date.now() + 60_000 };
        },
      });
      assert.equal(await lease.acquire("h2", 60_000), null);
      const entries = await readdir(dir);
      assert.ok(entries.some((e) => e.endsWith(".orphan")), "un-restorable dir parked as .orphan");
      assert.equal(await readFile(markerFor(dir), "utf8"), "contender-live-marker");
    });
  });

  it("release parks an un-restorable moved dir as .orphan (F2)", async () => {
    await withDir(async (dir) => {
      const real = createFileRefreshLease(lockFor(dir), async () => null);
      assert.ok(await real.acquire("h1", 60_000));
      const realMarker = await readFile(markerFor(dir), "utf8");
      const lease = createFileRefreshLease(lockFor(dir), async () => null, {
        readMarker: async (d) => {
          if (d === lockFor(dir)) {
            return { raw: realMarker, holderId: "h1", expiresAt: Date.now() + 60_000 };
          }
          await mkdir(lockFor(dir));
          await writeFile(markerFor(dir), "contender-live-marker", "utf8");
          return { raw: "foreign-marker", holderId: "h-x", expiresAt: Date.now() + 60_000 };
        },
      });
      await lease.release({ holderId: "h1" });
      const entries = await readdir(dir);
      assert.ok(entries.some((e) => e.endsWith(".orphan")), "un-restorable dir parked as .orphan");
      assert.equal(await readFile(markerFor(dir), "utf8"), "contender-live-marker");
    });
  });

  it("restore retries once when the occupier frees the slot — lands the foreign marker intact", async () => {
    await withDir(async (dir) => {
      const stale = createFileRefreshLease(lockFor(dir), async () => null);
      assert.ok(await stale.acquire("h1", -1));
      const realMarker = await readFile(markerFor(dir), "utf8");
      const lease = createFileRefreshLease(lockFor(dir), async () => null, {
        readMarker: async (d) => {
          if (d === lockFor(dir)) {
            return { raw: "expired-marker", holderId: "h1", expiresAt: 0 };
          }
          // A blocker occupies lockPath for ~10ms — a mid-flight takeover
          // about to free the slot. The 50ms retry must land the restore.
          await mkdir(lockFor(dir));
          setTimeout(() => {
            void rm(lockFor(dir), { recursive: true, force: true });
          }, 10).unref();
          return { raw: "fresh-foreign-marker", holderId: "h-fresh", expiresAt: Date.now() + 60_000 };
        },
      });
      assert.equal(await lease.acquire("h2", 60_000), null);
      assert.equal(await readFile(markerFor(dir), "utf8"), realMarker, "foreign lock restored intact");
      assert.equal(
        (await readdir(dir)).some((e) => e.endsWith(".orphan")),
        false,
        "restored on the retry — not orphaned",
      );
    });
  });

  it("restore never destroys a contender's empty pre-marker dir (POSIX rename replaces empty dirs)", async () => {
    await withDir(async (dir) => {
      const stale = createFileRefreshLease(lockFor(dir), async () => null);
      assert.ok(await stale.acquire("h1", -1));
      const lease = createFileRefreshLease(lockFor(dir), async () => null, {
        readMarker: async (d) => {
          if (d === lockFor(dir)) {
            return { raw: "expired-marker", holderId: "h1", expiresAt: 0 };
          }
          // Contender's just-mkdir'd dir — pre-marker, empty. On POSIX a
          // blind restore rename would REPLACE it and the contender's
          // marker would then land inside our foreign dir → double-hold.
          await mkdir(lockFor(dir));
          return { raw: "fresh-foreign-marker", holderId: "h-fresh", expiresAt: Date.now() + 60_000 };
        },
      });
      assert.equal(await lease.acquire("h2", 60_000), null);
      assert.deepEqual(
        await readdir(lockFor(dir)),
        [],
        "the contender's empty dir must survive — its marker write belongs inside ITS dir",
      );
    });
  });
});

describe("sealLocalSourceIfCopied (1658 — D1 source seal)", () => {
  const uploaded = expiredBundle("synthetic-rt-shared");

  it("deletes the local store when it holds the same grant that was uploaded", async () => {
    const local = new InMemoryCredentialRepository(expiredBundle("synthetic-rt-shared"));
    const result = await sealLocalSourceIfCopied(local, uploaded);
    assert.equal(result.sealed, true);
    assert.equal(result.reason, "same_grant");
    assert.equal(await local.load(), null);
  });

  it("leaves an independent local grant untouched", async () => {
    const local = new InMemoryCredentialRepository(expiredBundle("synthetic-rt-local"));
    const result = await sealLocalSourceIfCopied(local, uploaded);
    assert.equal(result.sealed, false);
    assert.equal(result.reason, "independent_grant");
    assert.equal((await local.load())?.tokens?.refresh_token, "synthetic-rt-local");
  });

  it("warns when client IDs match but refresh tokens differ (ambiguous lineage)", async () => {
    // Both bundles carry the same synthetic client_id — an rt mismatch is
    // either an independent grant or a rotated lineage copy; the result
    // must surface the ambiguity.
    const local = new InMemoryCredentialRepository(expiredBundle("synthetic-rt-local"));
    const result = await sealLocalSourceIfCopied(local, uploaded);
    assert.equal(result.reason, "independent_grant");
    assert.match(result.warning ?? "", /client IDs match/);
    assert.equal(await local.load() !== null, true, "local store stays intact");
  });

  it("refuses to seal and flags stale_export when the local grant is newer than the uploaded copy", async () => {
    // Local refreshed AFTER the export was taken: the uploaded rt is dead
    // and the LOCAL copy holds the live grant — sealing it would orphan
    // the lineage entirely.
    const staleUploaded = storedCredential({
      accessToken: "synthetic-access-T1",
      refreshToken: "synthetic-rt-T1",
      lastTokenResponseAt: "2026-11-22T18:00:00.000Z",
    });
    const liveLocal = storedCredential({
      accessToken: "synthetic-access-T2",
      refreshToken: "synthetic-rt-T2",
      lastTokenResponseAt: "2026-11-22T19:00:00.000Z",
    });
    const local = new InMemoryCredentialRepository(liveLocal);
    const result = await sealLocalSourceIfCopied(local, staleUploaded);
    assert.equal(result.sealed, false, "must never delete the live copy");
    assert.equal(result.reason, "stale_export");
    assert.match(result.warning ?? "", /stale/);
    assert.equal((await local.load())?.tokens?.refresh_token, "synthetic-rt-T2");
  });

  it("throws busy when the local store is mid-refresh (seal fenced on the lease)", async () => {
    const local = new LeasableRepo(expiredBundle("synthetic-rt-shared"));
    await local.refreshLease.acquire("local-refresh-holder", 60_000);
    await assert.rejects(
      sealLocalSourceIfCopied(local, uploaded),
      (error: unknown) => error instanceof CredentialRepositoryBusyError,
    );
    assert.equal(await local.load() !== null, true, "local store untouched while mid-refresh");
  });

  it("reports no_source_grant when the local store is empty", async () => {
    const local = new InMemoryCredentialRepository(null);
    const result = await sealLocalSourceIfCopied(local, uploaded);
    assert.equal(result.sealed, false);
    assert.equal(result.reason, "no_source_grant");
  });

  it("flags rotated_during_seal when a zombie refresh resurrects the doc after the CAS delete (r5)", async () => {
    /** The delete committed — then the zombie's persisted rt-B lands before
     *  the seal's post-delete re-check. Reporting same_grant would claim
     *  "prod is the sole live copy" while prod holds dead rt-A and the
     *  resurrected local doc holds the only live copy. */
    class ResurrectingRepo extends InMemoryCredentialRepository {
      override async delete(expectedRevision?: number): Promise<void> {
        await super.delete(expectedRevision);
        const resurrected = expiredBundle("synthetic-rt-B");
        await this.store(resurrected, null); // the zombie's store lands
      }
    }
    const local = new ResurrectingRepo(expiredBundle("synthetic-rt-shared"));
    const result = await sealLocalSourceIfCopied(local, uploaded);
    assert.equal(result.sealed, false, "the resurrect must surface, not report sealed");
    assert.equal(result.reason, "rotated_during_seal");
    assert.match(result.warning ?? "", /resurrected/);
    assert.equal((await local.load())?.tokens?.refresh_token, "synthetic-rt-B");
  });

  it("refuses to seal when the local grant rotated under the seal — CAS-delete (F3)", async () => {
    /** A lease-expired zombie refresh lands its rotated rt between the
     *  seal's load() and delete() — the compare-and-delete must abort
     *  rather than remove the only live copy. */
    class ZombieRepo extends InMemoryCredentialRepository {
      private bumped = false;
      override async delete(expectedRevision?: number): Promise<void> {
        if (!this.bumped) {
          this.bumped = true;
          const cur = this.current()!;
          await super.store(
            {
              ...cur,
              tokens: { ...cur.tokens!, refresh_token: "synthetic-rt-B" },
            },
            cur.revision,
          );
        }
        return super.delete(expectedRevision);
      }
    }
    const local = new ZombieRepo(expiredBundle("synthetic-rt-shared"));
    const result = await sealLocalSourceIfCopied(local, uploaded);
    assert.equal(result.sealed, false, "must not delete the just-rotated live copy");
    assert.equal(result.reason, "rotated_during_seal");
    assert.match(result.warning ?? "", /rotated while the seal/);
    assert.equal(local.current()?.tokens?.refresh_token, "synthetic-rt-B");
  });
});

describe("persistTokens CAS-conflict retry (1658 — M4)", () => {
  /** A non-refresh writer lands between the refresh winner's load and its
   *  token store — bumps the revision while carrying the stale rt forward. */
  class InterposingRepo extends LeasableRepo {
    private interposed = false;
    override async store(
      credential: RobinhoodCredentialBundle,
      expectedRevision: number | null,
    ): Promise<RobinhoodCredentialBundle> {
      if (!this.interposed && this.current() !== null) {
        this.interposed = true;
        const current = this.current()!;
        await super.store(
          { ...current, clientInformation: { client_id: "interposer-write" } },
          current.revision,
        );
        throw new CredentialRevisionConflictError();
      }
      return super.store(credential, expectedRevision);
    }
  }

  it("retries the token write once — the rotated rt is saved, not dropped with the conflict", async () => {
    const repository = new InterposingRepo(expiredBundle("synthetic-rt-A"));
    let posts = 0;
    const result = await refreshStoredCredential(providerFor(repository), {
      now: NOW,
      fetchFn: async () => {
        posts += 1;
        return oauthResponse({
          access_token: "synthetic-access-rotated",
          refresh_token: "synthetic-rt-B",
          expires_in: 7_200,
          token_type: "Bearer",
        });
      },
    });
    assert.equal(posts, 1);
    assert.equal(result.refreshTokenRotated, true);
    const stored = await repository.load();
    assert.equal(
      stored?.tokens?.refresh_token,
      "synthetic-rt-B",
      "the retry must persist the rotated rt — dropping it leaves a dead rt stored",
    );
    assert.equal(
      stored?.clientInformation?.client_id,
      "interposer-write",
      "the interposer's non-refresh write survives the retry",
    );
  });

  /** The interposer ROTATED the grant — deployment-skew unguarded refresh
   *  or upload --replace landing rt-C. Our minted rt-B is dead. */
  class RotatingInterposer extends LeasableRepo {
    private interposed = false;
    override async store(
      credential: RobinhoodCredentialBundle,
      expectedRevision: number | null,
    ): Promise<RobinhoodCredentialBundle> {
      if (!this.interposed && this.current() !== null) {
        this.interposed = true;
        const current = this.current()!;
        await super.store(
          {
            ...current,
            tokens: { ...current.tokens!, refresh_token: "synthetic-rt-C" },
            clientInformation: { client_id: "winner-client" },
          },
          current.revision,
        );
        throw new CredentialRevisionConflictError();
      }
      return super.store(credential, expectedRevision);
    }
  }

  it("adopts when the interposer rotated — never stamps dead rt-B over live rt-C (F4a)", async () => {
    const repository = new RotatingInterposer(expiredBundle("synthetic-rt-A"));
    const result = await refreshStoredCredential(providerFor(repository), {
      now: NOW,
      fetchFn: async () =>
        oauthResponse({
          access_token: "synthetic-access-rotated",
          refresh_token: "synthetic-rt-B",
          expires_in: 7_200,
          token_type: "Bearer",
        }),
    });
    assert.equal(result.refreshTokenRotated, true);
    assert.equal(
      repository.current()?.tokens?.refresh_token,
      "synthetic-rt-C",
      "the interposer's live grant wins — storing rt-B would replay a dead position",
    );
  });

  /** Repeated non-refresh conflicts — each bump keeps rt-A, so the retry
   *  is safe; the loop must stay bounded. */
  class CountingInterposer extends LeasableRepo {
    storeCalls = 0;
    bumpsLeft = 0;
    override async store(
      credential: RobinhoodCredentialBundle,
      expectedRevision: number | null,
    ): Promise<RobinhoodCredentialBundle> {
      this.storeCalls += 1;
      if (this.bumpsLeft-- > 0 && this.current() !== null) {
        const cur = this.current()!;
        await super.store({ ...cur, clientInformation: { client_id: "bump" } }, cur.revision);
        throw new CredentialRevisionConflictError();
      }
      return super.store(credential, expectedRevision);
    }
  }

  it("retries across two consecutive conflicts, then persists rt-B (F4b)", async () => {
    const repository = new CountingInterposer(expiredBundle("synthetic-rt-A"));
    repository.bumpsLeft = 2;
    const result = await refreshStoredCredential(providerFor(repository), {
      now: NOW,
      fetchFn: async () =>
        oauthResponse({
          access_token: "synthetic-access-rotated",
          refresh_token: "synthetic-rt-B",
          expires_in: 7_200,
          token_type: "Bearer",
        }),
    });
    assert.equal(result.refreshTokenRotated, true);
    assert.equal(repository.current()?.tokens?.refresh_token, "synthetic-rt-B");
    assert.equal(repository.storeCalls, 3, "two conflicted attempts + one success");
  });

  it("propagates the conflict after the bounded retry budget is exhausted", async () => {
    class AlwaysInterposer extends LeasableRepo {
      storeCalls = 0;
      override async store(): Promise<RobinhoodCredentialBundle> {
        this.storeCalls += 1;
        const cur = this.current();
        if (cur) {
          await super.store({ ...cur }, cur.revision); // non-refresh bump, rt unchanged
        }
        throw new CredentialRevisionConflictError();
      }
    }
    const repository = new AlwaysInterposer(expiredBundle("synthetic-rt-A"));
    await assert.rejects(
      refreshStoredCredential(providerFor(repository), {
        now: NOW,
        fetchFn: async () =>
          oauthResponse({
            access_token: "synthetic-access-rotated",
            refresh_token: "synthetic-rt-B",
            expires_in: 7_200,
            token_type: "Bearer",
          }),
      }),
      CredentialRevisionConflictError,
    );
    assert.equal(repository.storeCalls, 3, "the retry budget is three attempts, not a loop");
  });

  /** The interposer DELETED the doc — e.g. a lease-expired zombie refresh
   *  racing the upload-seal's CAS delete. Nothing exists to adopt; the
   *  minted rt-B is the only live copy of the lineage — dropping it on a
   *  null reload is total grant death on both sides. */
  class DeletingInterposer extends LeasableRepo {
    private interposed = false;
    override async store(
      credential: RobinhoodCredentialBundle,
      expectedRevision: number | null,
    ): Promise<RobinhoodCredentialBundle> {
      if (!this.interposed && this.current() !== null) {
        this.interposed = true;
        await this.delete(this.current()!.revision); // the seal wins mid-POST
        throw new CredentialRevisionConflictError();
      }
      return super.store(credential, expectedRevision);
    }
  }

  it("resurrects when the interposer deleted the doc — minted rt-B is the only live copy (r4)", async () => {
    const repository = new DeletingInterposer(expiredBundle("synthetic-rt-A"));
    const result = await refreshStoredCredential(providerFor(repository), {
      now: NOW,
      fetchFn: async () =>
        oauthResponse({
          access_token: "synthetic-access-rotated",
          refresh_token: "synthetic-rt-B",
          expires_in: 7_200,
          token_type: "Bearer",
        }),
    });
    assert.equal(result.refreshTokenRotated, true);
    const resurrected = repository.current();
    assert.equal(
      resurrected?.tokens?.refresh_token,
      "synthetic-rt-B",
      "the only live copy must be resurrected — adopt-on-null drops it forever",
    );
    assert.equal(
      resurrected?.clientInformation?.client_id,
      "synthetic-client",
      "the resurrect must carry the baseline's auth fields — a tokens-only doc can never self-refresh",
    );
  });

  it("clears pending fields on adopt — pending must not shadow the adopted grant", async () => {
    const repository = new RotatingInterposer(expiredBundle("synthetic-rt-A"));
    const provider = providerFor(repository);
    // prepareForAuthorization snapshots bundle fields into pending and
    // clears the cache — pending now shadows the OLD baseline's
    // clientInformation ("synthetic-client").
    await provider.prepareForAuthorization();
    await provider.saveTokens({
      access_token: "synthetic-access-minted",
      refresh_token: "synthetic-rt-B",
      expires_in: 7_200,
      token_type: "Bearer",
    });
    assert.equal(
      (await provider.clientInformation())?.client_id,
      "winner-client",
      "the adopted grant is authoritative — a stale pending client_id would poison the next authorize",
    );
  });
});

describe("uploadCredentialBundle replace freshness guard (1658 — M3)", () => {
  const liveProd = storedCredential({
    accessToken: "synthetic-access-live",
    refreshToken: "synthetic-rt-live",
    lastTokenResponseAt: "2026-11-22T19:00:00.000Z",
  });
  const staleExport = storedCredential({
    accessToken: "synthetic-access-stale",
    refreshToken: "synthetic-rt-dead",
    lastTokenResponseAt: "2026-11-22T18:00:00.000Z",
  });

  it("refuses to overwrite a newer stored grant with a stale export", async () => {
    const repository = new InMemoryCredentialRepository(liveProd);
    await assert.rejects(
      uploadCredentialBundle(repository, staleExport, { replace: true }),
      (error: unknown) => error instanceof StaleUploadError,
    );
    assert.equal(repository.current()?.tokens?.refresh_token, "synthetic-rt-live");
  });

  it("force overrides the freshness guard for a deliberate downgrade", async () => {
    const repository = new InMemoryCredentialRepository(liveProd);
    const evidence = await uploadCredentialBundle(repository, staleExport, {
      replace: true,
      force: true,
    });
    assert.equal(evidence.mode, "replace");
    assert.equal(repository.current()?.tokens?.refresh_token, "synthetic-rt-dead");
  });

  it("refuses when the STORED stamp is undatable — fail-closed on both sides (F5)", async () => {
    const undatable = storedCredential({
      accessToken: "synthetic-access-live",
      refreshToken: "synthetic-rt-live",
      lastTokenResponseAt: "2026-11-22T19:00:00.000Z",
    });
    delete undatable.lastTokenResponseAt; // pre-field bundle — stamp absent
    const repository = new InMemoryCredentialRepository(undatable);
    await assert.rejects(
      uploadCredentialBundle(repository, staleExport, { replace: true }),
      (error: unknown) => error instanceof StaleUploadError,
    );
    assert.equal(repository.current()?.tokens?.refresh_token, "synthetic-rt-live");
  });

  it("force overrides an undatable stored stamp too — the downgrade is always explicit", async () => {
    const undatable = storedCredential({
      accessToken: "synthetic-access-live",
      refreshToken: "synthetic-rt-live",
      lastTokenResponseAt: "2026-11-22T19:00:00.000Z",
    });
    delete undatable.lastTokenResponseAt;
    const repository = new InMemoryCredentialRepository(undatable);
    const evidence = await uploadCredentialBundle(repository, staleExport, {
      replace: true,
      force: true,
    });
    assert.equal(evidence.mode, "replace");
    assert.equal(repository.current()?.tokens?.refresh_token, "synthetic-rt-dead");
  });
});
