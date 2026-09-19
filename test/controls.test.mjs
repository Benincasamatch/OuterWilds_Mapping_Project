import test from 'node:test';
import assert from 'node:assert/strict';
import { createControls } from '../wallpaper/js/controls.js';
import { createCamera } from '../wallpaper/js/camera.js';
class FakeElement extends EventTarget {
  children=[];attributes={};hidden=false;
  setAttribute(k,v){this.attributes[k]=v;}
  appendChild(child){this.children.push(child);child.parent=this;}
  remove(){this.parent.children=this.parent.children.filter(c=>c!==this);}
}
test('zoom buttons work without wheel or keyboard and reset restores initial view',()=>{
  const previous=globalThis.document;
  globalThis.document={createElement:()=>new FakeElement()};
  try {
    const mount=new FakeElement(),camera=createCamera();let input=0;
    const controls=createControls({mount,camera,onInput:()=>input++});
    assert.equal(mount.children.length,3);
    assert.equal(mount.children[0].attributes['aria-label'],'放大 / Zoom in');
    const click=(id)=>mount.children.find(b=>b.id===id).dispatchEvent(new Event('click'));
    click('zoom-in');camera.snap();assert.equal(camera.distance,9600);
    click('zoom-out');camera.snap();assert.equal(camera.distance,12000);
    camera.setTarget(1,2,3);camera.setState({distance:20000,yaw:2,pitch:1});camera.snap();
    click('reset-view');camera.snap();camera.update(0);
    assert.equal(camera.distance,12000);assert.equal(camera.yaw,0.6);assert.deepEqual([...camera.target],[0,0,0]);
    assert.equal(input,3);
    controls.setVisible(false);assert.equal(mount.hidden,true);
    controls.setVisible(true);assert.equal(mount.hidden,false);
    const old=mount.children[0];controls.dispose();assert.equal(mount.children.length,0);
    old.dispatchEvent(new Event('click'));assert.equal(input,3);
  } finally {globalThis.document=previous;}
});
