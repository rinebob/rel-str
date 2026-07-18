import { spawn } from 'node:child_process';

export function openAuthorizationUrl(authorizationUrl: URL): Promise<void> {
  const url = authorizationUrl.toString();
  const command = process.platform === 'win32'
    ? { executable: 'rundll32.exe', arguments: ['url.dll,FileProtocolHandler', url] }
    : process.platform === 'darwin'
      ? { executable: 'open', arguments: [url] }
      : { executable: 'xdg-open', arguments: [url] };

  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.arguments, {
      detached: true,
      stdio: 'ignore',
    });
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
    child.once('error', reject);
  });
}
