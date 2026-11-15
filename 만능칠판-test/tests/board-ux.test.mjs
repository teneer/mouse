import test from 'node:test';
import assert from 'node:assert/strict';
import {fitScoreFont, conversionSteps, scoreRemainder} from '../score/score-display.js';
import {measureTeamLayout} from '../score/team-layout.js';
import {applyOperation, boardPages, newBoard, pagePatch, validView, validViewState} from '../js/cloud-model.js';
import {movePageId} from '../js/board-navigation.js';
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

test('rapid increments from 2/3 produce two separate arrivals and leave 1/3', () => {
  const inputs=[2,3,4,5,6,7];
  const steps=inputs.slice(1).flatMap((total,index)=>[...conversionSteps(inputs[index],total,3)]);
  assert.deepEqual(steps.filter(step=>step.delta),[
    {from:2,to:3,delta:1,rest:0},
    {from:2,to:3,delta:1,rest:0},
  ]);
  assert.deepEqual(steps.at(-1),{from:0,to:1,delta:0});
});

test('bulk and mixed direction conversions preserve every class step and remainder', () => {
  for(const rate of [1,3,6,20,21]){
    for(let from=-15;from<=15;from++){
      for(let to=-15;to<=15;to++){
        const steps=[...conversionSteps(from,to,rate)];
        const crossings=steps.filter(step=>step.delta);
        const expected=Math.floor(to/rate)-Math.floor(from/rate);
        assert.equal(crossings.length,Math.abs(expected));
        assert.equal(crossings.reduce((sum,step)=>sum+step.delta,0),expected);
        const last=steps.at(-1);
        assert.equal(last ? last.rest??last.to : scoreRemainder(from,rate),scoreRemainder(to,rate));
      }
    }
  }
  assert.deepEqual([...conversionSteps(0,7,3)],[
    {from:0,to:3,delta:1,rest:0},
    {from:0,to:3,delta:1,rest:0},
    {from:0,to:1,delta:0},
  ]);
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
