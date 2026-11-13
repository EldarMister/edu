const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, modules = {}) {
 const module = { exports: {} };
 const source = fs.readFileSync(path.join(__dirname, '../src/components/bottom-panel', file), 'utf8');
 vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
 { module, exports: module.exports, require: id => { assert.ok(id in modules, id); return modules[id]; } });
 return module.exports;
}
function harness(reduced = false, deferSharedWrites = false, { history: sharedHistory, id = 'panel', parent } = {}) {
 const { PanelHistory } = load('history.ts'); const history = sharedHistory ?? new PanelHistory();
 const cells = [], animations = []; let cursor = 0, effects = [], dirty = false, value, closes = 0, dismisses = 0;
 const differs = (a, b) => !a || a.length !== b.length || b.some((v,i) => !Object.is(v,a[i]));
 const React = {
  useState(initial) { const cell = cells[cursor++] ??= { value: initial }; return [cell.value, next => { if (!Object.is(cell.value,next)) { cell.value=next; dirty=true; } }]; },
  useRef(current) { return (cells[cursor++] ??= { value: { current } }).value; },
  useMemo(fn,deps) { const i=cursor++; if(!cells[i] || differs(cells[i].deps,deps)) cells[i]={ value:fn(),deps }; return cells[i].value; },
  useCallback(fn,deps) { return React.useMemo(()=>fn,deps); },
  useEffect(fn,deps) { const i=cursor++; if(!cells[i] || differs(cells[i].deps,deps)) { const previous=cells[i]; cells[i]={deps}; effects.push(()=>{previous?.cleanup?.();cells[i].cleanup=fn();}); } },
 };
 React.useLayoutEffect=React.useEffect;
 const writes=[];
 const shared=initial=>{
  let current=initial;
  return {get value(){return current;},set value(next){if(deferSharedWrites)writes.push(()=>{current=next;});else current=next;}};
 };
 const animate=(target,config,done)=>{ animations.push({target,config,done});return target; };
 const { useBottomPanel } = load('useBottomPanel.ts', {
  react: React, 'react-native': { Keyboard:{dismiss(){}},BackHandler:{addEventListener:()=>({remove(){}})} },
  'react-native-gesture-handler': {},
  'react-native-reanimated': { Easing:{bezier:()=> 'easing'},runOnJS:fn=>fn,cancelAnimation(){},
   useSharedValue:value=>React.useRef(shared(value)).current,useReducedMotion:()=>reduced,withTiming:animate,withSpring:animate },
  './history':{panelHistory:history}, './context':{useBottomPanelHistory:()=>history.getSnapshot()}, './geometry':load('geometry.ts'),
 });
 const props={id,parent,visible:true,persistent:false,inline:false,draggable:true,onClose:()=>closes++,onDismiss:()=>dismisses++};
 function render() { let loops=0; do { assert.ok(++loops<20,'render loop');dirty=false;cursor=0;effects=[];const before=history.getSnapshot();value=useBottomPanel(props);effects.forEach(fn=>fn());if(before!==history.getSnapshot())dirty=true;}while(dirty);writes.splice(0).forEach(write=>write());return value; }
 render();value.measure(200);render();
 return {props,history,animations,get value(){return value;},render,get closes(){return closes;},get dismisses(){return dismisses;},unmount(){cells.forEach(cell=>cell?.cleanup?.());},finish(){animations.at(-1).done?.(true);render();}};
}
test('the first layout opens and enables drag even before shared writes reach the UI thread',()=>{
 const env=harness(false,true);
 assert.equal(env.value.interactive,true);
 assert.equal(env.value.motion.enabled.value,true);
 assert.equal(env.value.motion.travel.value,224);
 assert.equal(env.value.motion.offset.value,0);
 assert.equal(env.animations.at(-1).config.duration,550);
});
test('actual panel hook delays onClose until exit and consumes duplicate completions',()=>{
 const env=harness(); assert.equal(env.value.motion.travel.value,224);
 env.value.motion.close(920); env.value.motion.close(920);
 assert.equal(env.closes,0);assert.equal(env.animations.at(-1).config.velocity,920);
 assert.equal(env.animations.at(-1).config.duration,300);
 const callback=env.animations.at(-1).done;env.finish();callback(true);
 assert.equal(env.closes,1);assert.equal(env.dismisses,1);assert.equal(env.value.rendered,false);
});
test('actual hook invalidates a pending dismissal when the controlled panel reopens',()=>{
 const env=harness();env.props.visible=false;env.render();const callback=env.animations.at(-1).done;
 env.props.visible=true;env.render();assert.equal(env.value.motion.measured.value,true);callback(true);
 assert.equal(env.closes,0);assert.equal(env.dismisses,0);assert.equal(env.value.rendered,true);
});
test('unmount prevents animation callbacks from notifying a removed owner',()=>{
 const env=harness();env.value.motion.close();const callback=env.animations.at(-1).done;
 env.unmount();callback(true);assert.equal(env.closes,0);assert.equal(env.dismisses,0);
});
test('the next panel starts opening before the previous one finishes its suspension',()=>{
 const env=harness();
 const child=harness(false,true,{history:env.history,id:'child',parent:'panel'});
 env.render();
 const outgoing=env.animations.at(-1);
 assert.equal(outgoing.config.duration,300);
 assert.equal(env.value.interactive,false);
 assert.equal(child.value.interactive,true);
 assert.equal(child.animations.at(-1).config.duration,550);
 outgoing.done(true);
 assert.equal(env.history.getSnapshot().active,'child');
 assert.equal(env.value.rendered,true);
 assert.equal(env.closes,0);assert.equal(env.dismisses,0);
 child.unmount();
 env.render();assert.equal(env.value.motion.offset.value,0);assert.equal(env.value.interactive,true);
});
test('Reduce Motion closes immediately without waiting for a spatial animation',()=>{
 const env=harness(true);env.value.motion.close();env.render();assert.equal(env.closes,1);assert.equal(env.dismisses,1);
 assert.equal(env.animations.length,0);
});


