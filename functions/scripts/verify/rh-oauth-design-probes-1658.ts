/**
 * rh-oauth-design-probes-1658 — live verification for the two-grant design.
 *
 * Two probes, run manually (NOT wired into run-all — both are write-ish
 * against RH or interactive):
 *
 *   npx tsx scripts/verify/rh-oauth-design-probes-1658.ts redirect-uri
 *     Registers a client with an https:// redirect_uri against RH's OAuth
 *     endpoints. Decides whether the in-app prod mint is possible or the
 *     prod mint keeps a local-browser step. Pass --print-url to also emit
 *     the authorize URL (click it to fully prove the redirect lands).
 *
 *   npx tsx scripts/verify/rh-oauth-design-probes-1658.ts two-grants
 *     Mints grant A, mints grant B (two interactive logins), then refreshes
 *     grant A. Decides whether RH tolerates concurrent independent grants
 *     for one account — the load-bearing assumption of the per-store-mint
 *     design. Probe bundles are written to a temp dir and deleted on exit.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  discoverOAuthServerInfo,
  registerClient,
  startAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { ROBINHOOD_TRADING_MCP_URL } from '../../src/rh-agent-mcp/contracts/robinhood-mcp';
import { EncryptedFileCredentialRepository } from '../../src/rh-agent-mcp/auth/encrypted-file-credential-repository';
import { DpapiCredentialCipher } from '../../src/rh-agent-mcp/auth/dpapi-credential-cipher';
import { runLocalOAuthBootstrapWithDependencies } from '../../src/rh-agent-mcp/auth/local-oauth-bootstrap';

const PROD_CALLBACK = 'https://savanttrader.com/api/rh/oauth/callback';

async function probeRedirectUri(printUrl: boolean): Promise<void> {
  console.log('== redirect_uri probe — https acceptance ==');
  const info = await discoverOAuthServerInfo(ROBINHOOD_TRADING_MCP_URL);
  const authorizationServerUrl = info.authorizationServerUrl ?? ROBINHOOD_TRADING_MCP_URL;
  console.log(`authorization server: ${authorizationServerUrl}`);
  try {
    const clientInformation = await registerClient(authorizationServerUrl, {
      metadata: info.authorizationServerMetadata,
      clientMetadata: {
        client_name: 'RH Agent prod redirect probe',
        redirect_uris: [PROD_CALLBACK],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
    });
    console.log(`PASS — registered client_id ${clientInformation.client_id} with https redirect_uri`);
    if (printUrl) {
      const { authorizationUrl } = await startAuthorization(authorizationServerUrl, {
        metadata: info.authorizationServerMetadata,
        clientInformation,
        redirectUrl: PROD_CALLBACK,
      });
      console.log(`authorize URL (open it — the redirect landing on the prod path is the full proof):\n  ${authorizationUrl}`);
    }
    return;
  } catch (error) {
    console.log(`FAIL — https redirect_uri rejected at registration: ${(error as Error).message}`);
    console.log('=> prod in-app mint is blocked; the prod mint keeps a local-browser step writing straight to Firestore');
    process.exit(1);
  }
}

async function probeTwoGrants(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'rh-grant-probe-'));
  try {
    const cipher = new DpapiCredentialCipher();
    const repoA = new EncryptedFileCredentialRepository(join(dir, 'grant-a.dpapi'), cipher);
    const repoB = new EncryptedFileCredentialRepository(join(dir, 'grant-b.dpapi'), cipher);

    console.log('== mint grant A (interactive login #1) ==');
    const mintA = await runLocalOAuthBootstrapWithDependencies({
      repository: repoA,
      forceReauthorization: true,
    });
    if (mintA.state !== 'CONNECTED') {
      console.log(`FAIL — grant A mint did not connect: ${mintA.state} — ${JSON.stringify(mintA.evidence)}`);
      process.exitCode = 1;
      return;
    }

    console.log('== mint grant B (interactive login #2) ==');
    const mintB = await runLocalOAuthBootstrapWithDependencies({
      repository: repoB,
      forceReauthorization: true,
    });
    if (mintB.state !== 'CONNECTED') {
      console.log(`FAIL — grant B mint did not connect: ${mintB.state} — ${JSON.stringify(mintB.evidence)}`);
      process.exitCode = 1;
      return;
    }

    const rtA = (await repoA.load())?.tokens?.refresh_token;
    const rtB = (await repoB.load())?.tokens?.refresh_token;
    if (!rtA || !rtB || rtA === rtB) {
      console.log('FAIL — mints did not produce two distinct refresh tokens');
      process.exitCode = 1;
      return;
    }
    console.log('two distinct refresh tokens minted');

    console.log('== refresh grant A — does a second authorize kill the first? ==');
    const refreshA = await runLocalOAuthBootstrapWithDependencies({
      repository: repoA,
      forceRefresh: true,
    });
    const refreshedRtA = (await repoA.load())?.tokens?.refresh_token;
    if (refreshA.state === 'CONNECTED' && refreshedRtA && refreshedRtA !== rtA) {
      console.log('PASS — grant A refreshed after grant B was minted; concurrent grants survive');
    } else {
      console.log(`FAIL — grant A did not rotate (state ${refreshA.state}); concurrent grants may not be independent`);
      process.exitCode = 1;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const command = process.argv[2];
if (command === 'redirect-uri') {
  await probeRedirectUri(process.argv.includes('--print-url'));
} else if (command === 'two-grants') {
  await probeTwoGrants();
} else {
  console.log('usage: rh-oauth-design-probes-1658.ts redirect-uri [--print-url] | two-grants');
  process.exit(1);
}
