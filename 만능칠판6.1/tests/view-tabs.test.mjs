import test from 'node:test';
import assert from 'node:assert/strict';
import {wireViewTabs} from '../js/view-tabs.js';

function element() {
  return {
    style:{}, dataset:{}, children:[], offsetWidth:200,
    append(...children){this.children.push(...children);},
    replaceChildren(...children){this.children=children;},
    setAttribute(){},
    getBoundingClientRect(){return {top:520,left:100,width:80};}
  };
}

test('the screen transfer sends only the checked tabs and clears the selection on reopening',async t=>{
  const url='https://example.test/board/index.html';
  const prefix='whiteboard.view-tab:/board/:';
  const storage=new Map(['tablet','phone'].map((id,index)=>[
    prefix+id,JSON.stringify({id,opened:index+2,time:Date.now(),page:1})
  ]));
  const ids=['viewSyncMenu','toolbar','viewSyncTrigger','sendViewNow','toast'];
  const elements=Object.fromEntries(ids.map(id=>[id,element()]));
  const list=element();
  const menu=elements.viewSyncMenu;
  menu.querySelector=()=>list;
  const document={
    getElementById:id=>elements[id],createElement:element,createTextNode:text=>text,
    addEventListener(){}
  };
  const globals={
    document,location:{href:url},window:{addEventListener(){}},innerWidth:800,innerHeight:600,
    localStorage:{
      get length(){return storage.size;},
      key:index=>[...storage.keys()][index],
      getItem:key=>storage.get(key),
      setItem:(key,value)=>storage.set(key,value)
    },
    BroadcastChannel:undefined,setInterval:()=>0
  };
  for(const [name,value] of Object.entries(globals)){
    const previous=Object.getOwnPropertyDescriptor(globalThis,name);
    Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
    t.after(()=>previous?Object.defineProperty(globalThis,name,previous):delete globalThis[name]);
  }

  const sent=[];
  const view={pageId:'p',zoom:1,x:30,y:40};
  wireViewTabs({
    sync:{id:'pc',opened:1,sendView:state=>sent.push(state)},cloud:{},
    currentView:()=>view,pages:()=>[{id:'p'}],
    togglePopup:()=>{menu.style.display='block';},
    closePopups(){},fail:assert.fail
  });

  const opener=elements.viewSyncTrigger;
  const send=elements.sendViewNow;
  const open=()=>opener.onclick({preventDefault(){}});
  const checkboxes=()=>list.children.map(row=>row.children[0].children[0]);
  open();
  assert.deepEqual(checkboxes().map(box=>box.dataset.viewTab),['pc','tablet','phone']);
  assert.ok(checkboxes().every(box=>!box.checked));
  assert.equal(send.disabled,true);
  await send.onclick();
  assert.equal(sent.length,0);

  const tablet=checkboxes().find(box=>box.dataset.viewTab==='tablet');
  tablet.checked=true;
  tablet.onchange();
  assert.equal(send.disabled,false);
  tablet.checked=false;
  tablet.onchange();
  assert.equal(send.disabled,true);
  tablet.checked=true;
  tablet.onchange();
  await send.onclick();

  assert.equal(sent.length,1);
  assert.deepEqual(sent[0].targets,['tablet']);
  assert.equal(sent[0].sourceTab,'pc');
  assert.deepEqual(Object.fromEntries(Object.keys(view).map(key=>[key,sent[0][key]])),view);
  open();
  assert.ok(checkboxes().every(box=>!box.checked));
  assert.equal(send.disabled,true);
});
