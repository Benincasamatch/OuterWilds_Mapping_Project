// Build a local-only diagnostic wrapper around the UNMODIFIED production bundle.
// Not included in release packages. Sends only renderer/test counters to loopback.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mode=process.argv[2] || 'natural';
if(!['natural','idle','active','peak'].includes(mode)) throw new Error('Unknown diagnostic mode');
const output=path.join(root,'.desktop-test','runtime-'+mode);
fs.mkdirSync(output,{recursive:true});
const bundle=fs.readFileSync(path.join(root,'wallpaper/bundle.js'));
fs.writeFileSync(path.join(output,'bundle.js'),bundle);
const project=JSON.parse(fs.readFileSync(path.join(root,'wallpaper/project.json'),'utf8'));
project.title='OW Desktop Acceptance — '+mode; delete project.preview;
fs.writeFileSync(path.join(output,'project.json'),JSON.stringify(project,null,2));
const observer=`<script>
(function(){
  const mode=${JSON.stringify(mode)}, session=mode+'-'+Date.now().toString(36);
  const ow=window.OW; const pending=new Set();
  let sample=null,ticks=0,ptr=0,down=0,wheel=0,drag=0,held=false,x=0,y=0,lastDraws=0,lastTime=performance.now();
  const windows={idle:[10,40],active:[200,260],peak:[1319,1324]};
  function send(event, data){
    const image=new Image();pending.add(image);image.onload=image.onerror=()=>pending.delete(image);
    image.src='http://127.0.0.1:8124/beacon?ev='+event+'&session='+session+'&payload='+encodeURIComponent(JSON.stringify(data));
  }
  if(!ow?.world){send('error',{message:'world did not start'});return;}
  const advance=ow.clock.advance;
  ow.clock.advance=function(dt,rate){
    if(windows[mode]&&!ow.clock.hidden){const range=windows[mode];if(ow.clock.t<range[0]||ow.clock.t>=range[1])ow.clock.seek(range[0]);}
    return advance(dt,rate);
  };
  let patched=null;
  function patch(){if(patched===ow.world)return;patched=ow.world;const fn=patched.sample;
    patched.sample=function(t,o){sample=fn(t,o);ticks++;return sample;};}
  patch();
  addEventListener('pointerdown',e=>{down++;held=true;x=e.clientX;y=e.clientY;});
  addEventListener('pointerup',()=>held=false);
  addEventListener('pointermove',e=>{ptr++;if(held)drag+=Math.hypot(e.clientX-x,e.clientY-y);x=e.clientX;y=e.clientY;});
  addEventListener('wheel',()=>wheel++,{passive:true});
  const listener=window.wallpaperPropertyListener, paused=listener.setPaused;
  listener.setPaused=function(value){send('hostpause',{value,t:ow.clock.t,draws:ow.scene.stats.draws});paused(value);};
  send('runtimeboot',{mode,bundleHash:${JSON.stringify(crypto.createHash('sha256').update(bundle).digest('hex'))},capability:ow.capability});
  setInterval(()=>{
    patch();const now=performance.now(),canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl2');
    const draws=ow.scene.stats.draws;
    send('metric',{mode,t:ow.clock.t,totalS:ow.clock.totalS,wraps:ow.clock.wraps,ticks,draws,drawFps:(draws-lastDraws)*1000/(now-lastTime),
      hidden:document.hidden,suspended:ow.playback.suspended,particles:sample?.particleCount,flash:sample?.sun.flash,endgame:sample?.flags.endgame,
      css:[innerWidth,innerHeight],pixels:[canvas.width,canvas.height],dpr:devicePixelRatio,viewport:Array.from(gl.getParameter(gl.VIEWPORT)),
      ptr,down,wheel,drag:Math.round(drag),camera:[ow.camera.yaw,ow.camera.pitch,ow.camera.distance],uptime:now/1000});
    lastTime=now;lastDraws=draws;
  },5000);
})();
</script>`;
const html=fs.readFileSync(path.join(root,'wallpaper/index.html'),'utf8').replace('</body>',observer+'\n</body>');
fs.writeFileSync(path.join(output,'index.html'),html);
console.log(JSON.stringify({mode,output,bundleHash:crypto.createHash('sha256').update(bundle).digest('hex')}));
