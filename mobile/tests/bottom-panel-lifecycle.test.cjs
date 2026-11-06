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
function harness(reduced = false) {
 const { PanelHistory } = load('history.ts'); const history = new PanelHistory();
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
 const animate=(target,config,done)=>{ animations.push({target,config,done});return target; };
 const { useBottomPanel } = load('useBottomPanel.ts', {
  react: React, 'react-native': { Keyboard:{dismiss(){}},BackHandler:{addEventListener:()=>({remove(){}})} },
  'react-native-gesture-handler': {},
  'react-native-reanimated': { Easing:{bezier:()=> 'easing'},runOnJS:fn=>fn,cancelAnimation(){},
   useSharedValue:value=>React.useRef({value}).current,useReducedMotion:()=>reduced,withTiming:animate,withSpring:animate },
  './history':{panelHistory:history}, './context':{useBottomPanelHistory:()=>history.getSnapshot()}, './geometry':load('geometry.ts'),
 });
 const props={id:'panel',visible:true,persistent:false,inline:false,draggable:true,onClose:()=>closes++,onDismiss:()=>dismisses++};
 function render() { let loops=0; do { assert.ok(++loops<20,'render loop');dirty=false;cursor=0;effects=[];const before=history.getSnapshot();value=useBottomPanel(props);effects.forEach(fn=>fn());if(before!==history.getSnapshot())dirty=true;}while(dirty);return value; }
 render();value.measure(200);render();
 return {props,history,animations,get value(){return value;},render,get closes(){return closes;},get dismisses(){return dismisses;},unmount(){cells.forEach(cell=>cell?.cleanup?.());},finish(){animations.at(-1).done?.(true);render();}};
}
test('actual panel hook delays onClose until exit and consumes duplicate completions',()=>{
 const env=harness(); assert.equal(env.value.motion.travel.value,224);
 env.value.motion.close(920); env.value.motion.close(920);
 assert.equal(env.closes,0);assert.equal(env.animations.at(-1).config.velocity,920);
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
test('temporary panel suspension preserves the old hook and returns without invoking its close callback',()=>{
 const env=harness();env.history.add({id:'child',parent:'panel',persistent:false,inline:false});env.render();env.finish();
 assert.equal(env.history.getSnapshot().active,'child');assert.equal(env.value.rendered,true);
 assert.equal(env.closes,0);assert.equal(env.dismisses,0);
 env.history.remove('child');env.render();assert.equal(env.value.motion.offset.value,0);assert.equal(env.value.interactive,true);
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

test('body drag remains available below a tall fixed header',()=>{
 const geometry=load('geometry.ts');
 const handlers={};const builder=new Proxy({}, {get:(_,key)=>(...args)=>{if(String(key).startsWith('on'))handlers[key]=args[0];return builder;}});
 const value=v=>({value:v});let failed=0,activated=0,closed=0;
 const motion={offset:value(0),travel:value(500),headerHeight:value(220),closing:value(false),enabled:value(true),reduceMotion:false,draggable:true,close:()=>closed++};
 const {useBottomPanelPan}=load('useBottomPanel.ts',{
  react:{useMemo:fn=>fn()},'react-native':{},'react-native-gesture-handler':{Gesture:{Pan:()=>builder}},
  'react-native-reanimated':{Easing:{bezier(){}},useSharedValue:value,runOnJS:fn=>fn,cancelAnimation(){},withSpring:target=>target},
  './history':{},'./context':{},'./geometry':geometry,
 });
 useBottomPanelPan(motion,value(0));
 const manager={fail:()=>failed++,activate:()=>activated++};
 handlers.onTouchesDown({allTouches:[{y:20,absoluteX:50,absoluteY:250}]},manager);
 assert.equal(failed,0);
 handlers.onTouchesMove({allTouches:[{absoluteX:51,absoluteY:280}]},manager);assert.equal(activated,1);
 handlers.onStart({translationY:30});handlers.onUpdate({translationY:70});assert.equal(motion.offset.value,40);
 handlers.onEnd({velocityY:900});assert.equal(closed,1);
});
