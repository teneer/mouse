import test from 'node:test';
import assert from 'node:assert/strict';
import {fixedObjectLabel,installTextBoxBorder,normalizeTextBoxStyle} from '../js/text-box.js';
import {validateContent} from '../js/validation.js';

test('box borders draw a rectangle before the unchanged glyph renderer',()=>{
  const drawn=[];
  class Text {
    _render(){drawn.push(['glyphs',this.stroke]);}
  }
  Text.prototype.cacheProperties=[];
  class IText extends Text {}
  class Textbox extends IText {}
  installTextBoxBorder({Text,IText,Textbox});
  const object=Object.assign(new IText(),{width:40,height:20,stroke:'#123456',wbTextBorder:{color:'#ff0000',width:4}});
  object._render({save(){},restore(){},strokeRect(...rect){drawn.push(['rectangle',this.strokeStyle,this.lineWidth,...rect]);}});
  assert.deepEqual(drawn,[['rectangle','#ff0000',4,-18,-8,36,16],['glyphs','#123456']]);
});

test('backup validation and fixed object labels preserve text and PDF details',()=>{
  const style=normalizeTextBoxStyle({background:'#ffffff',border:{color:'#243456',width:40}});
  const data=validateContent({
    canvas:{objects:[{id:'text',type:'i-text',text:'첫 줄\n둘째 줄',wbTextBorder:style.border}]},
    frame:{width:300,height:200,cx:0,cy:0}
  });
  assert.deepEqual(data.canvas.objects[0].wbTextBorder,{color:'#243456',width:30});
  assert.deepEqual(fixedObjectLabel(data.canvas.objects[0]),{kind:'텍스트',detail:'첫 줄'});
  assert.deepEqual(fixedObjectLabel({type:'path',isHighlighter:true}),{kind:'형광펜',detail:''});
  assert.deepEqual(fixedObjectLabel({wbPage:7,wbAsset:{name:'수업.pdf'}}),{kind:'PDF',detail:'수업.pdf · 7쪽'});
});
