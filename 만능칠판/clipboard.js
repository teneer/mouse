 clipboard.js

 복사된 fabric 객체를 저장할 내부 클립보드 변수
let _clipboard = null;


  복사붙여넣기 및 전체 선택 기능을 초기화하는 함수
  @param {fabric.Canvas} fabricCanvas - 메인 캔버스 인스턴스
  @param {object} utils - script.js에서 제공하는 헬퍼 함수 모음
 
export function initializeClipboard(fabricCanvas, utils) {
    document.addEventListener('keydown', (e) = {
         단축키가 눌렸는지 확인 (Mac의 경우 metaKey, WindowsLinux는 ctrlKey)
        if (!e.ctrlKey && !e.metaKey) {
            return;
        }

         입력 필드나 텍스트 편집 중에는 단축키가 작동하지 않도록 방지
        const activeElement = document.activeElement;
        const isInputFocused = activeElement.tagName === 'INPUT'  activeElement.tagName === 'TEXTAREA';
        const isITextEditing = fabricCanvas.getActiveObject().isEditing;

        if (isInputFocused  isITextEditing) {
            return;  캔버스 단축키 무시
        }

        switch (e.key.toLowerCase()) {
            case 'c'  복사 (Ctrl+C)
                e.preventDefault();
                copy(fabricCanvas);
                break;
            case 'v'  붙여넣기 (Ctrl+V)
                e.preventDefault();
                paste(fabricCanvas, utils.getTargetLayerForDrawing, utils.debouncedSaveCanvasState);
                break;
            case 'x'  잘라내기 (Ctrl+X)
                e.preventDefault();
                cut(fabricCanvas, utils.debouncedSaveCanvasState);
                break;
            case 'a'  전체 선택 (Ctrl+A)
                e.preventDefault();
                selectAll(fabricCanvas);
                break;
        }
    });

    console.log(클립보드 및 전체 선택 기능이 초기화되었습니다.);
}


  현재 활성화된 객체를 내부 클립보드에 복사합니다.
  @param {fabric.Canvas} canvas 
 
function copy(canvas) {
    const activeObject = canvas.getActiveObject();
    if (!activeObject) return;

     clone 메소드는 비동기로 작동합니다.
    activeObject.clone(function(cloned) {
        _clipboard = cloned;
        console.log(객체가 클립보드에 복사되었습니다.);
    }, ['customLayer', 'id']);  복사 시 포함할 사용자 정의 속성
}


  클립보드에 있는 객체를 캔버스에 붙여넣습니다.
  @param {fabric.Canvas} canvas 
  @param {function} getTargetLayerFunc - 현재 활성화된 레이어를 반환하는 함수
  @param {function} saveFunc - 자동 저장을 호출하는 함수
 
function paste(canvas, getTargetLayerFunc, saveFunc) {
    if (!_clipboard) return;

     붙여넣을 때도 복제하여, 여러 번 붙여넣기가 가능하도록 합니다.
    _clipboard.clone(function(clonedObj) {
        canvas.discardActiveObject();  기존 선택 해제

         복제된 객체그룹의 위치를 약간씩 이동
        clonedObj.set({
            left clonedObj.left + 10,
            top clonedObj.top + 10,
            evented true,  이벤트를 받을 수 있도록 설정
        });

        const targetLayer = getTargetLayerFunc()  'editLayer';  붙여넣을 레이어 결정

        if (clonedObj.type === 'activeSelection') {
             그룹(다중 선택)인 경우, 각 객체를 개별적으로 처리
            clonedObj.getObjects().forEach(function(obj) {
                obj.set('customLayer', targetLayer);  각 객체에 레이어 정보 할당
                canvas.add(obj);
            });
             그룹 내 객체들을 다시 새로운 그룹으로 선택
            const newSelection = new fabric.ActiveSelection(clonedObj.getObjects(), {
                canvas canvas,
                ...clonedObj
            });
            canvas.setActiveObject(newSelection);
        } else {
             단일 객체인 경우
            clonedObj.set('customLayer', targetLayer);
            canvas.add(clonedObj);
            canvas.setActiveObject(clonedObj);
        }

        canvas.requestRenderAll();
        if(saveFunc) saveFunc();  변경사항 저장
        
         다음 붙여넣기를 위해 클립보드 객체의 위치도 업데이트
        _clipboard.set({
            left clonedObj.left,
            top clonedObj.top
        });

    }, ['customLayer', 'id']);
}


  현재 활성화된 객체를 복사하고 캔버스에서 삭제합니다.
  @param {fabric.Canvas} canvas 
  @param {function} saveFunc 
 
function cut(canvas, saveFunc) {
    const activeObject = canvas.getActiveObject();
    if (!activeObject) return;

    copy(canvas);  먼저 복사

    if (activeObject.type === 'activeSelection') {
        activeObject.getObjects().forEach(obj = canvas.remove(obj));
    } else {
        canvas.remove(activeObject);
    }
    canvas.discardActiveObject();
    canvas.renderAll();
    if(saveFunc) saveFunc();
}


  현재 활성화된 레이어의 모든 객체를 선택합니다.
  @param {fabric.Canvas} canvas 
 
function selectAll(canvas) {
    canvas.discardActiveObject();  기존 선택 해제
    
     화면에 보이고 선택 가능한 객체만 필터링
    const selectableObjects = canvas.getObjects().filter(obj = obj.selectable && obj.visible);

    if (selectableObjects.length === 0) return;

     필터링된 객체들로 새로운 선택 그룹을 생성
    const sel = new fabric.ActiveSelection(selectableObjects, {
        canvas canvas,
    });
    canvas.setActiveObject(sel);
    canvas.requestRenderAll();
}