test('retargeting a closing panel cancels its old callback without requiring another layout',()=>{
 const env=harness();env.value.motion.close();const callback=env.animations.at(-1).done;
 env.props.ownerKey='another-order';env.render();callback(true);
 assert.equal(env.closes,0);assert.equal(env.value.rendered,true);assert.equal(env.value.interactive,true);
 assert.equal(env.value.motion.measured.value,true);
});
test('close invokes the initiating owner rather than replacing it with a later callback',()=>{
 const env=harness();env.value.motion.close();let later=0;env.props.onClose=()=>later++;env.render();env.finish();
 assert.equal(env.closes,1);assert.equal(later,0);
});

test('closed voice panel opens on every subsequent visit',()=>{
 const env=harness();
 env.props.onClose=()=>{env.props.visible=false;};env.render();
 for(let visit=0;visit<3;visit++){
  env.value.motion.close();env.finish();assert.equal(env.value.rendered,false);
  env.props.visible=true;env.render();env.value.measure(420);env.render();
  assert.equal(env.value.rendered,true);assert.equal(env.value.interactive,true);
  assert.equal(env.value.motion.offset.value,0);
 }
});

test('a completed gesture dismisses once, while an obsolete gesture has no effect',()=>{
 const env=harness();
 const { motion }=env.value;
 const stale=motion.interaction.value++;
 motion.dismiss(stale);
 assert.equal(env.closes,0);
 motion.offset.value=motion.travel.value;
 const animations=env.animations.length;
 const finished=motion.interaction.value;
 motion.dismiss(finished);
 motion.dismiss(finished);
 env.render();
 assert.equal(env.closes,1);
 assert.equal(env.dismisses,1);
 assert.equal(env.animations.length,animations);
});

