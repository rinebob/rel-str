import { runLocalOAuthBootstrap } from '../auth/local-oauth-bootstrap';

const result = await runLocalOAuthBootstrap();
console.log(JSON.stringify(result, null, 2));
console.log(result.evidence.credentialsPersisted
  ? 'Credentials are encrypted for local restart reuse.'
  : 'Credentials were not persisted.');

if (result.state !== 'CONNECTED') {
  process.exitCode = 1;
}
