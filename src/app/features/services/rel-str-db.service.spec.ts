import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';

import { RelStrDbService } from './rel-str-db.service';

describe('RelStrDbService', () => {
  let service: RelStrDbService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: Firestore, useValue: {} }],
    });
    service = TestBed.inject(RelStrDbService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
