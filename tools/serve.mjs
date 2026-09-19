// Local-only development server; never included in the wallpaper package.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json', '.css':'text/css', '.jpg':'image/jpeg', '.png':'image/png', '.md':'text/plain; charset=utf-8' };
export function createServer(root = ROOT) {
  const base = fs.realpathSync(root);
  const inside = (file) => { const rel=path.relative(base,file); return !rel.startsWith('..') && !path.isAbsolute(rel); };
  return http.createServer((req,res) => {
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    let url;
    try { url=decodeURIComponent((req.url || '/').split('?')[0]); } catch { res.writeHead(400).end(); return; }
    if (url.includes('\0') || url.includes('\\')) { res.writeHead(400).end(); return; }
    let target=path.resolve(base, '.'+url);
    if (!inside(target)) { res.writeHead(403).end(); return; }
    try {
      target=fs.realpathSync(target);
      if (!inside(target)) { res.writeHead(403).end(); return; }
      if (fs.statSync(target).isDirectory()) target=fs.realpathSync(path.join(target,'index.html'));
      if (!inside(target)) { res.writeHead(403).end(); return; }
      if (!fs.statSync(target).isFile()) { res.writeHead(404).end(); return; }
    } catch { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type':TYPES[path.extname(target)] || 'application/octet-stream', 'cache-control':'no-store' });
    if(req.method==='HEAD') { res.end(); return; }
    fs.createReadStream(target).on('error',()=>res.destroy()).pipe(res);
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const port=Number(process.env.PORT || 8123);
  createServer().listen(port,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:'+port+'/wallpaper/'));
}