function panHarness(scrollOffset) {
 const handlers={};const builder=new Proxy({}, {get:(_,key)=>(...args)=>{if(String(key).startsWith('on'))handlers[key]=args[0];return builder;}});
 const value=v=>({value:v});
 const scrollY=scrollOffset === undefined ? undefined : value(scrollOffset);
 const animations=[];
 let failed=0,activated=0,closed=0,cancelled=0;
 const motion={offset:value(0),travel:value(500),interaction:value(0),closing:value(false),enabled:value(true),reduceMotion:false,draggable:true,dismiss:()=>closed++};
 const {useBottomPanelPan}=load('useBottomPanel.ts',{
  react:{useMemo:fn=>fn()},'react-native':{},'react-native-gesture-handler':{Gesture:{Pan:()=>builder}},
  'react-native-reanimated':{Easing:{bezier(){}},useSharedValue:value,runOnJS:fn=>fn,cancelAnimation:()=>cancelled++,
   withSpring(target,config,done){animations.push({target,config,done});return motion.offset.value;}},
  './history':{},'./context':{},'./geometry':load('geometry.ts'),
 });
 useBottomPanelPan(motion,scrollY);
 const manager={fail:()=>failed++,activate:()=>activated++};
 const touch=(x,y)=>({allTouches:[{y,absoluteX:x,absoluteY:y}]});
 return {handlers,motion,scrollY,animations,manager,touch,get failed(){return failed;},get activated(){return activated;},
  get closed(){return closed;},get cancelled(){return cancelled;}};
}

test('the handle catches the current position and reverses without changing the drag origin',()=>{
 const env=panHarness();
 env.motion.offset.value=45;
 env.handlers.onStart({absoluteY:300});
 assert.equal(env.cancelled,1);
 env.handlers.onUpdate({absoluteY:340});
 assert.equal(env.motion.offset.value,85);
 env.handlers.onUpdate({absoluteY:320});
 assert.equal(env.motion.offset.value,65);
 env.handlers.onEnd({velocityY:-200,absoluteY:320},true);
 assert.equal(env.animations.at(-1).target,0);
 assert.equal(env.animations.at(-1).config.velocity,-200);
 env.handlers.onFinalize();
 assert.equal(env.animations.length,1);
});

test('a short flick starts a close spring that can be caught before dismissal',()=>{
 const env=panHarness();
 env.handlers.onTouchesDown(env.touch(50,291),env.manager);
 env.handlers.onStart({absoluteY:300});
 env.handlers.onUpdate({absoluteY:307});
 env.handlers.onEnd({velocityY:940,absoluteY:307},true);
 const exit=env.animations.at(-1);
 assert.equal(exit.target,500);
 assert.equal(exit.config.dampingRatio,1);
 assert.equal(exit.config.velocity,940);
 assert.equal(env.closed,0);
 env.motion.offset.value=85;
 env.handlers.onTouchesDown(env.touch(50,388),env.manager);
 env.handlers.onStart({absoluteY:380});
 env.handlers.onUpdate({absoluteY:350});
 assert.equal(env.motion.offset.value,55);
 exit.done(true);
 assert.equal(env.closed,0);
 env.handlers.onEnd({velocityY:-1000,absoluteY:350},true);
 assert.equal(env.animations.at(-1).target,0);
});

test('list pan hands off only a downwards pull from the scroll origin and keeps it on reversal',()=>{
 const env=panHarness(120);
 const {handlers,manager,touch}=env;
 handlers.onTouchesDown(touch(50,450),manager);
 assert.equal(env.failed,1);
 env.scrollY.value=0;
 handlers.onTouchesDown(touch(50,450),manager);
 handlers.onTouchesMove(touch(50,430),manager);
 assert.equal(env.failed,2);
 handlers.onTouchesDown(touch(50,450),manager);
 handlers.onTouchesMove(touch(51,480),manager);
 assert.equal(env.activated,1);
 handlers.onStart({absoluteY:480});
 handlers.onUpdate({absoluteY:520});
 handlers.onTouchesMove(touch(50,465),manager);
 handlers.onUpdate({absoluteY:500});
 assert.equal(env.failed,2);
 assert.equal(env.motion.offset.value,20);
});
