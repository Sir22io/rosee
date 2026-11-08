// Vérifications statiques de l'interface : syntaxe des scripts, références de fichiers, CSP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

test('les scripts de l’interface sont syntaxiquement valides', () => {
  for (const f of ['app.js', 'sw.js', 'theme.js']) {
    execFileSync(process.execPath, ['--check', path.join(PUB, f)]);
  }
});

test('index.html : aucun script en ligne (CSP) et tous les fichiers référencés existent', () => {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<script>(?!\s*<\/script>)/, 'script en ligne interdit par la CSP');
  assert.doesNotMatch(html, /\son[a-z]+="/, 'gestionnaire d’événement en ligne interdit par la CSP');
  const refs = [...html.matchAll(/(?:src|href)="(\/[^"#?]+)"/g)].map((m) => m[1]).filter((r) => r !== '/');
  for (const r of refs) assert.ok(fs.existsSync(path.join(PUB, r)), `fichier manquant : ${r}`);
});

test('app.js : pas de gestionnaire en ligne dans le HTML généré (CSP)', () => {
  const js = fs.readFileSync(path.join(PUB, 'app.js'), 'utf8');
  assert.doesNotMatch(js, /\son(click|change|input|submit)="/);
});

test('le service worker met en cache des fichiers qui existent', () => {
  const sw = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8');
  const shell = JSON.parse(sw.match(/const SHELL = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
  for (const f of shell) if (f !== '/') assert.ok(fs.existsSync(path.join(PUB, f)), `absent : ${f}`);
});

test('manifeste valide avec des icônes présentes', () => {
  const m = JSON.parse(fs.readFileSync(path.join(PUB, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(PUB, i.src)), i.src);
});
