import { TestBed } from '@angular/core/testing';

import { RelStrDbService } from './rel-str-db.service';

describe('RelStrDbService', () => {
  let service: RelStrDbService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(RelStrDbService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
