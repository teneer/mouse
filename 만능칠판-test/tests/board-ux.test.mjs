import test from 'node:test';
import assert from 'node:assert/strict';
import {fitScoreFont, mergeConversions, scoreRemainder} from '../score/score-display.js';
import {measureTeamLayout} from '../score/team-layout.js';
import {applyOperation, boardPages, newBoard, pagePatch} from '../js/cloud-model.js';
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

test('pending exchanges retain the first total, final remainder, and net class change', () => {
  const first={oldTotal:2,newTotal:4,amount:2,classDiff:1,rate:3};
  const next={oldTotal:4,newTotal:8,amount:4,classDiff:1,rate:3};
  const merged=mergeConversions(first,next);
  assert.deepEqual(merged,{oldTotal:2,newTotal:8,amount:6,classDiff:2,rate:3});
  assert.equal(scoreRemainder(merged.newTotal,merged.rate),2);
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
