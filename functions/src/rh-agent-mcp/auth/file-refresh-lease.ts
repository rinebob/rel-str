/**
 * Shared file-based RefreshLeasePort for the local credential file repos —
 * serializes the refresh POST across processes on one machine (issue #1658).
 * Distinct from each repo's store() lock so refresh can hold it across a
 * CAS write.
 *
 * Bounded guarantee: the slot is TTL'd, not fenced — a holder whose
 * critical section outlives its TTL can be taken over while its POST is
 * still in flight. The TTL must comfortably exceed load→POST→write.
 *
 * Marker: `{lockPath}/holder` — a JSON doc written atomically (temp +
 * rename) so a contender never reads a truncated marker. Takeover moves the
 * whole lock dir aside and only deletes it after re-reading the moved
 * marker confirms it's the same stale state we observed; a mismatch means
 * a fresh holder appeared between check and rename, so it's put back.
 */
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RefreshLease, RefreshLeasePort } from './credential-repository';

interface MarkerDoc {
  holderId: string;
  expiresAtEpochMs: number;
}

export interface FileLeaseMarker {
  /** Raw file content — the identity compared across the rename. */
  raw: string;
  holderId: string | null;
  expiresAt: number;
}

export interface FileRefreshLeaseDeps {
  /** Test seam — inject marker reads to simulate transient fs faults or
   *  foreign writes landing mid-takeover/release. */
  readMarker?: (dir: string) => Promise<FileLeaseMarker | null>;
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

export function createFileRefreshLease(
  lockPath: string,
  currentRevision: () => Promise<number | null>,
  deps: FileRefreshLeaseDeps = {},
): RefreshLeasePort {
  const markerPath = (dir: string): string => `${dir}/holder`;

  const defaultReadMarker = async (dir: string): Promise<FileLeaseMarker | null> => {
    let raw: string;
    try {
      raw = await readFile(markerPath(dir), 'utf8');
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) {
        return null;
      }
      throw error; // EPERM etc. is a real failure, not contention
    }
    const state: FileLeaseMarker = { raw, holderId: null, expiresAt: 0 };
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        const doc = parsed as Partial<MarkerDoc>;
        state.holderId = typeof doc.holderId === 'string' ? doc.holderId : null;
        state.expiresAt =
          typeof doc.expiresAtEpochMs === 'number' ? doc.expiresAtEpochMs : 0;
      }
    } catch {
      // corrupt marker → expiresAt 0 (takeable) — holderId stays unknown
    }
    return state;
  };

  const readMarker = deps.readMarker ?? defaultReadMarker;

  /** Put a moved-aside dir back on the live path. If a legitimate holder
   *  re-occupied it, retry once (the occupier may itself be a mid-flight
   *  takeover about to free the slot), then park the dir under an .orphan
   *  suffix and warn — never rm a possibly-live marker. */
  const restoreOrOrphan = async (movedDir: string, context: string): Promise<void> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      // POSIX rename onto an existing EMPTY dir replaces it — check first
      // so a contender's just-mkdir'd (pre-marker) dir isn't destroyed
      // under our restore. Occupied → retry once (the occupier may be a
      // mid-flight takeover about to free the slot); a mkdir racing our
      // stat→rename is the residual.
      if (await stat(lockPath).then(() => true, () => false)) {
        continue;
      }
      try {
        await rename(movedDir, lockPath);
        return;
      } catch {
        // Occupied or an fs fault in the stat→rename gap — retry once.
      }
    }
    const orphanPath = `${movedDir}.orphan`;
    const parked = await rename(movedDir, orphanPath).then(() => true, () => false);
    console.warn(
      `[rh-agent-mcp] file refresh lease ${context}: could not restore a ` +
        `possibly-live lock dir to ${lockPath} — ` +
        (parked
          ? `parked at ${orphanPath}.`
          : `stranded at ${movedDir} (orphan rename also failed).`) +
        ` A stranded live lock can mean a double refresh POST is in flight.`,
    );
  };

  /** Markerless dir = a holder crashed between mkdir and marker write; its
   *  would-be lease lives ~ttlMs, so the dir goes stale on the same clock. */
  const fallbackExpiry = async (ttlMs: number): Promise<number> => {
    const lock = await stat(lockPath).catch(() => undefined);
    return lock ? lock.mtimeMs + ttlMs : 0;
  };

  const writeMarker = async (holderId: string, ttlMs: number): Promise<void> => {
    const tmp = `${lockPath}/holder.${randomUUID()}.tmp`;
    await writeFile(
      tmp,
      JSON.stringify({ holderId, expiresAtEpochMs: Date.now() + ttlMs } satisfies MarkerDoc),
      { encoding: 'utf8', flag: 'wx' },
    );
    await rename(tmp, markerPath(lockPath));
  };

  const acquire = async (holderId: string, ttlMs: number): Promise<RefreshLease | null> => {
    await mkdir(dirname(lockPath), { recursive: true });
    try {
      await mkdir(lockPath);
      try {
        await writeMarker(holderId, ttlMs);
      } catch (error) {
        await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
      return { holderId };
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) {
        throw error;
      }
    }

    const observed = await readMarker(lockPath);
    const effectiveExpiry = observed?.expiresAt ?? (await fallbackExpiry(ttlMs));
    if (effectiveExpiry > Date.now()) {
      return null; // another live holder owns the slot
    }

    const stalePath = `${lockPath}.${randomUUID()}.stale`;
    try {
      await rename(lockPath, stalePath);
    } catch (error) {
      // Vanished between check and rename — released or already taken.
      if (isNodeError(error, 'ENOENT') || isNodeError(error, 'ENOTEMPTY')) {
        return null;
      }
      throw error;
    }
    // The moved dir must carry the state we observed — a different marker
    // means a fresh holder landed between our read and the rename, and we
    // just stole a live lock. Put it back rather than double-holding.
    let moved: FileLeaseMarker | null;
    try {
      moved = await readMarker(stalePath);
    } catch (error) {
      // Can't verify what we stole — try to put it back before failing;
      // a stranded foreign dir while lockPath sits free would let a third
      // holder stack onto the live holder.
      await restoreOrOrphan(stalePath, 'acquire');
      throw error;
    }
    if (moved?.raw !== observed?.raw) {
      // Dir swapped under us — a fresh holder's lock; put it back rather
      // than double-holding. If the live path is already re-occupied the
      // record is parked as an orphan — never rm a possibly-live marker.
      await restoreOrOrphan(stalePath, 'acquire');
      return null;
    }
    await rm(stalePath, { recursive: true, force: true });
    try {
      await mkdir(lockPath);
    } catch (error) {
      if (isNodeError(error, 'EEXIST')) {
        return null; // someone else took the freed slot
      }
      throw error;
    }
    try {
      await writeMarker(holderId, ttlMs);
    } catch (error) {
      // We created this lockPath — a failed marker write must not leave
      // our own markerless wedge behind (it would block ~ttlMs).
      await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    return { holderId };
  };

  const release = async (lease: RefreshLease): Promise<void> => {
    // Cheap gate first: nothing to do unless the marker attributes to us.
    const observed = await readMarker(lockPath);
    if (observed?.holderId !== lease.holderId) {
      return;
    }
    // An expired marker is takeover-bait — the acquire takeover path
    // already handles it safely. Moving it aside here could strand a
    // successor that completed takeover in our read→rename gap (their
    // live dir parked while a third holder claims lockPath → double-hold
    // → double POST). Leave it for the takeover path.
    if (observed.expiresAt <= Date.now()) {
      return;
    }
    // Check-then-act on the live path is a TOCTOU: between the read and
    // an rm, a contender could take over and own a live lock we'd then
    // delete. Move the dir aside and rm only what we hold privately —
    // same idiom as acquire's stale takeover.
    const trashPath = `${lockPath}.${randomUUID()}.release`;
    try {
      await rename(lockPath, trashPath);
    } catch (error) {
      if (isNodeError(error, 'ENOENT') || isNodeError(error, 'ENOTEMPTY')) {
        return; // released or taken over between read and rename
      }
      throw error;
    }
    let moved: FileLeaseMarker | null;
    try {
      moved = await readMarker(trashPath);
    } catch (error) {
      await restoreOrOrphan(trashPath, 'release');
      throw error;
    }
    if (moved?.raw !== observed?.raw) {
      // Dir swapped under us — a fresh holder's lock; put it back. If the
      // live path is re-occupied the record is parked as an orphan —
      // never rm a possibly-live marker.
      await restoreOrOrphan(trashPath, 'release');
      return;
    }
    await rm(trashPath, { recursive: true, force: true });
  };

  return { currentRevision, acquire, release };
}
