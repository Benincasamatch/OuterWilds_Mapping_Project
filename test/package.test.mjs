import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildPackage, PENDING } from '../tools/build-package.mjs';
function temporary(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ow-package-'));
  t.after(()=>{
    const target=path.resolve(root), parent=path.resolve(os.tmpdir());
    assert.equal(path.dirname(target),parent);assert.ok(path.basename(target).startsWith('ow-package-'));
    fs.rmSync(target,{recursive:true,force:true});
  });
  return root;
}
test('package is standalone, allowlisted, hashed and explicitly not release-ready',t=>{
  const {output,files}=buildPackage({outRoot:temporary(t)});
  assert.equal(files.length,9);
  const state=JSON.parse(fs.readFileSync(path.join(output,'acceptance.json'),'utf8'));
  assert.equal(state.workshopReady,false);assert.deepEqual(state.pending,PENDING);
  const manifest=JSON.parse(fs.readFileSync(path.join(output,'manifest.json'),'utf8'));
  for(const [name,entry] of Object.entries(manifest.files)) {
    const bytes=fs.readFileSync(path.join(output,name));
    assert.equal(entry.bytes,bytes.length);
    assert.equal(entry.sha256,crypto.createHash('sha256').update(bytes).digest('hex'));
  }
  for(const name of ['spike','test','tools','data','beacon.log']) assert.equal(fs.existsSync(path.join(output,name)),false);
  assert.ok(fs.readFileSync(path.join(output,'README.md'),'utf8').includes('(preview.jpg)'));
});
test('package rebuilds deterministically and refuses unknown output files',t=>{
  const outRoot=temporary(t);const {output}=buildPackage({outRoot});
  const before=fs.readFileSync(path.join(output,'manifest.json'),'utf8');
  buildPackage({outRoot});assert.equal(fs.readFileSync(path.join(output,'manifest.json'),'utf8'),before);
  fs.writeFileSync(path.join(output,'user-note.txt'),'keep me');
  assert.throws(()=>buildPackage({outRoot}),/Unexpected output item/);
  assert.equal(fs.readFileSync(path.join(output,'user-note.txt'),'utf8'),'keep me');
});
