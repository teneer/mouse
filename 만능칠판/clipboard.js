// clipboard.js (최종 완성본)

let _clipboard = null;

export function initializeClipboard(fabricCanvas, utils, recordStateFunc) {
    document.addEventListener('keydown', (e) => {
        if (!e.ctrlKey && !e.metaKey) return;

        const activeElement = document.activeElement;
        const isInputFocused = activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA';
        const isITextEditing = fabricCanvas.getActiveObject()?.isEditing;

        if (isInputFocused || isITextEditing) return;

        switch (e.key.toLowerCase()) {
            case 'c':
                e.preventDefault();
                copy(fabricCanvas);
                break;
            case 'v':
                if (_clipboard) {
                    e.preventDefault();
                    paste(fabricCanvas, utils.getTargetLayerForDrawing, utils.debouncedSaveCanvasState, recordStateFunc);
                }
                break;
            case 'x':
                e.preventDefault();
                cut(fabricCanvas, utils.debouncedSaveCanvasState, recordStateFunc);
                break;
            case 'a':
                e.preventDefault();
                selectAll(fabricCanvas);
                break;
        }
    });

    // 외부에서 복사/잘라내기가 발생하면 내부 클립보드를 비움
    document.addEventListener('copy', () => {
        _clipboard = null;
        console.log("외부 복사가 감지되어 내부 클립보드를 비웠습니다.");
    });
    document.addEventListener('cut', () => {
        _clipboard = null;
        console.log("외부 잘라내기가 감지되어 내부 클립보드를 비웠습니다.");
    });

    console.log("클립보드 및 전체 선택 기능이 초기화되었습니다.");
}

function copy(canvas) {
    const activeObject = canvas.getActiveObject();
    if (!activeObject) return;
    activeObject.clone(function(cloned) {
        _clipboard = cloned;
        console.log("객체가 내부 클립보드에 복사되었습니다.");
    }, ['customLayer', 'id']);
}

function paste(canvas, getTargetLayerFunc, saveFunc, recordStateFunc) {
    if (!_clipboard) return;
    _clipboard.clone(function(clonedObj) {
        canvas.discardActiveObject();
        clonedObj.set({
            left: clonedObj.left + 10,
            top: clonedObj.top + 10,
            evented: true,
        });
        const targetLayer = getTargetLayerFunc() || 'editLayer';

        if (clonedObj.type === 'activeSelection') {
            clonedObj.getObjects().forEach(function(obj) {
                obj.set('customLayer', targetLayer);
                canvas.add(obj);
            });
            const newSelection = new fabric.ActiveSelection(clonedObj.getObjects(), { canvas: canvas, ...clonedObj });
            canvas.setActiveObject(newSelection);
        } else {
            clonedObj.set('customLayer', targetLayer);
            canvas.add(clonedObj);
            canvas.setActiveObject(clonedObj);
        }
        canvas.requestRenderAll();
        if(saveFunc) saveFunc();
        if (recordStateFunc) {
            recordStateFunc(canvas);
        }
        _clipboard.set({
            left: clonedObj.left,
            top: clonedObj.top
        });
    }, ['customLayer', 'id']);
}

function cut(canvas, saveFunc, recordStateFunc) {
    const activeObject = canvas.getActiveObject();
    if (!activeObject) return;
    copy(canvas);
    if (activeObject.type === 'activeSelection') {
        activeObject.getObjects().forEach(obj => canvas.remove(obj));
    } else {
        canvas.remove(activeObject);
    }
    canvas.discardActiveObject();
    canvas.renderAll();
    if(saveFunc) saveFunc();
    if (recordStateFunc) {
        recordStateFunc(canvas);
    }
}

function selectAll(canvas) {
    canvas.discardActiveObject();
    const selectableObjects = canvas.getObjects().filter(obj => obj.selectable && obj.visible);
    if (selectableObjects.length === 0) return;
    const sel = new fabric.ActiveSelection(selectableObjects, { canvas: canvas });
    canvas.setActiveObject(sel);
    canvas.requestRenderAll();
}
