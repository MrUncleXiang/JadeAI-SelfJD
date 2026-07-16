import { AuthServiceError, authService } from '../src/lib/auth/service';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

async function readPasswordFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error(
      'Password input must be piped through stdin so it is not exposed in the process list. '
      + 'Example: read -s JADE_PASSWORD; printf %s "$JADE_PASSWORD" | pnpm auth:bootstrap-admin -- --username admin',
    );
  }
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  const password = input.replace(/\r?\n$/, '');
  if (!password) throw new Error('No password was provided on stdin');
  return password;
}

async function main() {
  const username = argument('username');
  if (!username) {
    throw new Error('Missing required --username argument');
  }

  const user = await authService.bootstrapAdmin({
    username,
    email: argument('email'),
    displayName: argument('display-name'),
    password: await readPasswordFromStdin(),
  });
  process.stdout.write(`Administrator created: ${user.username} (${user.id})\n`);
}

main().catch((error: unknown) => {
  if (error instanceof AuthServiceError) {
    process.stderr.write(`Bootstrap refused: ${error.code}\n`);
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : 'Bootstrap failed'}\n`);
  }
  process.exitCode = 1;
});
