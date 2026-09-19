import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
// This report deliberately does not equate pixel/counter measurements to release readiness.
export function decodeMetrics(text) {
  const output=[];
  for(const line of text.split(/\r?\n/)) {
    const query=line.match(/\/beacon\?([^\s]+)/)?.[1];
    if(!query)continue;
    const p=new URLSearchParams(query);if(!['metric','runtimeboot','hostpause'].includes(p.get('ev')))continue;
    try {output.push({time:line.slice(0,12),event:p.get('ev'),session:p.get('session'),...JSON.parse(p.get('payload'))});}catch{}
  }
  return output;
}
export function summarizeRun(samples,metrics,{mode,expectedSeconds=600}={}) {
  if(!samples.length)return {status:'inconclusive',reason:'No performance samples'};
  const first=Date.parse(samples[0].utc)-samples[0].intervalS*1000,last=Date.parse(samples.at(-1).utc);
  // Receiver timestamps are UTC time-of-day; the sampler's date anchors the session.
  const anchor=samples[0].utc.slice(0,10);
  const inWindow=m=>{
    let stamp=Date.parse(anchor+'T'+m.time+'Z');
    if(stamp<first-43200000)stamp+=86400000;
    return stamp>=first-6000 && stamp<=last+6000;
  };
  const observed=metrics.filter(m=>m.event==='metric'&&m.mode===mode&&inWindow(m));
  const sessions=[...new Set(observed.map(m=>m.session))];
  const total=samples.reduce((v,s)=>v+s.intervalS,0);
  const average=(key)=>samples.reduce((v,s)=>v+s[key]*s.intervalS,0)/total;
  const validGpu=samples.filter(s=>s.gpuValid&&Number.isFinite(s.gpuEngineSumPct));
  const metric=(key,fn)=>observed.length?fn(observed.map(m=>m[key])):null;
  const gaps=observed.slice(1).map((m,i)=>m.uptime-observed[i].uptime);
  const maxMetricGapS=gaps.length?Math.max(...gaps):null;
  const monotoneDraws=observed.slice(1).every((m,i)=>m.draws>observed[i].draws);
  const liveness=monotoneDraws && maxMetricGapS<=8 && observed.length>=Math.floor(expectedSeconds/5)*0.85 && sessions.length===1 && observed.every(m=>!m.hidden&&!m.suspended) &&
    observed.at(-1).draws>observed[0].draws && observed.at(-1).uptime-observed[0].uptime>=expectedSeconds-15;
  const sameResolution=observed.length>0&&observed.every(m=>JSON.stringify(m.pixels)===JSON.stringify(observed[0].pixels));
  const elapsed=samples.at(-1).elapsedS;
  const idleCorrect=mode!=='idle'||observed.every(m=>m.particles===0&&m.flash===0&&!m.endgame);
  return {
    status:elapsed>=expectedSeconds&&liveness&&sameResolution&&idleCorrect&&validGpu.length===samples.length?'measured':'inconclusive',
    mode,elapsedS:elapsed,samples:samples.length,metricSamples:observed.length,maxMetricGapS,monotoneDraws,sessions,liveness,sameResolution,idleCorrect,
    cpuAveragePct:average('cefAndUiCpuPct'),cpuMaxPct:Math.max(...samples.map(s=>s.cefAndUiCpuPct)),
    hostCpuAveragePct:average('hostCpuPct'),workingSetAverageMB:average('cefAndUiWorkingSetMB'),
    workingSetFirstMB:samples[0].cefAndUiWorkingSetMB,workingSetLastMB:samples.at(-1).cefAndUiWorkingSetMB,
    gpuValidSamples:validGpu.length,gpuMissingSamples:samples.length-validGpu.length,
    gpuEngineSumAveragePct:validGpu.length?validGpu.reduce((v,s)=>v+s.gpuEngineSumPct,0)/validGpu.length:null,
    gpuEngineSumMaxPct:validGpu.length?Math.max(...validGpu.map(s=>s.gpuEngineSumPct)):null,
    drawFpsAverage:metric('drawFps',a=>a.reduce((a,b)=>a+b,0)/a.length),
    css:observed[0]?.css,framebuffer:observed[0]?.pixels,dpr:observed[0]?.dpr,
    bundleHashes:metrics.filter(m=>m.event==='runtimeboot'&&sessions.includes(m.session)).map(m=>m.bundleHash),
    notes:'Measured at the reported framebuffer, NOT automatically the planned 2560x1600. GPU numbers are process engine sums. CPU/WS include all webwallpaper64 and wallpaperui processes. Controlled idle/active wrappers repeat the declared timeline window; peak repeatedly replays the supernova window. Compare natural/multiscreen separately.',
  };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [prefix,log]=process.argv.slice(2);if(!prefix||!log)throw new Error('Usage: node tools/summarize-host.mjs <run-prefix> <beacon-log>');
  const metrics=decodeMetrics(fs.readFileSync(log,'utf8'));
  const result=[];
  for(const mode of ['idle','active','peak']){
    const file=prefix+'-'+mode+'-samples.jsonl';if(!fs.existsSync(file))continue;
    const samples=fs.readFileSync(file,'utf8').trim().split(/\r?\n/).filter(Boolean).map(s=>JSON.parse(s));
    result.push(summarizeRun(samples,metrics,{mode,expectedSeconds:mode==='peak'?60:600}));
  }
  fs.writeFileSync(prefix+'-combined.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
}
