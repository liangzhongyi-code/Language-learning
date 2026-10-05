import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
function markdowns(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const path = join(folder, entry.name);
    return entry.isDirectory() ? markdowns(path) : entry.name.endsWith('.md') ? [path] : [];
  });
}

test('published logic documents and active specifications have no missing local Markdown link targets', () => {
  const files = [join(root, 'README.md'), join(root, 'AGENTS.md'),
    ...markdowns(join(root, 'docs/logic-changes')), ...markdowns(join(root, 'openspec/changes'))];
  let checked = 0;
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].split(/[?#]/)[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      checked++;
      assert.equal(existsSync(resolve(dirname(file), decodeURIComponent(target))), true,
        `${file}: missing link ${target}`);
    }
  }
  assert.ok(checked > 50, 'must inspect real published documents, not an empty fixture');
});
