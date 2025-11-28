import { cp } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const source = resolve(rootDir, 'README.md');
const destination = resolve(rootDir, 'packages/cli/README.md');
const imagesSource = resolve(rootDir, 'images');
const imagesDestination = resolve(rootDir, 'packages/cli/images');

await cp(source, destination, { force: true });
await cp(imagesSource, imagesDestination, { recursive: true, force: true });
