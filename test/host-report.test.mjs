import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeMetrics, summarizeRun } from '../tools/summarize-host.mjs';
function fixture(){
  const samples=[],metrics=[{event:'runtimeboot',session:'a',bundleHash:'hash'}];
  for(let i=1;i<=120;i++){
    const utc=new Date(Date.UTC(2026,8,19,0,0,i*5)).toISOString();
    samples.push({utc,elapsedS:i*5,intervalS:5,cefAndUiCpuPct:.2,hostCpuPct:.1,cefAndUiWorkingSetMB:400,gpuValid:true,gpuEngineSumPct:2});
    metrics.push({time:utc.slice(11,23),event:'metric',mode:'idle',session:'a',uptime:i*5,draws:i*75,drawFps:15,particles:0,flash:0,endgame:false,hidden:false,suspended:false,pixels:[1920,1080],css:[1280,720],dpr:2});
  }
  return {samples,metrics};
}
test('performance report requires duration, liveness and actual resolution',()=>{
  const f=fixture();const r=summarizeRun(f.samples,f.metrics,{mode:'idle'});
  assert.equal(r.status,'measured');assert.equal(r.liveness,true);assert.deepEqual(r.framebuffer,[1920,1080]);
  assert.ok(Math.abs(r.cpuAveragePct-.2)<1e-8);assert.deepEqual(r.bundleHashes,['hash']);
  assert.equal(summarizeRun(f.samples.slice(0,4),f.metrics,{mode:'idle'}).status,'inconclusive');
});
test('a frozen or paused renderer never passes based on low process CPU',()=>{
  const f=fixture();for(const m of f.metrics)m.suspended=true;
  assert.equal(summarizeRun(f.samples,f.metrics,{mode:'idle'}).status,'inconclusive');
  assert.equal(summarizeRun(f.samples,[],{mode:'idle'}).status,'inconclusive');
});
test('idle report rejects active events, changing render size, restarts and missing GPU data',()=>{
  for(const scenario of ['events','resize','restart','gpu']){
    const f=fixture();
    if(scenario==='events')f.metrics[50].particles=1;
    if(scenario==='resize')f.metrics[50].pixels=[800,600];
    if(scenario==='restart')f.metrics[50].session='b';
    if(scenario==='gpu')f.samples[50].gpuValid=false;
    assert.equal(summarizeRun(f.samples,f.metrics,{mode:'idle'}).status,'inconclusive',scenario);
  }
});
test('beacon payload parser ignores unrelated and malformed data',()=>{
  const line='00:00:05.000 GET /beacon?ev=metric&session=a&payload='+encodeURIComponent(JSON.stringify({mode:'idle',draws:5}));
  assert.equal(decodeMetrics(line+'\nGET /beacon?ev=metric&payload=bad\nGET /beacon?ev=summary').length,1);
});

test('missing heartbeat gaps and stagnant draw counts invalidate a continuous run',()=>{
  const f=fixture();f.metrics.splice(40,4);
  assert.equal(summarizeRun(f.samples,f.metrics,{mode:'idle'}).status,'inconclusive');
  const g=fixture();g.metrics[45].draws=g.metrics[44].draws;
  assert.equal(summarizeRun(g.samples,g.metrics,{mode:'idle'}).status,'inconclusive');
});
