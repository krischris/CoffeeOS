// Adapter regressions outside the application bundle. runDriveSelfTests uses
// fake transports. The explicit round-trip helper uses the supplied test client.
import { DriveClient, DriveAuthError } from '../src/drive';
import type { DriveAccount } from '../src/drive';
import { sha256, packageBackup, prepareBackup, unpackBackup } from '../src/backups';
import { captureDriveSnapshot, verifyDriveRoundTrip } from '../src/db';
import { DriveError } from '../src/drive';
export interface DriveCheck { name: string; status: 'PASS' | 'FAIL'; detail?: string }
export async function runDriveSelfTests(): Promise<DriveCheck[]> {
  const results: DriveCheck[] = [];
  const assert = (condition: unknown, message = 'Unexpected result') => { if (!condition) throw new Error(message); };
  const rejects = async (task: () => Promise<unknown>, contains?: string) => {
    try { await task(); } catch (error) { assert(!contains || String(error).includes(contains), String(error)); return; }
    throw new Error('Expected operation to stop');
  };
  const test = async (name: string, task: () => Promise<void>) => {
    try { await task(); results.push({ name, status: 'PASS' }); }
    catch (error) { results.push({ name, status: 'FAIL', detail: error instanceof Error ? error.message : 'Unexpected failure' }); }
  };
  const account: DriveAccount = { token: 'fake-test-token', expiresAt: Date.now() + 3600000, sub: 'fake', email: 'test@example.invalid' };
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  const controller = new AbortController();
  const client = (fn: (url: string, init?: RequestInit) => Promise<Response>, who = account, signal = controller.signal) =>
    new DriveClient(who, signal, fn as typeof fetch);
  const bytes = new Uint8Array([1, 2, 3]);
  const hash = await sha256(bytes);
  const remote = { id: 'test-file', size: '3', createdTime: '2026-10-27T12:00:00.000Z', sha256Checksum: hash,
    appProperties: { coffeeosKind: 'snapshot-v1', backupId: 'test-backup', archiveSha256: hash } };
  await test('Native browser fetch can read history through the stored transport', async () => {
    const fixture = new URL('/tests/fixtures/drive-empty-history.json', location.href);
    // Forward the client's actual receiver to the real browser API. Arrow mocks
    // cannot expose native fetch's receiver requirement and hid this live failure.
    const native = function(this: typeof globalThis, _url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      return fetch.call(this, fixture, init);
    };
    assert(await new DriveClient(account, controller.signal, native).folder(false) === null);
  });
  await test('Expired token stops before any request', async () => {
    let calls = 0; const api = client(async () => { calls++; return json({}); }, { ...account, expiresAt: 0 });
    try { await api.folder(false); throw new Error('Expected expiration'); } catch (error) { assert(error instanceof DriveAuthError); }
    assert(calls === 0);
  });
  await test('Revoked authorization is a reconnect error', async () => {
    try { await client(async () => json({}, 401)).folder(false); throw new Error('Expected 401'); }
    catch (error) { assert(error instanceof DriveAuthError); }
  });
  await test('Failed listing cannot become empty history', async () => { await rejects(() => client(async () => json({}, 503)).folder(false)); });
  await test('Incomplete and paginated history stop safely', async () => {
    for (const extra of [{ incompleteSearch: true }, { nextPageToken: 'more' }, { files: null }]) {
      await rejects(() => client(async () => json({ files: [], ...extra })).folder(false), 'incomplete');
    }
  });
  await test('Folder discovery uses app metadata and chooses a stable folder', async () => {
    let calls = 0;
    const folder = await client(async (url, init) => {
      calls++; assert(!init?.method); assert(new URL(url).searchParams.get('q')?.includes("key='coffeeosKind'"));
      return json({ files: [{ id: 'folder1' }, { id: 'folder2' }] });
    }).folder(true); assert(folder === 'folder1' && calls === 1);
  });
  await test('Empty cloud lookup creates no folder or file', async () => {
    let calls = 0; const folder = await client(async (_url, init) => { calls++; assert(!init?.method); return json({ files: [] }); }).folder(false);
    assert(folder === null && calls === 1);
  });
  await test('Latest uses server upload time with deterministic ID ties', async () => {
    const api = client(async () => json({ files: [{ ...remote, id: 'z' }, { ...remote, id: 'a' }, { ...remote, id: 'older', createdTime: '2020-01-01T00:00:00Z' }] }));
    assert((await api.latest('folder'))?.id === 'a');
    const precise = client(async () => json({ files: [{ ...remote, id: 'a', createdTime: '2026-10-27T12:00:00.123456Z' }, { ...remote, id: 'z', createdTime: '2026-10-27T12:00:00.123789Z' }] }));
    assert((await precise.latest('folder'))?.id === 'z');
  });
  await test('Uploads and downloads exceeding the former 4 MiB cap preserve exact bytes', async () => {
    const large = new Uint8Array(6 * 1024 * 1024 + 1); large[0] = 1; large[large.length - 1] = 255;
    const largeHash = await sha256(large);
    const metadata = { ...remote, size: String(large.length), sha256Checksum: largeHash,
      appProperties: { ...remote.appProperties, archiveSha256: largeHash } };
    let posts = 0;
    await client(async (_url, init) => {
      if (init?.method === 'POST') { posts++; return new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=test' } }); }
      if (init?.method === 'PUT') {
        const range = String((init.headers as Record<string, string>)['Content-Range']);
        const end = Number(range.match(/-(\d+)\//)?.[1]);
        if (end + 1 < large.length) return new Response(null, { status: 308, headers: { Range: `bytes=0-${end}` } });
      }
      return json(metadata);
    }).upload('folder', large, 'test-backup', 'test.coffeeos');
    assert(posts === 1);
    const downloaded = await client(async () => new Response(large, { headers: { 'Content-Length': String(large.length) } })).download(metadata);
    assert(downloaded.length === large.length && await sha256(downloaded) === largeHash);
  });
  await test('Upload completion checks remote bytes and metadata', async () => {
    let posts = 0;
    await client(async (_url, init) => { if (init?.method === 'POST') { posts++; return new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=test' } }); } return json(remote); })
      .upload('folder', bytes, 'test-backup', 'test.coffeeos'); assert(posts === 1);
  });
  await test('Logical hash is stored and verified with upload completion', async () => {
    for (const kept of [true, false]) {
      let posts = 0;
      const api = client(async (_url, init) => {
        if (init?.method === 'POST') {
          posts++;
          assert(JSON.parse(String(init.body)).appProperties.contentSha256V1 === hash);
          return new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=hash' } });
        }
        const file = { ...remote, appProperties: { ...remote.appProperties, ...(kept ? { contentSha256V1: hash } : {}) } };
        return json(init?.method === 'PUT' ? file : new URL(_url).searchParams.has('q') ? { files: [file] } : file);
      });
      if (kept) await api.upload('folder', bytes, 'test-backup', 'test.coffeeos', hash);
      else await rejects(() => api.upload('folder', bytes, 'test-backup', 'test.coffeeos', hash), 'unconfirmed');
      assert(posts === 1);
    }
  });
  await test('Lost upload response reconciles the same backup without a second POST', async () => {
    let posts = 0;
    const result = await client(async (url, init) => {
      if (init?.method === 'POST') { posts++; throw new TypeError('Lost response'); }
      assert(new URL(url).searchParams.get('q')?.includes("key='backupId' and value='test-backup'")); return json({ files: [remote] });
    }).upload('folder', bytes, 'test-backup', 'test.coffeeos'); assert(posts === 1 && result.id === remote.id);
  });
  await test('Uncertain uploads stop without blind retries', async () => {
    for (const found of [[], [remote, { ...remote, id: 'duplicate' }], [{ ...remote, sha256Checksum: 'bad' }]]) {
      let posts = 0; await rejects(() => client(async (_url, init) => {
        if (init?.method === 'POST') { posts++; throw new TypeError('Lost response'); } return json({ files: found });
      }).upload('folder', bytes, 'test-backup', 'test.coffeeos'), 'unconfirmed'); assert(posts === 1);
    }
  });
  await test('Invalid download sizes stop before network access', async () => {
    for (const size of [undefined, '', '-1', '1.5', 'invalid', '9007199254740992']) {
      let calls = 0; await rejects(() => client(async () => { calls++; return new Response(bytes); }).download({ ...remote, size }), 'invalid backup size'); assert(calls === 0);
    }
  });
  await test('Download stream bounds reject dishonest sizes', async () => {
    await rejects(() => client(async () => new Response(new ReadableStream({ start(c) { c.enqueue(bytes); c.enqueue(bytes); c.close(); } })))
      .download(remote), 'size does not match');
  });
  await test('Download content length must match metadata', async () => {
    await rejects(() => client(async () => new Response(bytes, { headers: { 'Content-Length': '6' } })).download(remote), 'size does not match');
  });
  await test('Corrupt remote checksum stops download', async () => { await rejects(() => client(async () => new Response(bytes)).download({ ...remote, sha256Checksum: 'bad' }), 'verified'); });
  await test('Valid pinned download preserves exact bytes', async () => {
    const data = await client(async (_url, init) => { assert((init?.headers as Record<string, string>).Authorization === 'Bearer fake-test-token'); return new Response(bytes); }).download(remote);
    assert(data.length === bytes.length && data.every((v, i) => v === bytes[i]));
  });
  await test('Disconnected operations stop before network access', async () => {
    const stopped = new AbortController(); stopped.abort(); let calls = 0;
    await rejects(() => client(async () => { calls++; return json({}); }, account, stopped.signal).folder(true)); assert(calls === 0);
  });
  await test('Pagination includes moved snapshots and stable ordering', async () => {
    let calls = 0;
    const files = await client(async url => {
      calls++; const p = new URL(url).searchParams;
      assert(!p.get('q')?.includes('in parents'));
      return json(p.get('pageToken') ? { files: [{ ...remote, id: 'new', createdTime: '2026-10-28T00:00:00Z' }] }
        : { files: [remote], nextPageToken: 'second' });
    }).history();
    assert(calls === 2 && files.length === 2 && files[0].id === 'new');
  });
  await test('Incomplete uploads are excluded from history', async () => {
    const files = await client(async () => json({ files: [remote, { ...remote, id: 'pending', sha256Checksum: undefined }] })).history();
    assert(files.length === 1 && files[0].id === remote.id);
  });
  await test('Transient listing retries and preserves history', async () => {
    let calls = 0;
    const files = await client(async () => ++calls < 3 ? json({}, 429) : json({ files: [remote] })).history();
    assert(calls === 3 && files.length === 1);
  });
  await test('Lost final chunk response probes the same session', async () => {
    let posts = 0, chunks = 0, probes = 0;
    const uploaded = await client(async (_url, init) => {
      if (init?.method === 'POST') { posts++; return new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=lost' } }); }
      if (init?.method === 'PUT' && init.body) { chunks++; throw new TypeError('Lost final response'); }
      if (init?.method === 'PUT') probes++;
      return json(remote);
    }).upload('folder', bytes, 'test-backup', 'test.coffeeos');
    assert(uploaded.id === remote.id && posts === 1 && chunks === 1 && probes === 1);
  });
  await test('Partial acknowledgement resumes from confirmed offset', async () => {
    let chunks = 0;
    await client(async (_url, init) => {
      if (init?.method === 'POST') return new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=partial' } });
      if (init?.method === 'PUT' && ++chunks === 1) return new Response(null, { status: 308, headers: { Range: 'bytes=0-0' } });
      if (init?.method === 'PUT') assert((init.headers as Record<string, string>)['Content-Range'] === 'bytes 1-2/3');
      return json(remote);
    }).upload('folder', bytes, 'test-backup', 'test.coffeeos');
    assert(chunks === 2);
  });
  await test('Session expiry and quota errors never start a second upload', async () => {
    for (const status of [404, 403]) {
      let posts = 0, puts = 0;
      await rejects(() => client(async (_url, init) => {
        if (init?.method === 'POST') { posts++; return new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=expired' } }); }
        if (init?.method === 'PUT') { puts++; return json({ error: { errors: [{ reason: 'storageQuotaExceeded' }] } }, status); }
        return json({ files: [] });
      }).upload('folder', bytes, 'test-backup', 'test.coffeeos'), 'unconfirmed');
      assert(posts === 1 && puts === 1);
    }
  });
  await test('Upload destinations cannot redirect credentials to another origin', async () => {
    let calls = 0;
    await rejects(() => client(async (_url, init) => {
      calls++;
      if (init?.method === 'POST') return new Response(null, { headers: { Location: 'https://example.invalid/upload' } });
      return json({ files: [] });
    }).upload('folder', bytes, 'test-backup', 'test.coffeeos'), 'unconfirmed');
    assert(calls === 2);
  });
  await test('Reauthorization resumes without another connect-time upload', async () => {
    let posts = 0, puts = 0, reconnects = 0;
    const api = new DriveClient(account, controller.signal, (async (_url, init) => {
      if (init?.method === 'POST') { posts++; return new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=reauth' } }); }
      if (init?.method === 'PUT' && ++puts === 1) return json({}, 401);
      return json(remote);
    }) as typeof fetch, () => undefined, async () => { reconnects++; return { ...account, token: 'renewed-token' }; });
    await api.upload('folder', bytes, 'test-backup', 'test.coffeeos');
    assert(posts === 1 && puts === 2 && reconnects === 1);
  });
  await test('Reauthorization rejects a different account before transfer', async () => {
    let calls = 0;
    const api = new DriveClient({ ...account, expiresAt: 0 }, controller.signal,
      (async () => { calls++; return json({}); }) as typeof fetch, () => undefined,
      async () => ({ ...account, sub: 'different' }));
    await rejects(() => api.history(), 'original Google account'); assert(calls === 0);
  });
  await test('Drive errors identify the failed step without copying server data', async () => {
    const privateMessage = 'private-account-and-file-contents';
    const api = client(async () => json({ error: { message: privateMessage,
      errors: [{ reason: 'accessNotConfigured' }] } }, 403));
    try { await api.history(); throw new Error('Expected denied request'); }
    catch (error) {
      assert(error instanceof DriveError);
      assert(error.message.includes('Read backup history') && error.message.includes('HTTP 403'));
      assert(error.message.includes('Drive API is not enabled') && !error.message.includes(privateMessage));
    }
  });
  await test('Upload initiation failure retains its request phase', async () => {
    await rejects(() => client(async (_url, init) => init?.method === 'POST'
      ? json({ error: { errors: [{ reason: 'insufficientPermissions' }] } }, 403)
      : json({ files: [] })).upload('folder', bytes, 'test-backup', 'test.coffeeos'), 'Start backup upload failed (HTTP 403)');
  });
  await test('Network errors do not expose transport messages', async () => {
    await rejects(() => client(async (_url, init) => {
      if (init?.method === 'POST') throw new TypeError('private URL with a credential');
      return json({ files: [] });
    }).upload('folder', bytes, 'test-backup', 'test.coffeeos'), 'Start backup upload could not reach Google');
  });
  return results;
}

/** Explicit diagnostic upload + pinned download + read-only restore staging. */
export async function testDriveRoundTrip(client: DriveClient, signal: AbortSignal): Promise<string> {
  const { snapshot, revision } = await captureDriveSnapshot();
  if (snapshot.counts.beans + snapshot.counts.brew_sessions === 0) throw new DriveError('Add some records before testing a Drive round trip. No empty upload was created.');
  const file = await packageBackup(snapshot);
  const { manifest } = await unpackBackup(file.data);
  const folder = await client.folder(true);
  const remote = await client.upload(folder!, file.data, manifest.backup_id, file.name);
  const downloaded = await client.download(remote);
  if (await sha256(downloaded) !== await sha256(file.data)) throw new DriveError('Round-trip archive bytes differ. No local records were written.');
  const prepared = await prepareBackup(downloaded);
  await verifyDriveRoundTrip(prepared.files, snapshot.counts, revision, signal);
  return `PASS live Drive round trip: ${file.data.length} bytes, ${snapshot.counts.beans} beans, ${snapshot.counts.brew_sessions} sessions. Exact archive hash and every stored field matched. Restore staging rolled back without record writes. The uploaded snapshot was kept.`;
}

