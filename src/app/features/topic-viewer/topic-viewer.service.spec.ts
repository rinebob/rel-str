/**
 * TopicViewerService spec — httpsCallable wrapper for getLifecycleTree
 * (task #642). Mocks @angular/fire/functions; asserts the callable name
 * and request/response typing pass-through.
 */

jest.mock('@angular/fire/functions', () => ({
  Functions: class {},
  httpsCallable: jest.fn(),
}));

import { TestBed } from '@angular/core/testing';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { firstValueFrom } from 'rxjs';

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
      groupOrder: [],
      fetchedAt: '2026-09-28T00:00:00Z',
    };
    callable.mockResolvedValue({ data: payload });

    const res = await firstValueFrom(
      service.getLifecycleTree$({ owner: 'rinebob', repo: 'rel-str' }));

    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), CallableName.GET_LIFECYCLE_TREE);
    expect(callable).toHaveBeenCalledWith({ owner: 'rinebob', repo: 'rel-str' });
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
