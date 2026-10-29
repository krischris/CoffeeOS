import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
export async function startFixtureServer(root, initialBuild = 'candidate') {
  const faults = {build: initialBuild, failStartup: false, failPhotoMigration: '', failWorker: ''};
  const mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm'};
  const server = createServer(async (req, res) => {
    try {
      const {build, failStartup, failPhotoMigration, failWorker} = faults;
      const requested = new URL(req.url, 'http://localhost');
      const path = requested.pathname;
      if (!path.startsWith('/CoffeeOS/')) { res.writeHead(404).end(); return; }
      const relative = path.slice('/CoffeeOS/'.length) || 'index.html';
      let data = await readFile(resolve(root, build, relative));
      // This matrix injects network HTML/worker startup faults. Use the isolation
      // template here so an intentional immutable shell cannot hide those probes.
      // offline-browser.mjs verifies actual production worker/build replacement.
      if (relative === 'coi-serviceworker.js') data = await readFile('public/coi-serviceworker.js');
      if (relative.includes('.worker-') && requested.searchParams.has('startup-failure')) {
        data = Buffer.from(requested.searchParams.get('startup-failure') === 'error' ? "throw new Error('Injected database worker load failure');" : '');
      }
      if (relative === 'index.html' && failWorker) data = Buffer.from(data.toString().replace('<head>', `<head><script>
        const RealWorker=Worker;window.Worker=class extends RealWorker{constructor(url,options){const target=new URL(url,location.href);let injected;
          if(target.protocol==='blob:')injected=URL.createObjectURL(new Blob([${JSON.stringify(failWorker === 'error' ? "throw new Error('Injected database worker load failure');" : '')}],{type:'text/javascript'}));
          else target.searchParams.set('startup-failure','${failWorker}');super(injected||target,options);if(injected)URL.revokeObjectURL(injected);if('${failWorker}'==='message')setTimeout(()=>this.dispatchEvent(new MessageEvent('messageerror')),0);}};
        const realTimeout=window.setTimeout;window.setTimeout=(fn,delay,...args)=>realTimeout(fn,delay===120000?100:delay,...args);
      </script>`));
      if (relative === 'index.html' && failStartup) data = Buffer.from(data.toString().replace('<head>', "<head><script>window.__nativeIndexedDBOpen=indexedDB.open;indexedDB.open = () => {throw new Error('Injected upgrade permission failure');};</script>"));
      if (relative === 'index.html' && failPhotoMigration) data = Buffer.from(data.toString().replace('<head>', `<head><script>window.__failPhotoMigration=${failPhotoMigration === 'alter'}; const put=IDBObjectStore.prototype.put; IDBObjectStore.prototype.put=function(value,key){if(${failPhotoMigration === 'copy'} && key==='schema-v1-before-photos') throw new Error('Injected recovery-copy failure');return put.call(this,value,key);};</script>`));
      res.writeHead(200, {'Content-Type': mime[extname(relative)] ?? 'application/octet-stream',
        'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cache-Control': 'no-store'});
      res.end(relative === 'coi-serviceworker.js' ? Buffer.concat([data, Buffer.from('\n// Upgrade fixture: ' + build)]) : data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5175, '127.0.0.1', resolve); });
  return {faults, close: () => new Promise((done, reject) => server.close(error => error ? reject(error) : done()))};
}
