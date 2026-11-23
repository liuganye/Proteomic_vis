import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/workspace-layout.ts', import.meta.url),'utf8');
const {outputText} = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}});
const {DEFAULT_LAYOUT,WORKSPACE_MODULES,addPanel,placePanel,readLayout,overlaps} = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
function valid(layout) {
  assert.equal(new Set(layout.map(p=>p.id)).size,layout.length);
  for(const p of layout) {
    assert.ok(p.x>=0 && p.y>=0 && p.x+p.w<=12);
    for(const q of layout) if(p.id!==q.id) assert.equal(overlaps(p,q),false,`${p.id} overlaps ${q.id}`);
  }
}
test('moving into occupied space flows collisions down while keeping the edited position',()=>{
  const before=structuredClone(DEFAULT_LAYOUT);
  const moved=placePanel(before,{...before[0],x:6,y:0});
  assert.deepEqual(moved.find(p=>p.id==='volcano'),{id:'volcano',x:6,y:0,w:6,h:9});
  assert.equal(moved.find(p=>p.id==='results').y,9);
  assert.equal(moved.find(p=>p.id==='abundance').y,18);
  assert.deepEqual(before,DEFAULT_LAYOUT);
  assert.deepEqual(moved.map(p=>p.id),before.map(p=>p.id));
  valid(moved);
});
test('adding every module and repeatedly moving/resizing never overlaps or leaves the grid',()=>{
  let layout=[];
  for(const d of WORKSPACE_MODULES) layout=addPanel(layout,d.id);
  let seed=17;
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};
  for(let i=0;i<400;i++){
    const p=layout[Math.floor(random()*layout.length)];
    layout=placePanel(layout,{...p,x:Math.floor(random()*18)-3,y:Math.floor(random()*20)-3,w:Math.floor(random()*16),h:Math.floor(random()*25)});
    valid(layout);
    assert.deepEqual(readLayout(JSON.stringify({version:1,panels:layout})),layout);
  }
});
test('duplicate add is a no-op and removed panels can return without discarding others',()=>{
  assert.equal(addPanel(DEFAULT_LAYOUT,'volcano'),DEFAULT_LAYOUT);
  const reduced=DEFAULT_LAYOUT.filter(p=>p.id!=='results');
  const restored=addPanel(reduced,'results');
  for(const p of reduced) assert.deepEqual(restored.find(q=>q.id===p.id),p);
  assert.equal(restored.find(p=>p.id==='results').x,6);
  assert.equal(restored.find(p=>p.id==='results').y,0);
  valid(restored);
});
test('storage accepts intentionally empty layouts but rejects corrupt, overlapping and obsolete layouts',()=>{
  assert.deepEqual(readLayout('{"version":1,"panels":[]}'),[]);
  for(const raw of ['bad','null','{}','{"version":2,"panels":[]}',JSON.stringify({version:1,panels:[{id:'foreign',x:0,y:0,w:6,h:6}]}),JSON.stringify({version:1,panels:[DEFAULT_LAYOUT[0],DEFAULT_LAYOUT[0]]}),JSON.stringify({version:1,panels:[DEFAULT_LAYOUT[0],{...DEFAULT_LAYOUT[1],x:0}]}),JSON.stringify({version:1,panels:[{...DEFAULT_LAYOUT[0],x:Infinity}]}),JSON.stringify({version:1,panels:[{...DEFAULT_LAYOUT[0],y:10001}]})]) assert.equal(readLayout(raw),null);
});
test('minimum sizes, whole grid units and edge clamping are enforced',()=>{
  const result=placePanel([],{id:'volcano',x:11.6,y:-4,w:2,h:1})[0];
  assert.deepEqual(result,{id:'volcano',x:8,y:0,w:4,h:6});
  const wide=placePanel([],{id:'network',x:10,y:2.4,w:30,h:40})[0];
  assert.deepEqual(wide,{id:'network',x:0,y:2,w:12,h:20});
});
