import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Functions } from '@angular/fire/functions';

import { RsDataService } from './rs-data.service';

describe('RsDataService', () => {
  let service: RsDataService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Functions, useValue: {} },
      ],
    });
    service = TestBed.inject(RsDataService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
