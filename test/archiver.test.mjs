// Δοκιμή της συλλογής πάνω σε ψεύτικο GitHub API στη μνήμη: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createArchiver, rawPath, CSV_HEADER } from '../lib/archiver.js';
import { emptyProfiles } from '../lib/profiles.js';

function fakeGitHub(files) {
  const trees = { t0: { ...files } };
  const commits = { c0: 't0' };
  let head = 'c0';
  let n = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const path = url.pathname.replace('/repos/o/r', '');
      const json = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.headers.authorization !== 'Bearer secret') return json({}, 401);
      if (req.method === 'GET' && path === '/git/ref/heads/data') return json({ object: { sha: head } });
      if (req.method === 'GET' && path.startsWith('/git/commits/')) return json({ tree: { sha: commits[path.slice(13)] } });
      if (req.method === 'GET' && path.startsWith('/contents/')) {
        const f = trees[commits[url.searchParams.get('ref')]][decodeURIComponent(path.slice(10))];
        if (f === undefined) return json({}, 404);
        res.writeHead(200); return res.end(f);
      }
      const b = JSON.parse(body || '{}');
      if (req.method === 'POST' && path === '/git/trees') {
        const sha = `t${++n}`;
        trees[sha] = { ...trees[b.base_tree] };
        for (const e of b.tree) trees[sha][e.path] = e.content;
        return json({ sha }, 201);
      }
      if (req.method === 'POST' && path === '/git/commits') {
        const sha = `c${++n}`;
        commits[sha] = b.tree;
        return json({ sha, parents: b.parents }, 201);
      }
      if (req.method === 'PATCH' && path === '/git/refs/heads/data') { head = b.sha; return json({}); }
      return json({}, 500);
    });
  });
  return { server, files: () => trees[commits[head]], commits: () => Object.keys(commits).length - 1 };
}

test('γράφει μόνο νέες μετρήσεις, ανά ώρα, χωρίς διπλές', async () => {
  const now = Date.now();
  const t1 = now - 5 * 60_000;
  const gh = fakeGitHub({
    'last.json': JSON.stringify({ A: t1 }), // τη μέτρηση του A την έχει ήδη γράψει το Actions
    'profiles.json': JSON.stringify(emptyProfiles()),
    'stations.json': JSON.stringify([{ id: 'Z', onoma: 'παλιός' }]),
  });
  await new Promise((r) => gh.server.listen(0, r));
  const a = createArchiver({ token: 'secret', repo: 'o/r', api: `http://127.0.0.1:${gh.server.address().port}` });
  const row = (id, t, speed = 50) => ({ station: { id, onoma: id }, reading: { id, t, count: 100, occ: 10, speed } });

  a.collect([row('A', t1), row('B', t1), row('C', now - 3 * 3_600_000), row('D', t1, null)], now);
  a.collect([row('A', t1), row('B', t1)], now); // ίδιο στιγμιότυπο ξανά
  await a.flush();
  let f = gh.files();
  const csv = f[rawPath(t1)];
  assert.ok(csv.startsWith(CSV_HEADER));
  assert.equal(csv.trim().split('\n').length, 3); // επικεφαλίδα, B, D· όχι A (ήδη γραμμένη), όχι C (παλιά)
  assert.match(csv, /,B,100,10,50\n/);
  assert.match(csv, /,D,100,10,\n/);
  assert.equal(JSON.parse(f['last.json']).B, t1);
  assert.equal(JSON.parse(f['profiles.json']).samples, 1); // η D δεν έχει ταχύτητα
  assert.deepEqual(JSON.parse(f['stations.json']).map((s) => s.id), ['A', 'B', 'C', 'D', 'Z']);
  assert.equal(gh.commits(), 1);

  await a.flush(); // τίποτα νέο: κανένα commit
  assert.equal(gh.commits(), 1);

  a.collect([row('A', now), row('B', now)], now);
  await a.flush(); // ίδια ώρα: τα προφίλ περιμένουν
  f = gh.files();
  assert.equal(f[rawPath(now)].includes(',A,'), true);
  await a.flush(true); // τελική αποθήκευση: γράφονται και τα προφίλ
  assert.equal(JSON.parse(gh.files()['profiles.json']).samples, 3);
  assert.equal(a.status().pending, 0);
  assert.equal(a.status().lastError, null);
  gh.server.close();
});

test('σε αποτυχία κρατά τις μετρήσεις για τον επόμενο κύκλο', async () => {
  const a = createArchiver({ token: 'x', repo: 'o/r', api: 'http://127.0.0.1:9' });
  const now = Date.now();
  a.collect([{ station: { id: 'A' }, reading: { id: 'A', t: now, count: 1, occ: 1, speed: 1 } }], now);
  await a.flush();
  assert.equal(a.status().pending, 1);
  assert.ok(a.status().lastError);
});
