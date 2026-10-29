import assert from 'node:assert/strict';

for (const base of [process.env.TEST_BASE_URL, process.env.TEST_PREVIEW_URL]) {
  assert.ok(base, 'Harness must provide dev and production URLs');
  for (const [path, coop, coep] of [
    ['', 'same-origin', 'require-corp'],
    ['drive-auth.html', 'same-origin-allow-popups', 'unsafe-none'],
  ]) {
    const response = await fetch(new URL(path, base));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), coop);
    assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), coep);
  }
}
const base = process.env.TEST_PREVIEW_URL;
const html = await (await fetch(base)).text();
const paths = [...html.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css))"/g)].map(match => match[1]);
assert.ok(paths.length >= 2, 'Production JS and CSS entry assets exist');
for (const path of paths) {
  assert.ok(path.startsWith('./'), `Entry asset stays relative: ${path}`);
  const url = new URL(path, base);
  assert.ok(url.pathname.startsWith('/CoffeeOS/'));
  const response = await fetch(url);
  assert.equal(response.status, 200, url.href);
  assert.match(response.headers.get('Content-Type'), /javascript|css/);
}
console.log('PASS dev/production main/helper COOP/COEP and relative /CoffeeOS/ assets');
