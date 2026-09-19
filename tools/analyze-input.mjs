// Read-only classifier. Absence of input is not evidence of an unsupported host.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
export function analyzeInput(text, { attempted = false } = {}) {
  const records=[];
  for(const line of text.split(/\r?\n/)) {
    const query=line.match(/\/beacon\?([^\s]+)/)?.[1];
    if(query) records.push(Object.fromEntries(new URLSearchParams(query)));
  }
  const boot=records.findLastIndex(r=>r.ev==='boot');
  if(boot<0) return {status:'inconclusive',reason:'No startup beacon. Check the receiver and page loading.'};
  const session=records[boot].session;
  const samples=records.slice(boot).filter(r=>r.ev==='summary' && r.session===session);
  const usable=samples.filter(s=>s.frames!==undefined && s.uptime!==undefined && s.vis==='visible' && s.paused==='false');
  const first=usable[0], last=usable.at(-1);
  const live=usable.length>=2 && Number(last.uptime)-Number(first.uptime)>=4 && Number(last.frames)-Number(first.frames)>=10;
  if(!live) return {status:'inconclusive',reason:'Missing sustained, visible, unpaused frame activity. Zero input cannot establish host support.',samples:samples.length};
  const drag=Number(last.drag)>40 && Number(last.pdown)>0, wheel=Number(last.wheel)>0;
  if(drag && wheel) return {status:'pass',drag:true,wheel:true,reason:'This session received a drag and wheel while rendering. Verify that it was a DESKTOP session, not a preview.'};
  return {status:attempted?'not-received':'awaiting-input',drag,wheel,reason:attempted?'The page was live, but required input was not received in this session. Check foreground, monitor and host settings; do not infer universal incompatibility.':'Page is live. Perform a left drag and wheel on the target desktop before classifying input delivery.'};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const file=process.argv[2] || 'spike/beacon-desktop.log';
  const result=analyzeInput(fs.readFileSync(file,'utf8'),{attempted:process.argv.includes('--attempted')});
  console.log(JSON.stringify(result,null,2));
}
