import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const html = await readFile('dist/index.html', 'utf8');
test('APK page is standalone, branded, and needs no remote fonts', () => {
  assert.match(html, /<title>家练<\/title>/);
  assert.doesNotMatch(html, /练日|LIANRI|@import url|<script[^>]+src=["']https:/);
  assert.match(html, /家练 \/ JIALIAN/);
  assert.match(html, /localStorage.setItem/);
  assert.match(html, /window.lucide=/);
});
test('every shipped script parses', () => {
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
});
test('Android app identity matches Capacitor config', async () => {
  const config = JSON.parse(await readFile('capacitor.config.json', 'utf8'));
  const strings = await readFile('android/app/src/main/res/values/strings.xml', 'utf8');
  assert.equal(config.appName, '家练');
  assert.match(strings, /name="app_name">家练</);
  assert.match(strings, /com.jialian.app/);
});
