import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RobinhoodMcpClient } from './robinhood-mcp-client.service';
import { RobinhoodMcpObservationService } from './robinhood-mcp-observation.service';
import type { ToolExecutionResult } from '@robinhood-mcp/contracts';

describe('live-capture option orders normalize (#1411 QA)', () => {
  it('all 9 real wire option orders parse — none dropped', async () => {
    const capture = JSON.parse(
      readFileSync(
        join(__dirname, '../../../../docs/topics/657-rh-mcp/captures/ro-opt-orders-01.json'),
        'utf-8',
      ),
    );
    const mcp = { executeTool: jasmine.createSpy('executeTool'), executeTools: jasmine.createSpy('executeTools') };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        RobinhoodMcpClient,
        { provide: RobinhoodMcpObservationService, useValue: mcp },
      ],
    });
    const client = TestBed.inject(RobinhoodMcpClient);
    mcp.executeTool.and.callFake(() =>
      Promise.resolve({
        success: true,
        parsed: capture.response,
        redacted: {},
        tool: 'get_option_orders',
      } as ToolExecutionResult),
    );

    const orders = await client.getOptionOrders('123456789');
    expect(orders.map((o) => [o.symbol, o.side, o.type, o.state, o.price])).toEqual(
      capture.response.data.orders.map((r: Record<string, unknown>) => [
        r['chain_symbol'],
        r['direction'] === 'debit' ? 'buy' : 'sell',
        r['type'], r['state'],
        r['price'] ? parseFloat(r['price'] as string) : null,
      ]),
    );

    // Leg contract terms survive normalization — the History table's option
    // label (chain + strike + C/P + expiry) depends on them (#1411 QA).
    for (let i = 0; i < orders.length; i++) {
      const rawLegs = (capture.response.data.orders[i]['legs'] ?? []) as Record<string, unknown>[];
      expect(orders[i].legs?.length).toBe(rawLegs.length);
      orders[i].legs?.forEach((leg, j) => {
        const raw = rawLegs[j];
        expect(leg.strikePrice).toBe(raw['strike_price'] ? parseFloat(raw['strike_price'] as string) : null);
        expect(leg.expirationDate).toBe(raw['expiration_date'] ?? null);
        expect(leg.optionType).toBe(raw['option_type'] ?? null);
      });
    }
  });
});

describe('live-capture option positions normalize (#1481)', () => {
  // The real wire bytes pin the parse AND the units convention:
  // average_price 190.0000 with multiplier 100 → averageCost 1.9/share,
  // joining mark_price's per-share units (same instrument …da44 in
  // opt-quote-fill marks 1.91 — the position cost ~$190/contract).
  it('opt-pos-open parses the documented data.positions shape', async () => {
    const capture = JSON.parse(
      readFileSync(
        join(__dirname, '../../../../docs/topics/657-rh-mcp/captures/opt-pos-open.json'),
        'utf-8',
      ),
    );
    const mcp = { executeTool: jasmine.createSpy('executeTool'), executeTools: jasmine.createSpy('executeTools') };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        RobinhoodMcpClient,
        { provide: RobinhoodMcpObservationService, useValue: mcp },
      ],
    });
    const client = TestBed.inject(RobinhoodMcpClient);
    mcp.executeTool.and.callFake(() =>
      Promise.resolve({
        success: true,
        parsed: capture.response,
        redacted: {},
        tool: 'get_option_positions',
      } as ToolExecutionResult),
    );

    const positions = await client.getOptionPositions('123456789');
    expect(positions.length).toBe(1);
    const p = positions[0];
    expect(p.instrumentId).toBe('14a8e49b-0f10-4d64-9cf9-bd1a68e9da44');
    expect(p.chainSymbol).toBe('NFLX');
    // Wire type is position side — never call/put.
    expect(p.side).toBe('long');
    expect(p.optionType).toBe('');
    expect(p.strikePrice).toBeNull();
    expect(p.quantity).toBe(1);
    expect(p.averageCost).toBeCloseTo(1.9);
    expect(p.multiplier).toBe(100);
    expect(p.expirationDate).toBe('2026-10-16');
  });
});
