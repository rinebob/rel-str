/**
 * DevLifecycleService spec — httpsCallable wrapper for getLifecycleTree
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
import { DevLifecycleService, DEV_LIFECYCLE_REPOS } from './dev-lifecycle.service';
import type { LifecycleTreeResponse } from '@lifecycle/contracts';

const callable = jest.fn();

describe('DevLifecycleService', () => {
  let service: DevLifecycleService;

  beforeEach(async () => {
    jest.clearAllMocks();
    (httpsCallable as jest.Mock).mockReturnValue(callable);
    await TestBed.configureTestingModule({
      providers: [
        DevLifecycleService,
        { provide: Functions, useValue: {} },
      ],
    });
    service = TestBed.inject(DevLifecycleService);
  });

  it('repos constant exposes the supported mirror', () => {
    expect(DEV_LIFECYCLE_REPOS.length).toBeGreaterThan(0);
    expect(DEV_LIFECYCLE_REPOS[0].owner).toBe('rinebob');
  });

  it('calls getLifecycleTree callable and unwraps .data', async () => {
    const payload: LifecycleTreeResponse = {
      sections: [{ name: 'Ungrouped', topics: [] }],
      fetchedAt: '2026-09-28T00:00:00Z',
      truncatedNodes: 0,
    };
    callable.mockResolvedValue({ data: payload });

    const res = await firstValueFrom(
      service.getLifecycleTree$({ owner: 'rinebob', repo: 'rel-str' }));

    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), CallableName.GET_LIFECYCLE_TREE);
    expect(callable).toHaveBeenCalledWith({ owner: 'rinebob', repo: 'rel-str' });
    expect(res).toEqual(payload);
  });
});
