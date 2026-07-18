import { runLocalOAuthBootstrapWithDependencies } from '../auth/local-oauth-bootstrap';

const forceRefresh = process.argv.includes('--force-refresh') ||
  process.env.RH_AGENT_FORCE_REFRESH === '1';

const result = await runLocalOAuthBootstrapWithDependencies({ forceRefresh });
console.log(JSON.stringify(result, null, 2));
console.log(result.evidence.credentialsPersisted
  ? 'Credentials are encrypted for local restart reuse.'
  : 'Credentials were not persisted.');

if (result.state !== 'CONNECTED') {
  process.exitCode = 1;
}
