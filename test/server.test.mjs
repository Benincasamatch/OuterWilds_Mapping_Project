import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../tools/serve.mjs';
const server=createServer();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
test.after(()=>new Promise(resolve=>server.close(resolve)));
function request(url,method='GET') {
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:url,method},res=>{
      let text='';res.setEncoding('utf8');res.on('data',s=>text+=s);res.on('end',()=>resolve({status:res.statusCode,text}));
    });req.on('error',reject);req.end();
  });
}
test('local server serves the wallpaper and HEAD without a body',async()=>{
  const r=await request('/wallpaper/');assert.equal(r.status,200);assert.ok(r.text.includes('bundle.js'));
  const head=await request('/wallpaper/index.html','HEAD');assert.equal(head.status,200);assert.equal(head.text,'');
});
test('local server rejects traversal, malformed URLs and unsupported methods',async()=>{
  assert.equal((await request('/../package.json')).status,403);
  assert.equal((await request('/%2e%2e/package.json')).status,403);
  assert.equal((await request('/%ZZ')).status,400);
  assert.equal((await request('/%00')).status,400);
  assert.equal((await request('/wallpaper/','POST')).status,405);
  assert.equal((await request('/missing-file')).status,404);
  assert.equal((await request('/wallpaper/')).status,200,'server survives malformed input');
});
