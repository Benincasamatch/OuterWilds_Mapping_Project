import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ROOT } from './serve.mjs';
import { buildBundle } from './build-bundle.mjs';
export const PENDING = ['visual-match-original','portrait-desktop-input','continuous-idle-performance','full-duration-active-performance','specified-resolution-performance','multi-monitor-extended-performance','wall-clock-and-sleep-resume','visual-review','fan-policy-final-review','workshop-upload-user-approval'];
export function buildPackage({ root = ROOT, outRoot = path.join(root, 'dist') } = {}) {
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  if(!/^[\w.-]+$/.test(pkg.version)) throw new Error('Invalid package version');
  const output=path.resolve(outRoot,'outerwilds-wallpaper-'+pkg.version);
  const relative=path.relative(path.resolve(outRoot),output);
  if(relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Output escapes distribution root');
  const files={ 'index.html':'wallpaper/index.html', 'bundle.js':'wallpaper/bundle.js', 'project.json':'wallpaper/project.json', 'preview.jpg':'wallpaper/preview.jpg', LICENSE:'LICENSE', 'NOTICE.md':'NOTICE.md', 'README.md':'docs/DELIVERY.md', 'STATUS.md':'STATUS.md' };
  for(const source of Object.values(files)) if(!fs.statSync(path.join(root,source)).isFile()) throw new Error('Missing package input: '+source);
  const bundle=fs.readFileSync(path.join(root,'wallpaper/bundle.js'),'utf8');
  if(bundle!==buildBundle({dir:path.join(root,'wallpaper')}).content) throw new Error('Stale bundle; run npm run verify');
  const project=JSON.parse(fs.readFileSync(path.join(root,'wallpaper/project.json'),'utf8'));
  if(project.file!=='index.html' || project.preview!=='preview.jpg' || project.type!=='web') throw new Error('Unexpected project entries');
  if(!project.description.includes('unofficial Fan Content')) throw new Error('Fan-content disclaimer is required');
  if(fs.existsSync(output)) {
    if(fs.lstatSync(output).isSymbolicLink()) throw new Error('Refusing a symlink output');
    const allowed=new Set([...Object.keys(files),'acceptance.json','manifest.json']);
    for(const name of fs.readdirSync(output)) {
      const st=fs.lstatSync(path.join(output,name));
      if(!allowed.has(name) || !st.isFile() || st.isSymbolicLink()) throw new Error('Unexpected output item; use a fresh output directory: '+name);
    }
  }
  fs.mkdirSync(output,{recursive:true});
  for(const [name,source] of Object.entries(files)) fs.copyFileSync(path.join(root,source),path.join(output,name));
  fs.writeFileSync(path.join(output,'acceptance.json'),JSON.stringify({version:pkg.version,status:'local-prerelease',workshopReady:false,pending:PENDING},null,2)+'\n');
  const hashes={};
  for(const name of [...Object.keys(files),'acceptance.json'].sort()) {
    const data=fs.readFileSync(path.join(output,name));
    hashes[name]={bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')};
  }
  fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({version:pkg.version,files:hashes},null,2)+'\n');
  return {output,files:Object.keys(hashes),workshopReady:false};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(buildPackage(),null,2));
