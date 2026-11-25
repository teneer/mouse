import test from 'node:test';
import assert from 'node:assert/strict';
import {fitScoreFont, conversionFrame, conversionStarFlight, conversionStarPosition, mergeTeamEffects, scoreRemainder} from '../score/score-display.js';
import {measureTeamLayout} from '../score/team-layout.js';
import {applyOperation, boardPages, newBoard, pagePatch, validView, validViewState} from '../js/cloud-model.js';
import {movePageId,movePageSelection} from '../js/board-navigation.js';
import {normalizeFavoriteSize, scaleFavoriteSize} from '../js/board-options.js';
import {validateContent} from '../js/validation.js';

test('class numbers preserve default size until the score and controls no longer fit', () => {
  assert.equal(fitScoreFont(76,190,135),76);
  assert.equal(fitScoreFont(76,145,135),76);
  assert.equal(fitScoreFont(76,100,135),56);
});

test('automatic narrow-panel cap preserves one column and leaves fixed mode available', () => {
  const view={width:170,height:390,count:5,ratio:4/3,gap:8,maxAutoColumns:1};
  assert.equal(measureTeamLayout(view).columns,1);
  assert.equal(measureTeamLayout({...view,fixedColumns:2}).columns,2);
});

test('rapid increments and bulk deductions each produce one combined conversion', () => {
  const inputs=[2,3,4,5,6,7];
  const changes=inputs.slice(1).map((total,index)=>({oldTotal:inputs[index],newTotal:total,rate:3}));
  const grouped=changes.reduce(mergeTeamEffects);
  assert.deepEqual(conversionFrame(grouped.oldTotal,grouped.newTotal,3),{from:2,to:3,delta:2,rest:1});
  assert.deepEqual(conversionFrame(0,16,3),{from:0,to:3,delta:5,rest:1});
  assert.deepEqual(conversionFrame(16,1,3),{from:1,to:0,delta:-5,rest:1});
});

test('conversion grouping respects direction, rate and consecutive totals', () => {
  const first={oldTotal:2,newTotal:6,rate:3};
  assert.equal(mergeTeamEffects(first,{oldTotal:6,newTotal:4,rate:3}),null);
  assert.equal(mergeTeamEffects(first,{oldTotal:6,newTotal:8,rate:4}),null);
  assert.equal(mergeTeamEffects(first,{oldTotal:7,newTotal:8,rate:3}),null);
  assert.deepEqual(conversionFrame(5,4,3),{from:2,to:1,delta:0,rest:1});
  assert.deepEqual(conversionFrame(0,-1,3),{from:0,to:0,delta:-1,rest:2});
  assert.equal(scoreRemainder(-1,3),2);
});

test('page reorder synchronizes without deleting pages added by another device', () => {
  const board=newBoard();
  const pages=['a','b','c','new'].map((id,order)=>({id,order,content:{canvas:{objects:[]}}}));
  applyOperation(board,{kind:'seed',pages},1);
  const order=movePageId(['a','b','c'],'a','c');
  applyOperation(board,{kind:'reorder',order},2);
  assert.deepEqual(boardPages(board).map(page=>page.id),['b','c','a','new']);
});

test('background pattern and pinned state sync and undo with the board', () => {
  const board=newBoard(), frame={width:200,height:200,cx:0,cy:0};
  const before={canvas:{objects:[{type:'rect',id:'box'}],background:'#ffffff'},frame};
  const after=validateContent({canvas:{objects:[{type:'rect',id:'box',wbPinned:true}],background:'#ffffff',wbBackgroundPattern:{kind:'grid',spacing:38}},frame});
  applyOperation(board,{kind:'seed',pages:[{id:'p',order:0,content:before}]},1);
  applyOperation(board,{kind:'edit',pageId:'p',patch:pagePatch(before,after)},2);
  assert.equal(board.pages.p.content.canvas.objects[0].wbPinned,true);
  assert.deepEqual(board.pages.p.content.canvas.wbBackgroundPattern,{kind:'grid',spacing:38});
  applyOperation(board,{kind:'undo',pageId:'p'},3);
  assert.equal(board.pages.p.content.canvas.objects[0].wbPinned,undefined);
  assert.equal(board.pages.p.content.canvas.wbBackgroundPattern.kind,'plain');
});

