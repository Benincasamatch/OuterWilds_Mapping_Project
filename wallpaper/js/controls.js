// Accessible mouse-only controls for hosts that do not forward wheel/key events.
export function createControls({ mount, camera, onInput = () => {} }) {
  const definitions = [
    ['zoom-in', '+', '放大 / Zoom in', () => camera.zoomBy(0.8)],
    ['zoom-out', '−', '缩小 / Zoom out', () => camera.zoomBy(1.25)],
    ['reset-view', '⌂', '重置视角 / Reset view', () => camera.resetView()],
  ];
  const handlers=[];
  mount.setAttribute('role','group');
  mount.setAttribute('aria-label','视角控制 / View controls');
  for(const [id,label,title,action] of definitions) {
    const button=document.createElement('button');
    button.type='button'; button.id=id; button.textContent=label;
    button.title=title; button.setAttribute('aria-label',title);
    const click=()=>{onInput();action();};
    button.addEventListener('click',click);mount.appendChild(button);
    handlers.push([button,click]);
  }
  return {
    setVisible(value) { mount.hidden=!value; },
    dispose() { for(const [button,click] of handlers){button.removeEventListener('click',click);button.remove();} },
  };
}
