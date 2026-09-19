import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeInput } from '../tools/analyze-input.mjs';
const boot='GET /beacon?ev=boot&session=a';
const sample=(time,frames,extra='')=>'GET /beacon?ev=summary&session=a&uptime='+time+'&frames='+frames+'&vis=visible&paused=false'+extra;
test('legacy boot-only and missing frame reports are inconclusive',()=>{
  assert.equal(analyzeInput('').status,'inconclusive');
  assert.equal(analyzeInput(boot+'\nGET /beacon?ev=summary&session=a&vis=visible',{attempted:true}).status,'inconclusive');
});
test('a live page without deliberate input is not a failure',()=>{
  const text=[boot,sample(0,0),sample(5,150)].join('\n');
  assert.equal(analyzeInput(text).status,'awaiting-input');
  assert.equal(analyzeInput(text,{attempted:true}).status,'not-received');
});
test('passing requires drag and wheel, not pointer motion alone',()=>{
  const prefix=[boot,sample(0,0)];
  assert.equal(analyzeInput([...prefix,sample(5,150,'&ptr=100')].join('\n')).status,'awaiting-input');
  assert.equal(analyzeInput([...prefix,sample(5,150,'&pdown=1&drag=120&wheel=2')].join('\n')).status,'pass');
});
test('stalled, paused and stale sessions cannot pass',()=>{
  assert.equal(analyzeInput([boot,sample(0,0),sample(5,0,'&pdown=1&drag=120&wheel=2')].join('\n')).status,'inconclusive');
  assert.equal(analyzeInput([boot,sample(0,0),sample(5,150,'&pdown=1&drag=120&wheel=2&paused=true')].join('\n')).status,'inconclusive');
  assert.equal(analyzeInput([boot,sample(0,0),sample(5,150,'&pdown=1&drag=120&wheel=2'),'GET /beacon?ev=boot&session=b'].join('\n')).status,'inconclusive');
});
