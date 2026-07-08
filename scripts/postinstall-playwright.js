import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.SKIP_PLAYWRIGHT) {
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const playwrightCli = join(root, 'node_modules', 'playwright', 'cli.js');

execSync(`node "${playwrightCli}" install chromium`, { stdio: 'inherit', cwd: root });
