// Throwaway beacon receiver for the Phase 0 input probe (spike/input-probe-color).
// The probe page inside Wallpaper Engine fires image beacons at this port; every hit is
// appended to spike/beacon.log so the counters can be read as text instead of pixels.
// Usage: node spike/beacon-server.mjs   (listens on 127.0.0.1:8124)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOG = process.env.BEACON_LOG
  ? path.resolve(process.env.BEACON_LOG)
  : path.join(HERE, 'beacon.log');
const PORT = Number(process.env.BEACON_PORT || 8124);

fs.appendFileSync(LOG, '\n# receiver started ' + new Date().toISOString() + '\n');
const server = http.createServer((req, res) => {
  const line = new Date().toISOString().slice(11, 23) + ' ' + req.method + ' ' + req.url;
  fs.appendFileSync(LOG, line + '\n');
  console.log(line);
  res.writeHead(200, { 'content-type': 'image/gif', 'cache-control': 'no-store' });
  res.end(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
});
server.on('clientError', (err, socket) => socket.destroy());
server.listen(PORT, '127.0.0.1', () => console.log(`beacon receiver on http://127.0.0.1:${PORT}/  ->  ${LOG}`));
