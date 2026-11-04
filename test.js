// Knowledge-base smoke test. No external service or API key is required.
const assert = require('assert');
const { loadArticles, norm, searchArticles, server } = require('./server');
assert.strictEqual(typeof require('./api/index'), 'function');

const articles = loadArticles();
assert.ok(articles.length >= 25, 'legacy and curated articles should load');
assert.ok(articles.some(article => article.id === 'hawkers-thane'));
assert.ok(articles.some(article => article.id === 'hawkers-mumbai'));
assert.ok(articles.some(article => article.id === 'hawkers-pune'));
assert.ok(articles.some(article => article.id === 'sample-civic-issue' && article.status === 'draft'));
assert.deepStrictEqual(articles.find(article => article.id === 'hawkers-thane').locations, ['thane']);
assert.ok(articles.find(article => article.id === 'hawkers-mumbai').categories.includes('street-hawkers'));
assert.ok(searchArticles(articles, 'illegal hawkers thane', '')[0].id === 'hawkers-thane');
assert.ok(searchArticles(articles, '', { location: 'pune-beta' }).some(article => article.id === 'hawkers-pune'));
assert.ok(searchArticles(articles, '', { topic: 'food-drug' }).some(article => article.id === 'food-issues-maharashtra'));
assert.ok(searchArticles(articles, 'unlicensed vendors', '').some(article => article.id === 'hawkers-mumbai'));
assert.ok(searchArticles(articles, 'bribe', '').some(article => article.id === 'bribe-maharashtra'));
assert.ok(searchArticles(articles, 'food poisoning', '').some(article => article.id === 'food-issues-maharashtra'));
assert.strictEqual(norm('  No-Parking, Thane! '), 'no-parking thane');

server.listen(0, async () => {
  const base = 'http://127.0.0.1:' + server.address().port;
  const health = await (await fetch(base + '/api/health')).json();
  assert.strictEqual(health.ok, true);
  assert.strictEqual(health.ai, false);
  const adminStatus = await (await fetch(base + '/api/admin/status')).json();
  assert.strictEqual(adminStatus.configured, false);
  assert.strictEqual((await fetch(base + '/api/admin/articles')).status, 503);
  const adminPage = await (await fetch(base + '/admin')).text();
  assert.ok(adminPage.includes('Admin sign in') && adminPage.includes('Add image'));
  const results = await (await fetch(base + '/api/search?q=no%20parking')).json();
  assert.ok(results.total > 0);
  const tagged = await (await fetch(base + '/api/search?location=thane&topic=street-hawkers')).json();
  assert.ok(tagged.results.some(article => article.id === 'hawkers-thane'));
  assert.ok(tagged.locations.some(tag => tag.id === 'pune-beta'));
  const home = await (await fetch(base + '/')).text();
  assert.ok(home.includes('Skip to content') && home.includes('/favicon.svg') && home.includes('Illegal hawkers or encroachment in Mumbai'));
  assert.ok(!home.includes('id="locations"><div class="loading">') && !home.includes('id="categories"><div class="loading">'));
  assert.ok(home.includes('href="/admin"') && home.includes('href="/about"') && home.includes('Views expressed are personal'));
  assert.strictEqual((await fetch(base + '/')).status, 200);
  const guideResponse = await fetch(base + '/guides/hawkers-mumbai');
  const guide = await guideResponse.text();
  assert.strictEqual(guideResponse.status, 200);
  assert.ok(guide.includes('<h1>Illegal hawkers or encroachment in Mumbai</h1>'));
  assert.ok(guide.includes('rel="canonical"') && guide.includes('Last updated'));
  const missing = await fetch(base + '/guides/does-not-exist');
  assert.strictEqual(missing.status, 404);
  assert.ok((await missing.text()).includes('Page not found'));
  const redirect = await fetch(base + '/guide/hawkers-mumbai', { redirect: 'manual' });
  assert.strictEqual(redirect.status, 301);
  assert.strictEqual(redirect.headers.get('location'), '/guides/hawkers-mumbai');
  assert.strictEqual((await fetch(base + '/favicon.svg')).status, 200);
  assert.strictEqual((await fetch(base + '/robots.txt')).status, 200);
  assert.strictEqual((await fetch(base + '/sitemap.xml')).status, 200);
  assert.strictEqual((await fetch(base + '/privacy')).status, 200);
  const aboutResponse = await fetch(base + '/about');
  const about = await aboutResponse.text();
  assert.strictEqual(aboutResponse.status, 200);
  assert.ok(about.includes('This project and website was created') && about.includes('rajtandel2379@gmail.com') && about.includes('raj.tandel33'));
  for (const path of ['/', '/about', '/privacy', '/admin', '/favicon.svg', '/robots.txt', '/sitemap.xml', ...articles.map(article => `/guides/${article.id}`)]) {
    const response = await fetch(base + path);
    assert.ok(response.status < 400, `internal link is broken: ${path}`);
  }
  assert.notStrictEqual((await fetch(base + '/%2e%2e/server.js')).status, 200);
  console.log('all tests passed');
  server.close();
});
