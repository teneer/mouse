import test from 'node:test';
import assert from 'node:assert/strict';
import {applyOperation, boardPages, newBoard, pagePatch, validView} from '../js/cloud-model.js';
import {deviceInviteURL, encodeDeviceKey, parseFirebaseConfig, readDeviceKey, readInvite} from '../js/cloud-config.js';
import {validateContent} from '../js/validation.js';

const text = (id, value) => ({id,type:'i-text',text:value});
const content = (...objects) => ({canvas:{objects,background:'#fe0'},frame:{width:100,height:100,cx:0,cy:0}});
test('tab renames replay independently of pages and reject invalid names and IDs',()=>{
  const board=seed();
  const tabId='5afa1fe2-b0fb-411b-a468-22876a184a18';
  applyOperation(board,{kind:'tab-rename',tabId,name:'  교사용\n 화면  '},2);
  applyOperation(board,{kind:'tab-rename',tabId,name:'   '},3);
  applyOperation(board,{kind:'tab-rename',tabId:'__proto__',name:'무시'},4);
  assert.deepEqual(board.tabNames,{[tabId]:'교사용  화면'});
  assert.equal(board.pages.page.version,1);
  assert.equal(board.revision,4);
});
function seed(...objects) {
  const board = newBoard();
  applyOperation(board,{kind:'seed',pages:[
    {id:'page',order:1,content:content(...objects)},{id:'other',order:2,content:content()}
  ]},1);
  return board;
}
function edit(board, before, after) {
  applyOperation(board,{kind:'edit',pageId:'page',patch:pagePatch(before,after)},board.revision+1);
}
const objects = board => board.pages.page.content.canvas.objects;

test('concurrent edits to different objects survive each other', () => {
  const a = text('a','original'), b = text('b','original');
  const original = content(a,b), board=seed(a,b);
  const nextA = text('a','from PC'), nextB = text('b','from tablet');
  edit(board,original,content(nextA,b));
  edit(board,original,content(a,nextB));
  assert.deepEqual(objects(board),[nextA,nextB]);
});

test('undo restores the immediately preceding remote version of an overwritten object', () => {
  const original = text('a','original'), board=seed(original);
  edit(board,content(original),content(text('a','B')));
  edit(board,content(original),content(text('a','A')));
  applyOperation(board,{kind:'undo',pageId:'page'},4);
  assert.equal(objects(board)[0].text,'B');
  applyOperation(board,{kind:'redo',pageId:'page'},5);
  assert.equal(objects(board)[0].text,'A');
});

test('a completed edit may restore a deleted object but never a deleted page', () => {
  const original = text('a','original'), next = text('a','completed'), board=seed(original);
  edit(board,content(original),content());
  edit(board,content(original),content(next));
  assert.deepEqual(objects(board),[next]);
  applyOperation(board,{kind:'delete',pageId:'page'},4);
  edit(board,content(original),content(next));
  applyOperation(board,{kind:'undo',pageId:'page'},6);
  assert.deepEqual(boardPages(board).map(p=>p.id),['other']);
});

test('shared viewport checks zoom and world coordinates', () => {
  assert.ok(validView({pageId:'page',zoom:1,x:100,y:-5}));
  assert.ok(!validView({pageId:'page',zoom:0,x:0,y:0}));
});

test('Firebase setup snippet is parsed as text and invites require a matching marker', () => {
  const config=parseFirebaseConfig('const firebaseConfig = {apiKey:"abcdef",authDomain:"a.firebaseapp.com",projectId:"test",appId:"1:12:web:abc"};');
  assert.equal(config.projectId,'test');
  const payload=encodeURIComponent(JSON.stringify({boardId:'a'.repeat(30),config}));
  assert.deepEqual(readInvite('https://example.org/#기기연결='+payload).config,config);
  assert.throws(()=>readInvite('https://example.org/#abcdef='+payload));
});

test('local file references pass validation without storing PDF bytes in the board', () => {
  const asset={id:'sample',name:'교과서.pdf',type:'pdf',size:25000000};
  const file={type:'wb-file',id:'placement',wbAsset:asset,wbPage:500,width:200,height:300};
  assert.deepEqual(validateContent(content(file)).canvas.objects[0].wbAsset,asset);
  assert.throws(()=>validateContent(content({...file,wbPage:0})));
});

test('a reusable invitation round-trips as a copied key or QR URL independently of the legacy link', () => {
  const config = {apiKey:'abcdef',authDomain:'a.firebaseapp.com',projectId:'test',appId:'1:12:web:abc'};
  const boardId = 'a'.repeat(30), token = 'ab'.repeat(24);
  const settings = {config,boardId};
  const key = encodeDeviceKey(settings,token);
  const url = deviceInviteURL(key,'https://example.org/board/?mode=teacher#previous');
  assert.equal(new URL(url).search,'?mode=teacher');
  assert.deepEqual(readDeviceKey(key),{...settings,token});
  assert.deepEqual(readDeviceKey(url),{...settings,token});
  assert.throws(()=>readDeviceKey('WB5.invalid'));
  assert.throws(()=>readInvite(url));
  assert.throws(()=>encodeDeviceKey(settings,'short'));
});