test('favorite size increase is bounded by all three tools with one multiplier', () => {
  const values={pen:10,marker:100,text:160};
  assert.deepEqual(scaleFavoriteSize(values,true),{pen:12,marker:120,text:192});
  assert.equal(normalizeFavoriteSize({pen:0,marker:1,text:1}),null);
});

test('renaming a page preserves its content revision and survives reorder', () => {
  const board=newBoard();
  const content={canvas:{objects:[]}};
  applyOperation(board,{kind:'seed',pages:[{id:'a',order:0,content},{id:'b',order:1,content}]},1);
  applyOperation(board,{kind:'rename',pageId:'a',title:'  수업 정리  '},2);
  applyOperation(board,{kind:'reorder',order:['b','a']},3);
  assert.equal(boardPages(board)[1].title,'수업 정리');
  assert.equal(board.pages.a.version,1);
  assert.deepEqual(board.pages.a.content,content);
  applyOperation(board,{kind:'rename',pageId:'a',title:'   '},4);
  assert.equal(board.pages.a.title,'');
});

test('shared views support valid scoreboard sizes and older messages without sizes', () => {
  const view={pageId:'a',zoom:1,x:0,y:0};
  assert.equal(validView(view),true);
  assert.equal(validView({...view,scoreShare:90,scoreScale:150}),true);
  assert.equal(validView({...view,scoreShare:95}),false);
  assert.equal(validView({...view,scoreScale:0}),false);
});

test('shared screen state supports a global off signal and a full on snapshot', () => {
  assert.equal(validViewState({enabled:false,epoch:'off'}),true);
  assert.equal(validViewState({enabled:true,epoch:'on'}),false);
  const view={enabled:true,epoch:'on',pageId:'p',zoom:1,x:0,y:0,scoreOpen:false,scoreShare:70,scoreScale:100};
  assert.equal(validViewState(view),true);
  assert.equal(validViewState({...view,scoreOpen:'false'}),false);
});

test('only the explicitly selected tabs follow the shared viewport',async()=>{
  const {activeView}=await import('../js/view-tabs.js');
  const selected={enabled:true,targets:['pc1','tablet1'],scoreFull:true};
  assert.equal(activeView(selected,'pc1'),true);
  assert.equal(activeView(selected,'pc2'),false);
  assert.equal(activeView({...selected,enabled:false},'pc1'),false);
  assert.equal(activeView({enabled:true},'pc1'),false);
});

test('deduction stars leave the class score, rise and fade; earned stars still arrive from the bar',()=>{
  const bar={left:20,top:120,width:160,height:12};
  const score={left:70,top:40,width:60,height:60};
  const lost=conversionStarFlight(bar,score,0,3,true);
  assert.deepEqual(lost.from,{x:100,y:70});
  assert.deepEqual(conversionStarPosition(lost.points,1),{x:-48,y:-62,scale:.5,opacity:0});
  const gained=conversionStarFlight(bar,score,1,3,false);
  assert.deepEqual(gained.from,{x:100,y:120});
  assert.deepEqual(conversionStarPosition(gained.points,1),{x:0,y:-50,scale:.62,opacity:1});
  assert(conversionStarPosition(gained.points,.5).y<0);
});


test('dragging nonadjacent selected pages keeps their original order',()=>{
  const ids=['a','b','c','d','e'];
  const selected=new Set(['c','a']);
  assert.deepEqual(movePageSelection(ids,selected,'d',true),['b','d','a','c','e']);
  assert.deepEqual(movePageSelection(ids,selected,'e',false),['b','d','a','c','e']);
  assert.equal(movePageSelection(ids,selected,'c',true),ids);
});

test('shared page batches rename and delete together and protect the last page',()=>{
  const board=newBoard();
  applyOperation(board,{kind:'seed',pages:['a','b','c'].map((id,order)=>({id,order,content:{canvas:{objects:[]}}}))},1);
  applyOperation(board,{kind:'rename-pages',entries:[['b','수업 (1)'],['c','수업 (2)']]},2);
  assert.deepEqual(boardPages(board).map(page=>page.title),[undefined,'수업 (1)','수업 (2)']);
  applyOperation(board,{kind:'delete-pages',entries:[['b',1],['c',99]]},3);
  assert.equal(boardPages(board).length,3);
  applyOperation(board,{kind:'delete-pages',entries:[['b',1],['c',1]]},4);
  applyOperation(board,{kind:'delete-pages',entries:[['a',1]]},5);
  assert.deepEqual(boardPages(board).map(page=>page.id),['a']);
});
