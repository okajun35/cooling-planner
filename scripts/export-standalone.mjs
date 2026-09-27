/** Export source into a NEW directory. Does not build, move, publish, or initialize Git. */
import {mkdir, readdir, lstat, copyFile, realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const targetArg = process.argv[2];
if (!targetArg || process.argv.length !== 3) {
  console.error('Usage: node scripts/export-standalone.mjs /path/to/new/cooling-planner');
  process.exit(1);
}
const requested = path.resolve(targetArg);
const target = path.join(await realpath(path.dirname(requested)), path.basename(requested));
const relative = path.relative(root, target);
if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
  throw new Error('Export destination must be outside the source cooling-planner directory.');
}
// Explicit inputs exclude local credentials, build products, dependencies and historical evidence.
const entries = ['src', 'tests', 'scripts', 'docs', 'reference', 'examples',
  'package.json', 'package-lock.json', 'tsconfig.json', 'index.html',
  'README.md', 'START_WINDOWS.bat', 'requirements-test.txt', '.gitignore'];
const excluded = new Set(['node_modules', '.git', '.venv', '__pycache__', '.pytest_cache', '.compiled']);
async function copyEntry(source, destination) {
  const name = path.basename(source);
  if (excluded.has(name) || name === '.env' || name.startsWith('.env.') || name.endsWith('.pyc')) return;
  const stat = await lstat(source);
  if (stat.isSymbolicLink()) throw new Error(`Symbolic link must be reviewed before export: ${source}`);
  if (stat.isDirectory()) {
    await mkdir(destination);
    for (const child of await readdir(source)) await copyEntry(path.join(source, child), path.join(destination, child));
  } else if (stat.isFile()) {
    await copyFile(source, destination);
  } else {
    throw new Error(`Unsupported source entry: ${source}`);
  }
}
await mkdir(target); // Deliberately fails if destination exists; never overwrite a repository.
for (const entry of entries) await copyEntry(path.join(root, entry), path.join(target, entry));
console.log(`Source exported to ${target}`);
console.log('Next: npm ci, npm run typecheck, npm test, npm run build, npm start in that directory.');
console.log('Historical evidence and generated HTML were excluded. Rebuild before START_WINDOWS.bat.');
console.log('Export is not atomic: finish concurrent edits before creating the final repository.');
