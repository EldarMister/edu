const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
test('all panels keep the closing session until dismissal and reopen with fresh native state',()=>{
 const cells=[];let cursor=0,dirty=false,effects=[];
 const React={
  useState(initial){const cell=cells[cursor++]??={value:initial};return [cell.value,next=>{const value=typeof next==='function'?next(cell.value):next;if(value!==cell.value){cell.value=value;dirty=true;}}];},
  useLayoutEffect(fn,deps){const index=cursor++;if(!cells[index]||deps.some((v,i)=>v!==cells[index].deps[i])){cells[index]={deps};effects.push(fn);}},
  useCallback:fn=>fn,createElement:(type,props)=>({type,props}),
 };
 const module={exports:{}};
 const source=fs.readFileSync(path.join(__dirname,'../src/components/BottomPanel.tsx'),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText,{
  module,exports:module.exports,require:id=>id==='react'?React:id==='react-native'?{StyleSheet:{create:x=>x,absoluteFillObject:{}}}:id==='@/theme'?{colors:{},fontSize:{},spacing:{}}:{},
 });
 const props={visible:false,onClose(){},children:null};
 function render(){let result;do{dirty=false;cursor=0;effects=[];result=module.exports.BottomPanel(props);effects.forEach(fn=>fn());}while(dirty);return result;}
 assert.equal(render(),null);let lastKey=-1;
 for(let visit=0;visit<3;visit++){
  props.visible=true;const opened=render();assert.ok(opened.props.key>lastKey);lastKey=opened.props.key;
  props.visible=false;const exiting=render();assert.equal(exiting.props.key,lastKey);
  exiting.props.onDismiss();assert.equal(render(),null);
 }
});
