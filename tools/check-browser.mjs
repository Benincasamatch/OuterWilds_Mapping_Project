// Optional real-browser acceptance checks. Uses an installed Playwright + browser.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createServer, ROOT } from './serve.mjs';
import { analyzeInput } from './analyze-input.mjs';
const require=createRequire(import.meta.url);
const { chromium }=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const report={ date:new Date().toISOString(), checks:[], errors:[] };
const dir=path.join(ROOT,'.browser-test'); fs.mkdirSync(dir,{recursive:true});
const server=createServer(); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port+'/wallpaper/';
let browser;
try {
  browser=await chromium.launch({ headless:true, executablePath:process.env.BROWSER_EXECUTABLE || undefined });
  const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1.5});
  context.on('page', p => p.on('pageerror', e => report.errors.push(e.message)));
  const page=await context.newPage();
  const requests=[];
  page.on('request',req=>requests.push(req.url()));
  page.on('console',msg=>{ if(msg.type()==='error') report.errors.push(msg.text()); });
  await page.goto(url);
  await page.waitForFunction(()=>window.OW?.scene?.stats.draws>2);
  report.renderer=await page.evaluate(()=>OW.capability);
  assert.equal(await page.locator('#fallback').isVisible(),false);
  assert.equal(await page.evaluate(()=>document.querySelector('canvas').getContext('webgl2').getError()),0, 'startup GL error');
  report.checks.push('WebGL2 startup');
  assert.deepEqual(await page.evaluate(()=>{const c=document.querySelector('canvas'),g=c.getContext('webgl2');return Array.from(g.getParameter(g.VIEWPORT));}),[0,0,1920,1200]);
  report.checks.push('150% DPI viewport matches framebuffer');
  const yaw=await page.evaluate(()=>OW.camera.yaw);
  await page.mouse.move(640,400); await page.mouse.down(); await page.mouse.move(760,450,{steps:12}); await page.mouse.up();
  await page.waitForFunction(y=>Math.abs(OW.camera.yaw-y)>0.4,yaw);
  const distance=await page.evaluate(()=>OW.camera.distance);
  await page.mouse.wheel(0,-300);
  await page.waitForFunction(d=>OW.camera.distance<d*0.8,distance);
  report.checks.push('real browser drag and wheel');
  const buttonDistance=await page.evaluate(()=>OW.camera.distance);
  await page.getByRole('button',{name:'放大 / Zoom in',exact:true}).click();
  await page.waitForFunction(d=>OW.camera.distance<d*0.85,buttonDistance);
  await page.getByRole('button',{name:'重置视角 / Reset view',exact:true}).click();
  await page.waitForFunction(()=>Math.abs(OW.camera.distance-12000)<5);
  await page.evaluate(()=>wallpaperPropertyListener.applyUserProperties({showcontrols:{value:false}}));
  assert.equal(await page.locator('#controls').isVisible(),false);
  await page.evaluate(()=>wallpaperPropertyListener.applyUserProperties({showcontrols:{value:true}}));
  assert.equal(await page.locator('#controls').isVisible(),true);
  report.checks.push('mouse-only zoom/reset controls and host visibility property');
  await page.evaluate(()=>wallpaperPropertyListener.setPaused(true));
  const frozen=await page.evaluate(()=>({t:OW.clock.t,draws:OW.scene.stats.draws}));
  await page.waitForTimeout(350);
  assert.deepEqual(await page.evaluate(()=>({t:OW.clock.t,draws:OW.scene.stats.draws})),frozen);
  await page.evaluate(()=>wallpaperPropertyListener.setPaused(false));
  await page.waitForFunction(t=>OW.clock.t>t+0.05,frozen.t);
  report.checks.push('host pause stops simulation and rendering, resume continues');
  await page.evaluate(()=>{ wallpaperPropertyListener.applyUserProperties({showhud:{value:true},compression:{value:0.6}}); });
  await page.waitForFunction(()=>document.querySelector('.ow-hud-head').textContent.includes('p=0.60'));
  assert.equal(await page.evaluate(()=>OW.props.compression),0.6);
  report.checks.push('host properties update live world and HUD');
  await page.evaluate(()=>wallpaperPropertyListener.applyGeneralProperties({fps:5}));
  const draws=await page.evaluate(()=>OW.scene.stats.draws);
  await page.waitForTimeout(1200);
  const drawsAfter=await page.evaluate(()=>OW.scene.stats.draws);
  assert.ok(drawsAfter-draws<=7 && drawsAfter-draws>=3, 'host FPS limit not respected');
  report.checks.push('global host FPS cap');
  await page.evaluate(()=>{
    window.worldResets=0; const reset=OW.world.reset;
    OW.world.reset=()=>{worldResets++;reset();};
    OW.clock.setMode('wall-clock'); OW.clock.setHidden(true); OW.clock.setHidden(false,2730);
  });
  await page.waitForFunction(()=>worldResets===1);
  await page.evaluate(()=>{OW.clock.setMode('paused-loop');});
  report.checks.push('multi-cycle resume resets stateful world even when cycle time increases');
  await page.evaluate(()=>{wallpaperPropertyListener.applyGeneralProperties({fps:30});window.oldScene=OW.scene;window.loseContext=document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context');loseContext.loseContext();});
  await page.waitForFunction(()=>document.querySelector('#fallback').style.display==='flex');
  await page.evaluate(()=>loseContext.restoreContext());
  await page.waitForFunction(()=>OW.scene!==oldScene && OW.scene.stats.draws>2);
  assert.equal(await page.locator('#fallback').isVisible(),false);
  assert.equal(await page.evaluate(()=>document.querySelector('canvas').getContext('webgl2').getError()),0);
  report.checks.push('context restoration recreates renderer and resumes without GL errors');
  await page.screenshot({path:path.join(dir,'integration.png')});
  // A file URL is the same resource-loading path used by the desktop host.
  const offline=await context.newPage(); const external=[];
  offline.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
  await offline.goto(pathToFileURL(path.join(ROOT,'wallpaper/index.html')).href);
  await offline.waitForFunction(()=>window.OW?.scene?.stats.draws>2);
  assert.deepEqual(external,[]);
  report.checks.push('file:// launch with zero HTTP requests');
  const probe=await context.newPage(); const beacons=[];
  await probe.route('http://127.0.0.1:8124/beacon?**',async route=>{
    const u=new URL(route.request().url()); beacons.push('GET '+u.pathname+u.search);
    await route.fulfill({contentType:'image/gif',body:Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64')});
  });
  await probe.goto(url.replace('/wallpaper/','/spike/input-probe/'));
  await probe.mouse.move(500,400);await probe.mouse.down();await probe.mouse.move(650,420,{steps:8});await probe.mouse.up();await probe.mouse.wheel(0,120);
  await probe.waitForTimeout(10500);
  const summaryCount=beacons.filter(x=>x.includes('ev=summary')).length;
  assert.ok(summaryCount>=3,'probe summary was throttled again');
  assert.equal(analyzeInput(beacons.join('\n'),{attempted:true}).status,'pass');
  report.checks.push('probe emits 5-second liveness and classifies received drag + wheel');
  await probe.close();
  if(process.argv.includes('--package')) {
    const version=JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')).version;
    const packaged=await context.newPage();const remote=[];
    packaged.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url());});
    await packaged.goto(pathToFileURL(path.join(ROOT,'dist','outerwilds-wallpaper-'+version,'index.html')).href);
    await packaged.waitForFunction(()=>window.OW?.scene?.stats.draws>2);
    assert.deepEqual(remote,[]);
    assert.equal(await packaged.evaluate(()=>document.querySelector('canvas').getContext('webgl2').getError()),0);
    report.checks.push('standalone distribution loads offline without GL errors');
    await packaged.close();
  }
  // Generate the Workshop cover from the actual renderer, not third-party art.
  if(process.argv.includes('--preview')) {
    const coverContext=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1});
    const cover=await coverContext.newPage(); await cover.goto(url); await cover.waitForFunction(()=>window.OW?.scene?.stats.draws>2);
    await cover.evaluate(()=>{wallpaperPropertyListener.applyUserProperties({showcontrols:{value:false}}); OW.camera.setState({distance:36000,yaw:0.6,pitch:0.85}); OW.camera.snap(); OW.clock.seek(45);});
    await cover.waitForTimeout(600);
    await cover.evaluate(()=>{
      const heading=document.createElement('div'); heading.style.cssText='position:fixed;left:90px;top:70px;color:#f3eee3;font-family:Georgia,serif;pointer-events:none';
      const tag=document.createElement('div');tag.textContent='A PROCEDURAL SOLAR SYSTEM';tag.style.cssText='font:16px Consolas,monospace;letter-spacing:6px;color:#e5b878;margin-bottom:20px';
      const title=document.createElement('div');title.textContent='OUTER WILDS';title.style.cssText='font-size:76px;letter-spacing:4px';
      const sub=document.createElement('div');sub.textContent='A living orrery · 22-minute loop';sub.style.cssText='font-size:25px;margin-top:15px;color:#aab6bd';
      heading.append(tag,title,sub);document.body.append(heading);
      const foot=document.createElement('div');foot.textContent='非官方同人作品 / UNOFFICIAL FAN WALLPAPER · NOT ENDORSED BY MOBIUS DIGITAL';foot.style.cssText='position:fixed;left:90px;bottom:55px;color:#b5bfc5;font:15px Consolas,monospace;letter-spacing:1px';document.body.append(foot);
    });
    await cover.screenshot({path:path.join(ROOT,'wallpaper/preview.jpg'),type:'jpeg',quality:92});
    report.checks.push('1920x1080 preview generated from the scene');
    await coverContext.close();
  }
  assert.deepEqual(report.errors,[]);
  report.status='PASS';
} catch(error) { report.status='FAIL'; report.failure=String(error.stack || error); process.exitCode=1; }
finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2)); }
