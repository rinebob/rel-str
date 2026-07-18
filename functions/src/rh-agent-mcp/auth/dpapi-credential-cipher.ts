import { spawn } from 'node:child_process';
import type { CredentialCipher } from './encrypted-file-credential-repository';

const PROTECT_SCRIPT = [
  'Add-Type -AssemblyName System.Security',
  '$value = [Console]::In.ReadToEnd()',
  '$bytes = [Text.Encoding]::UTF8.GetBytes($value)',
  '$protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Convert]::ToBase64String($protected))',
].join('; ');

const UNPROTECT_SCRIPT = [
  'Add-Type -AssemblyName System.Security',
  '$value = [Console]::In.ReadToEnd()',
  '$bytes = [Convert]::FromBase64String($value)',
  '$plaintext = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plaintext))',
].join('; ');

export class DpapiUnavailableError extends Error {
  override name = 'DpapiUnavailableError';
}

export class DpapiOperationError extends Error {
  override name = 'DpapiOperationError';
}

function runPowerShell(script: string, input: string): Promise<string> {
  if (process.platform !== 'win32') {
    throw new DpapiUnavailableError();
  }

  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ], { stdio: ['pipe', 'pipe', 'ignore'] });
    const output: Buffer[] = [];
    child.stdout.on('data', chunk => output.push(Buffer.from(chunk)));
    child.once('error', () => reject(new DpapiOperationError()));
    child.once('close', code => {
      if (code !== 0) {
        reject(new DpapiOperationError());
        return;
      }
      resolve(Buffer.concat(output).toString('utf8'));
    });
    child.stdin.end(input);
  });
}

export class DpapiCredentialCipher implements CredentialCipher {
  encrypt(plaintext: string): Promise<string> {
    return runPowerShell(PROTECT_SCRIPT, plaintext);
  }

  decrypt(ciphertext: string): Promise<string> {
    return runPowerShell(UNPROTECT_SCRIPT, ciphertext);
  }
}
