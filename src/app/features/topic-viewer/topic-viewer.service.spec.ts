/**
 * TopicViewerService spec — httpsCallable wrappers for the lifecycle
 * callables (#642 monolith, #1531 label writes, #1637 index/tree).
 * Mocks @angular/fire/functions; asserts callable-name and
 * request/response pass-through for each wrapper.
 */

jest.mock('@angular/fire/functions', () => ({
  Functions: class {},
  httpsCallable: jest.fn(),
}));

import { TestBed } from '@angular/core/testing';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { firstValueFrom } from 'rxjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CallableName } from '../../core/common/constants';
import { TopicViewerService, TOPIC_VIEWER_REPOS } from './topic-viewer.service';
import type { LifecycleTreeResponse } from '@lifecycle/contracts';

const callable = jest.fn();

describe('TopicViewerService', () => {
  let service: TopicViewerService;

  beforeEach(async () => {
    jest.clearAllMocks();
    (httpsCallable as jest.Mock).mockReturnValue(callable);
    await TestBed.configureTestingModule({
      providers: [
        TopicViewerService,
        { provide: Functions, useValue: {} },
      ],
    });
    service = TestBed.inject(TopicViewerService);
  });

  it('repos constant exposes the supported mirror', () => {
    expect(TOPIC_VIEWER_REPOS.length).toBeGreaterThan(0);
    expect(TOPIC_VIEWER_REPOS[0].owner).toBe('rinebob');
  });

  it('calls getLifecycleTree callable and unwraps .data', async () => {
    const payload: LifecycleTreeResponse = {
      topics: [],
      fetchedAt: '2026-09-28T00:00:00Z',
    };
    callable.mockResolvedValue({ data: payload });

    const res = await firstValueFrom(
      service.getLifecycleTree$({ owner: 'rinebob', repo: 'rel-str' }));

    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), CallableName.GET_LIFECYCLE_TREE);
    expect(callable).toHaveBeenCalledWith({ owner: 'rinebob', repo: 'rel-str' });
    expect(res).toEqual(payload);
  });

  // ── lazy-loading callables (task #1637) ─────────────────────────────────

  it('calls getLifecycleTopicIndex with the repo request and unwraps .data', async () => {
    const payload: LifecycleTreeResponse = {
      topics: [],
      fetchedAt: '2026-11-20T00:00:00Z',
    };
    callable.mockResolvedValue({ data: payload });
    const res = await firstValueFrom(
      service.getLifecycleTopicIndex$({ owner: 'rinebob', repo: 'rel-str' }));
    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), CallableName.GET_LIFECYCLE_TOPIC_INDEX);
    expect(callable).toHaveBeenCalledWith({ owner: 'rinebob', repo: 'rel-str' });
    expect(res).toEqual(payload);
  });

  it('calls getLifecycleTopicTree with topicNumber in the request', async () => {
    const payload: LifecycleTreeResponse = {
      topics: [],
      fetchedAt: '2026-11-20T00:00:00Z',
    };
    callable.mockResolvedValue({ data: payload });
    const res = await firstValueFrom(service.getLifecycleTopicTree$({
      owner: 'rinebob', repo: 'rel-str', topicNumber: 619,
    }));
    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), CallableName.GET_LIFECYCLE_TOPIC_TREE);
    expect(callable).toHaveBeenCalledWith({
      owner: 'rinebob', repo: 'rel-str', topicNumber: 619,
    });
    expect(res).toEqual(payload);
  });

  it('callable names stay in deploy-name parity with the BE exports', () => {
    // Parity is pinned to the literal deploy names — a rename on either
    // side without the other breaks the call silently at runtime.
    expect(CallableName.GET_LIFECYCLE_TOPIC_INDEX).toBe('getLifecycleTopicIndex');
    expect(CallableName.GET_LIFECYCLE_TOPIC_TREE).toBe('getLifecycleTopicTree');
    expect(CallableName.RESOLVE_LIFECYCLE_ISSUE).toBe('resolveLifecycleIssue');
  });

  // ── issue-number deep search (task #1696) ──────────────────────────────

  it('calls resolveLifecycleIssue with owner/repo/issueNumber and unwraps .data', async () => {
    const payload = {
      issue: {
        number: 1696, title: 'FE-IMPL: deep search', state: 'open' as const,
        url: 'https://github.com/rinebob/rel-str/issues/1696', labels: ['FE'],
      },
      path: [619, 1609, 1694, 1696],
    };
    callable.mockResolvedValue({ data: payload });
    const res = await firstValueFrom(service.resolveLifecycleIssue$({
      owner: 'rinebob', repo: 'rel-str', issueNumber: 1696,
    }));
    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), CallableName.RESOLVE_LIFECYCLE_ISSUE);
    expect(callable).toHaveBeenCalledWith({
      owner: 'rinebob', repo: 'rel-str', issueNumber: 1696,
    });
    expect(res).toEqual(payload);
  });

  // ── label callables (task #1531) ─────────────────────────────────────────

  it('calls listRepoLabels and unwraps .data', async () => {
    callable.mockResolvedValue({ data: { labels: [], fetchedAt: 'x' } });
    const res = await firstValueFrom(
      service.listRepoLabels$({ owner: 'rinebob', repo: 'rel-str' }));
    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), CallableName.LIST_REPO_LABELS);
    expect(callable).toHaveBeenCalledWith({ owner: 'rinebob', repo: 'rel-str' });
    expect(res.labels).toEqual([]);
  });

  it('calls updateIssueLabels with the add/remove payload', async () => {
    callable.mockResolvedValue({ data: { labels: ['IMPL'], created: [] } });
    const res = await firstValueFrom(service.updateIssueLabels$({
      owner: 'rinebob', repo: 'rel-str',
      issueNumber: 20, add: ['IMPL'], remove: ['STALE'],
    }));
    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), CallableName.UPDATE_ISSUE_LABELS);
    expect(callable).toHaveBeenCalledWith({
      owner: 'rinebob', repo: 'rel-str',
      issueNumber: 20, add: ['IMPL'], remove: ['STALE'],
    });
    expect(res.labels).toEqual(['IMPL']);
  });

  it('calls manageRepoLabel with the op payload', async () => {
    callable.mockResolvedValue({ data: { op: 'delete', usageCount: 3 } });
    const res = await firstValueFrom(service.manageRepoLabel$({
      owner: 'rinebob', repo: 'rel-str',
      op: 'delete', name: 'old-label',
    }));
    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), CallableName.MANAGE_REPO_LABEL);
    expect(callable).toHaveBeenCalledWith({
      owner: 'rinebob', repo: 'rel-str',
      op: 'delete', name: 'old-label',
    });
    expect(res.usageCount).toBe(3);
  });
});

/**
 * CallableName ↔ functions index parity (#1638 AC): every callable the
 * service dials must be exported by `functions/src/index.ts` — a rename
 * or dropped export fails here instead of at runtime.
 */
describe('CallableName parity vs functions/src/index.ts', () => {
  const indexSrc = readFileSync(
    join(__dirname, '../../../../functions/src/index.ts'), 'utf8');
  const exported = new Set<string>();
  for (const m of indexSrc.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()!.trim();
      if (name) exported.add(name);
    }
  }
  for (const m of indexSrc.matchAll(/export\s+(?:const|function|async\s+function)\s+(\w+)/g)) {
    exported.add(m[1]);
  }

  it.each([
    CallableName.GET_LIFECYCLE_TREE,
    CallableName.GET_LIFECYCLE_TOPIC_INDEX,
    CallableName.GET_LIFECYCLE_TOPIC_TREE,
    CallableName.LIST_REPO_LABELS,
    CallableName.UPDATE_ISSUE_LABELS,
    CallableName.MANAGE_REPO_LABEL,
    CallableName.RESOLVE_LIFECYCLE_ISSUE,
  ])('%s is exported by functions/src/index.ts', (name) => {
    expect(exported.has(name)).toBe(true);
  });
});
