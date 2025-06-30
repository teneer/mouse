import { initializeClipboard } from './clipboard.js';
import { initializeHistory, recordState } from './history.js';

document.addEventListener('DOMContentLoaded', async () => {
    const canvasElement = document.getElementById('whiteboardCanvas');
    const fabricCanvas = new fabric.Canvas(canvasElement, {
        width: canvasElement.width,
        height: canvasElement.height,
        selection: true,
        preserveObjectStacking: true,
        backgroundColor: '#D6B588'
    });

    fabric.Object.prototype.cornerStyle = 'circle';
    fabric.Object.prototype.cornerSize = 10;
    fabric.Object.prototype.transparentCorners = false;
    fabric.Object.prototype.setControlsVisibility({mtr: false});

    const canvasContainer = document.getElementById('canvas-container');

    // --- DOM 요소 가져오기 ---
    const selectMoveToggleBtn = document.getElementById('selectMoveToggleBtn');
    const selectMoveLabel = document.getElementById('selectMoveLabel');

    const editLayerCheckbox = document.querySelector('input[data-layer="editLayer"]');
    const scheduleLayerCheckbox = document.querySelector('input[data-layer="scheduleLayer"]');

    const bgColorBtn = document.getElementById('bgColorBtn');
    const bgColorTipup = document.querySelector('.tip-up-settings[data-tipup="bgcolor"]');
    const bgColorOptions = bgColorTipup.querySelectorAll('.color-btn');

    const penModeBtn = document.getElementById('penModeBtn');
    const penTipupBtn = document.getElementById('penTipupBtn');
    const penSettings = document.getElementById('penSettings');
    const penColorOptions = penSettings.querySelectorAll('.color-btn[data-tool="pen"]');
    const penSizeSelect = document.getElementById('penSizeSelect');

    const freeTextModeBtn = document.getElementById('freeTextModeBtn');
    const freeTextTipupBtn = document.getElementById('freeTextTipupBtn');
    const freeTextSettings = document.getElementById('freeTextSettings');
    const freeTextColorOptions = freeTextSettings.querySelectorAll('.color-btn[data-tool="freeText"]');
    const freeTextSizeSelect = document.getElementById('freeTextSizeSelect');

    const eraserModeBtn = document.getElementById('eraserModeBtn');
    const clearAllBtn = document.getElementById('clearAllBtn');
    const clearConfirmModal = document.getElementById('clearConfirmModal');
    const confirmClearBtn = document.getElementById('confirmClearBtn');
    const cancelClearBtn = document.getElementById('cancelClearBtn');
    const closeClearConfirmModal = document.getElementById('closeClearConfirmModal');

    const saveBtn = document.getElementById('saveBtn');
    const loadGeneralBtn = document.getElementById('loadGeneralBtn');
    const scheduleBtn = document.getElementById('scheduleBtn');

    const saveConfirmModal = document.getElementById('saveConfirmModal');
    const closeSaveConfirmModalBtn = document.getElementById('closeSaveConfirmModal');
    const saveScreenNameInput = document.getElementById('saveScreenNameInput');
    const saveModalTimestamp = document.getElementById('saveModalTimestamp');
    const confirmSaveBtn = document.getElementById('confirmSaveBtn');
    const cancelSaveBtn = document.getElementById('cancelSaveBtn');


    const loadSavedScreenModal = document.getElementById('loadSavedScreenModal');
    const closeLoadSavedScreenModalBtn = document.getElementById('closeLoadSavedScreenModalBtn');
    const savedScreenListUl = document.getElementById('savedScreenList');
    const noSavedScreensP = document.getElementById('noSavedScreens');

    const scheduleModal = document.getElementById('scheduleModal');
    const closeScheduleModalBtn = document.getElementById('closeScheduleModalBtn');
    const scheduleDayCheckboxesContainer = document.getElementById('scheduleDayCheckboxes');
    const scheduleTimeInput = document.getElementById('scheduleTime');
    const scheduledContentSelect = document.getElementById('scheduledContentSelect');
    const deleteSelectedScheduledScreenBtn = document.getElementById('deleteSelectedScheduledScreenBtn');
    const addScheduleEntryBtn = document.getElementById('addScheduleEntryBtn');
    const scheduleListUl = document.getElementById('scheduleList');

    const homeBtn = document.getElementById('homeBtn');
    const toolbarHideBtn = document.getElementById('toolbarHideBtn');
    const toolbarElement = document.getElementById('toolbar');
    const toolbarToggleElement = document.getElementById('toolbarToggle');
    const toolbarWrapper = document.getElementById('toolbarWrapper');
    const toolbarScaleWrap = document.getElementById('toolbarScaleWrap');


    let currentMode = 'select';
    let isPanning = false;
    let lastPanPoint = { x: 0, y: 0 };
    let toolbarVisible = true;

    let currentPenColor = '#000000';
    let currentPenSize = 5;
    let currentTextColor = '#000000';
    let currentTextSize = 48;

    let dataManager;

    function debounce(func, delay) {
      let timeoutId;
      return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          func.apply(this, args);
        }, delay);
      };
    }

    const MIN_ZOOM = 0.1;
    const MAX_ZOOM = 10.0;
    const DEFAULT_ZOOM = 1.0;

    function setInitialView(zoomLevel = DEFAULT_ZOOM) {
        const containerWidth = canvasContainer.offsetWidth;
        const containerHeight = canvasContainer.offsetHeight;
        const viewportCenterX = containerWidth / 2;
        const viewportCenterY = containerHeight / 2;
        const canvasActualCenterX = fabricCanvas.width / 2;
        const canvasActualCenterY = fabricCanvas.height / 2;
        const panX = viewportCenterX - (canvasActualCenterX * zoomLevel);
        const panY = viewportCenterY - (canvasActualCenterY * zoomLevel);
        fabricCanvas.setViewportTransform([zoomLevel, 0, 0, zoomLevel, panX, panY]);
        if (typeof updateViewportInfo === 'function') updateViewportInfo();
        fabricCanvas.renderAll();
    }

    let viewportInfoDiv = document.getElementById('viewport-info');
    if (!viewportInfoDiv) {
        viewportInfoDiv = document.createElement('div');
        viewportInfoDiv.id = 'viewport-info';
        document.body.appendChild(viewportInfoDiv);
    }

    fabricCanvas.freeDrawingBrush.color = currentPenColor;
    fabricCanvas.freeDrawingBrush.width = currentPenSize;
    penSizeSelect.value = currentPenSize;
    const initialPenColorBtn = document.querySelector(`#penSettings .color-btn[data-tool="pen"][data-color="${currentPenColor}"]`);
    if (initialPenColorBtn) initialPenColorBtn.classList.add('selected');

    freeTextSizeSelect.value = currentTextSize;
    const initialTextColorBtn = document.querySelector(`#freeTextSettings .color-btn[data-tool="freeText"][data-color="${currentTextColor}"]`);
    if (initialTextColorBtn) initialTextColorBtn.classList.add('selected');

    window.lastOpenedTipup = null;
    function closeAllTipups(exceptTipup = null) {
        document.querySelectorAll('.tip-up-settings').forEach(tipup => {
            if (tipup !== exceptTipup) tipup.style.display = 'none';
        });
        if (exceptTipup === null) window.lastOpenedTipup = null;
    }

function positionTipup(buttonElement, tipupElement) {
    // 팁업을 띄울 기준이 되는 요소(앵커)를 찾습니다.
    // 클릭된 버튼이 .button-group 안에 있으면 그룹 전체를, 아니면 버튼 자체를 기준으로 합니다.
    const anchorElement = buttonElement.closest('.button-group') || buttonElement;
    const anchorRect = anchorElement.getBoundingClientRect(); // 기준 요소의 화면 좌표

    // 팁업을 먼저 화면에 표시해야 정확한 높이(offsetHeight)를 알 수 있습니다.
    // 단, 보이지 않게 처리합니다.
    tipupElement.style.display = 'flex'; // 또는 'block'
    tipupElement.style.visibility = 'hidden';
    tipupElement.style.opacity = '0';

    const tipupHeight = tipupElement.offsetHeight;

    tipupElement.style.position = 'fixed';

    // 1. Y 좌표: 기준 요소의 상단(anchorRect.top)에서 팁업의 높이와 약간의 여백(8px)만큼 위로 올립니다.
    // 이렇게 하면 팁업이 버튼을 가리지 않습니다.
    tipupElement.style.top = (anchorRect.top - tipupHeight - 8) + 'px';

    // 2. X 좌표: 기준 요소의 왼쪽(anchorRect.left)에 정확히 맞춥니다.
    tipupElement.style.left = anchorRect.left + 'px';

    // 화면 경계 처리 (기존과 동일)
    if (parseFloat(tipupElement.style.left) < 0) {
        tipupElement.style.left = '5px';
    }
    if (parseFloat(tipupElement.style.left) + tipupElement.offsetWidth > window.innerWidth) {
        tipupElement.style.left = (window.innerWidth - tipupElement.offsetWidth - 5) + 'px';
    }

    // 토글 로직
    const isVisible = tipupElement.style.visibility === 'visible';

    if (isVisible && tipupElement === window.lastOpenedTipup) {
        tipupElement.style.display = 'none';
        window.lastOpenedTipup = null;
    } else {
        closeAllTipups();
        tipupElement.style.display = 'flex'; // 다시 보이게
        tipupElement.style.visibility = 'visible'; // 다시 보이게
        tipupElement.style.opacity = '1'; // 다시 보이게
        window.lastOpenedTipup = tipupElement;
    }
}    
    function positionViewportInfo() {
        if (!viewportInfoDiv || !selectMoveToggleBtn || viewportInfoDiv.style.display === 'none') return;
        const btnRect = selectMoveToggleBtn.getBoundingClientRect();
        const infoHeight = viewportInfoDiv.offsetHeight;
        const infoWidth = viewportInfoDiv.offsetWidth;
        let topPosition = btnRect.top - infoHeight - 8;
        let leftPosition = btnRect.left + (btnRect.width / 2) - (infoWidth / 2);
        if (topPosition < 5) topPosition = 5;
        if (leftPosition < 5) leftPosition = 5;
        if (leftPosition + infoWidth > window.innerWidth - 5) leftPosition = window.innerWidth - infoWidth - 5;
        viewportInfoDiv.style.top = topPosition + 'px';
        viewportInfoDiv.style.left = leftPosition + 'px';
    }

    function updateButtonActiveState() {
        selectMoveToggleBtn.classList.remove('active-select', 'active-move');
        penModeBtn.classList.remove('active-select');
        freeTextModeBtn.classList.remove('active-select');

        if (currentMode === 'select') {
            selectMoveToggleBtn.classList.add('active-select');
            selectMoveLabel.textContent = '선택';
        } else if (currentMode === 'move') {
            selectMoveToggleBtn.classList.add('active-move');
            selectMoveLabel.textContent = '이동';
        } else if (currentMode === 'pen') {
            penModeBtn.classList.add('active-select');
            selectMoveLabel.textContent = '선택';
        } else if (currentMode === 'text') {
            freeTextModeBtn.classList.add('active-select');
            selectMoveLabel.textContent = '선택';
        }

        if (viewportInfoDiv) {
            const showInfo = currentMode === 'move' && toolbarVisible;
            viewportInfoDiv.style.display = showInfo ? 'block' : 'none';
            if (showInfo) {
                updateViewportInfo();
                positionViewportInfo();
            }
        }
    }

    function getTargetLayerForDrawing() {
        if (editLayerCheckbox.checked) return 'editLayer';
        if (scheduleLayerCheckbox.checked) return 'scheduleLayer';
        return null;
    }


    if (toolbarHideBtn && toolbarElement && toolbarToggleElement) {
        toolbarHideBtn.addEventListener('click', () => {
            toolbarVisible = !toolbarVisible;
            toolbarElement.style.display = toolbarVisible ? 'flex' : 'none';
            toolbarToggleElement.style.display = toolbarVisible ? (toolbarWrapper.matches(':hover') ? 'block' : '') : 'block';
            toolbarHideBtn.innerHTML = toolbarVisible ? '<span class="arrow-down">▼</span>' : '<span class="arrow-up">▲</span>';
            if (typeof updateButtonActiveState === 'function') updateButtonActiveState();
        });
        toolbarWrapper.addEventListener('mouseenter', () => {
            if (toolbarVisible) toolbarToggleElement.style.display = 'block';
        });
        toolbarWrapper.addEventListener('mouseleave', () => {
            if (toolbarVisible) toolbarToggleElement.style.display = '';
        });
    }

    selectMoveToggleBtn.addEventListener('click', () => {
        if (currentMode === 'select') {
            currentMode = 'move';
            fabricCanvas.isDrawingMode = false;
            fabricCanvas.selection = false;
            fabricCanvas.defaultCursor = 'grab';
            fabricCanvas.forEachObject(obj => obj.selectable = false);
        } else {
            currentMode = 'select';
            fabricCanvas.isDrawingMode = false;
            fabricCanvas.selection = true;
            fabricCanvas.defaultCursor = 'default';
            updateLayerObjectsState();
        }
        fabricCanvas.off('mouse:down', addTextToCanvas);
        updateButtonActiveState();
    });

    fabricCanvas.on('mouse:down', (opt) => {
        if (currentMode === 'move' && opt.e) {
            isPanning = true;
            lastPanPoint = { x: opt.e.clientX, y: opt.e.clientY };
            fabricCanvas.setCursor('grabbing');
        }
    });
    fabricCanvas.on('mouse:move', (opt) => {
        if (isPanning && currentMode === 'move' && opt.e) {
            const deltaX = opt.e.clientX - lastPanPoint.x;
            const deltaY = opt.e.clientY - lastPanPoint.y;
            lastPanPoint = { x: opt.e.clientX, y: opt.e.clientY };
            fabricCanvas.relativePan(new fabric.Point(deltaX, deltaY));
            updateViewportInfo();
        }
    });
    fabricCanvas.on('mouse:up', () => {
        if (currentMode === 'move') {
            isPanning = false;
            fabricCanvas.setCursor('grab');
            if (dataManager && typeof dataManager.debouncedSaveCanvasState === 'function') {
                dataManager.debouncedSaveCanvasState();
            }
        }
    });

// --- 터치 이벤트 핸들러 시작 ---

// 터치 시작 이벤트 핸들러
fabricCanvas.on('touch:start', function(opt) {
    // '이동 모드'이고, 화면에 손가락이 하나만 닿았을 때만 실행
    if (currentMode === 'move' && opt.e.touches && opt.e.touches.length === 1) {
        opt.e.preventDefault(); // 페이지 전체가 스크롤되는 것을 방지
        isPanning = true;
        // 터치 좌표는 touches 배열의 첫 번째 값에서 가져옴
        lastPanPoint = { x: opt.e.touches[0].clientX, y: opt.e.touches[0].clientY };
    }
});

// 터치 이동 이벤트 핸들러
fabricCanvas.on('touch:move', function(opt) {
    if (isPanning && currentMode === 'move' && opt.e.touches && opt.e.touches.length === 1) {
        opt.e.preventDefault(); // 페이지 스크롤 방지
        const touch = opt.e.touches[0];
        const deltaX = touch.clientX - lastPanPoint.x;
        const deltaY = touch.clientY - lastPanPoint.y;
        
        lastPanPoint = { x: touch.clientX, y: touch.clientY };
        fabricCanvas.relativePan(new fabric.Point(deltaX, deltaY));
        updateViewportInfo();
    }
});

// 터치 종료 이벤트 핸들러
fabricCanvas.on('touch:end', function(opt) {
    if (currentMode === 'move') {
        isPanning = false;
        // 터치가 끝나면 변경된 캔버스 상태를 저장하는 로직 호출 (마우스와 동일)
        if (dataManager && typeof dataManager.debouncedSaveCanvasState === 'function') {
            dataManager.debouncedSaveCanvasState();
        }
    }
});

// --- 터치 이벤트 핸들러 끝 ---



    function updateLayerObjectsState() {
        const editLayerVisible = editLayerCheckbox.checked;
        const scheduleLayerVisible = scheduleLayerCheckbox.checked;

        fabricCanvas.forEachObject(function(obj) {
            let isVisible = false;
            let isSelectable = false;
            let isEvented = false;

            if (obj.customLayer === 'editLayer' || !obj.customLayer) {
                isVisible = editLayerVisible;
                isSelectable = editLayerVisible && (currentMode === 'select');
                isEvented = editLayerVisible;
            } else if (obj.customLayer === 'scheduleLayer') {
                isVisible = scheduleLayerVisible;
                isSelectable = scheduleLayerVisible && (currentMode === 'select');
                isEvented = scheduleLayerVisible;
            }
            
            obj.visible = isVisible;
            obj.selectable = isSelectable;
            obj.evented = isEvented;

            if (currentMode === 'text' || currentMode === 'pen' || currentMode === 'move') {
                 obj.selectable = false;
                 if(currentMode === 'text') obj.evented = false;
            }
        });

        const activeObject = fabricCanvas.getActiveObject();
        if (activeObject) {
            const layerOfActive = activeObject.customLayer || 'editLayer';
            if ((layerOfActive === 'editLayer' && !editLayerVisible) ||
                (layerOfActive === 'scheduleLayer' && !scheduleLayerVisible)) {
                fabricCanvas.discardActiveObject();
            }
        }
        fabricCanvas.requestRenderAll();
        
        console.log('script.js: View reset to home after schedule load.'); // 확인용 로그
    }
    editLayerCheckbox.addEventListener('change', updateLayerObjectsState);
    scheduleLayerCheckbox.addEventListener('change', updateLayerObjectsState);


    bgColorBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        positionTipup(bgColorBtn, bgColorTipup);
    });
    bgColorOptions.forEach(option => {
        option.addEventListener('click', () => {
            fabricCanvas.setBackgroundColor(option.dataset.color, () => {
                fabricCanvas.renderAll();
                if (dataManager) dataManager.debouncedSaveCanvasState();
                debouncedRecordState();
            });
            closeAllTipups();
        });
    });

    penModeBtn.addEventListener('click', () => {
        if (currentMode === 'pen') {
            currentMode = 'select';
            fabricCanvas.isDrawingMode = false;
            fabricCanvas.defaultCursor = 'default';
            updateLayerObjectsState();
        } else {
            currentMode = 'pen';
            fabricCanvas.isDrawingMode = true;
            fabricCanvas.selection = false;
            fabricCanvas.defaultCursor = 'crosshair';
            fabricCanvas.freeDrawingBrush.color = currentPenColor;
            fabricCanvas.freeDrawingBrush.width = currentPenSize;
            fabricCanvas.forEachObject(obj => {
                 obj.selectable = false;
                 obj.evented = true;
            });
            fabricCanvas.off('mouse:down', addTextToCanvas);
        }
        updateButtonActiveState();
    });
    penTipupBtn.addEventListener('click', (e) => { e.stopPropagation(); positionTipup(penTipupBtn, penSettings); });
    penColorOptions.forEach(option => {
        option.addEventListener('click', () => {
            currentPenColor = option.dataset.color;
            fabricCanvas.freeDrawingBrush.color = currentPenColor;
            penColorOptions.forEach(o => o.classList.remove('selected'));
            const currentActiveBtn = penSettings.querySelector(`.color-btn[data-tool="pen"][data-color="${currentPenColor}"]`);
            if(currentActiveBtn) currentActiveBtn.classList.add('selected');
        });
    });
    penSizeSelect.addEventListener('change', () => {
        currentPenSize = parseInt(penSizeSelect.value);
        fabricCanvas.freeDrawingBrush.width = currentPenSize;
    });
    fabricCanvas.on('path:created', function(e) {
        if (!e.path) return;
        const targetLayer = getTargetLayerForDrawing();
        if (targetLayer) {
            e.path.customLayer = targetLayer;
            const objects = fabricCanvas.getObjects();
            objects.sort((a, b) => {
                if (a.customLayer === 'editLayer' && b.customLayer !== 'editLayer') return 1;
                if (a.customLayer !== 'editLayer' && b.customLayer === 'editLayer') return -1;
                return 0;
            });
            objects.forEach((obj, index) => fabricCanvas.moveTo(obj, index));
        } else {
            alert("그림을 추가할 레이어를 선택해주세요 (편집용 또는 스케줄용).");
            fabricCanvas.remove(e.path);
            return;
        }
        updateLayerObjectsState();
        fabricCanvas.renderAll();
        if (dataManager) dataManager.debouncedSaveCanvasState();
        debouncedRecordState();
    });

    freeTextModeBtn.addEventListener('click', () => {
        if (currentMode === 'text') {
            currentMode = 'select';
            fabricCanvas.isDrawingMode = false;
            fabricCanvas.defaultCursor = 'default';
            fabricCanvas.off('mouse:down', addTextToCanvas);
            fabricCanvas.selection = true;
            updateLayerObjectsState();
        } else {
            fabricCanvas.isDrawingMode = false;
            currentMode = 'text';
            fabricCanvas.selection = false;
            fabricCanvas.defaultCursor = 'text';
            fabricCanvas.forEachObject(obj => {
                obj.selectable = false;
                obj.evented = false;
            });
            fabricCanvas.discardActiveObject();
            fabricCanvas.renderAll();
            fabricCanvas.on('mouse:down', addTextToCanvas);
        }
        updateButtonActiveState();
    });

    freeTextTipupBtn.addEventListener('click', (e) => { e.stopPropagation(); positionTipup(freeTextTipupBtn, freeTextSettings); });
    freeTextColorOptions.forEach(option => {
        option.addEventListener('click', () => {
            currentTextColor = option.dataset.color;
            const activeObject = fabricCanvas.getActiveObject();
            if (activeObject && (activeObject.type === 'i-text' || activeObject.type === 'textbox')) {
                activeObject.set('fill', currentTextColor);
                fabricCanvas.renderAll();
                if (dataManager) dataManager.debouncedSaveCanvasState();
            }
            freeTextColorOptions.forEach(o => o.classList.remove('selected'));
            const currentActiveBtn = freeTextSettings.querySelector(`.color-btn[data-tool="freeText"][data-color="${currentTextColor}"]`);
            if(currentActiveBtn) currentActiveBtn.classList.add('selected');
        });
    });
    freeTextSizeSelect.addEventListener('change', () => {
        currentTextSize = parseInt(freeTextSizeSelect.value);
        const activeObject = fabricCanvas.getActiveObject();
        if (activeObject && (activeObject.type === 'i-text' || activeObject.type === 'textbox')) {
            activeObject.set('fontSize', currentTextSize);
            fabricCanvas.renderAll();
            if (dataManager) dataManager.debouncedSaveCanvasState();
        }
    });
    function addTextToCanvas(options) {
        if (currentMode !== 'text' || options.target || !options.e) return;
    
        const targetLayer = getTargetLayerForDrawing();
        if (!targetLayer) {
            alert('텍스트를 배치할 레이어를 선택해주세요 (편집용 또는 스케줄용).');
            return;
        }
    
        const pointer = fabricCanvas.getPointer(options.e);
        const text = new fabric.IText('텍스트 입력', {
            left: pointer.x, top: pointer.y,
            fontSize: currentTextSize, fill: currentTextColor,
            customLayer: targetLayer, padding: 5,
            originX: 'left', originY: 'top'
        });
        fabricCanvas.add(text);
    
        text.on('editing:exited', function() {
            if (dataManager && typeof dataManager.debouncedSaveCanvasState === 'function') {
                dataManager.debouncedSaveCanvasState();
                debouncedRecordState();
            }
            currentMode = 'select';
            fabricCanvas.isDrawingMode = false;
            fabricCanvas.selection = true;
            fabricCanvas.defaultCursor = 'default';
            fabricCanvas.off('mouse:down', addTextToCanvas);
    
            updateButtonActiveState();
            updateLayerObjectsState();
        });
    
        const objects = fabricCanvas.getObjects();
        objects.sort((a, b) => {
            if (a.customLayer === 'editLayer' && b.customLayer !== 'editLayer') return 1;
            if (a.customLayer !== 'editLayer' && b.customLayer === 'editLayer') return -1;
            return 0;
        });
        objects.forEach((obj, index) => fabricCanvas.moveTo(obj, index));
                                  
        fabricCanvas.setActiveObject(text);
        text.enterEditing();
        text.selectAll();
        fabricCanvas.renderAll();
    }


    eraserModeBtn.addEventListener('click', () => {
        const activeObjects = fabricCanvas.getActiveObjects();
        if (activeObjects.length > 0) {
            activeObjects.forEach(obj => { fabricCanvas.remove(obj) });
            fabricCanvas.discardActiveObject();
            fabricCanvas.renderAll();
            if (dataManager) dataManager.debouncedSaveCanvasState();
            debouncedRecordState();
        }
    });
    clearAllBtn.addEventListener('click', () => { clearConfirmModal.style.display = 'block'; });
    confirmClearBtn.addEventListener('click', () => {
        const objectsToRemove = [];
        const editLayerChecked = editLayerCheckbox.checked;
        const scheduleLayerChecked = scheduleLayerCheckbox.checked;
        fabricCanvas.forEachObject(function(obj) {
            if (editLayerChecked && (obj.customLayer === 'editLayer' || !obj.customLayer)) {
                objectsToRemove.push(obj);
            }
            if (scheduleLayerChecked && obj.customLayer === 'scheduleLayer') {
                 objectsToRemove.push(obj);
            }
        });
        objectsToRemove.forEach(obj => fabricCanvas.remove(obj));
        clearConfirmModal.style.display = 'none';
        fabricCanvas.renderAll();
        if (objectsToRemove.length > 0 && dataManager) dataManager.debouncedSaveCanvasState();
        debouncedRecordState();
    });
    cancelClearBtn.addEventListener('click', () => { clearConfirmModal.style.display = 'none'; });
    if(closeClearConfirmModal) closeClearConfirmModal.onclick = () => clearConfirmModal.style.display = 'none';

    homeBtn.addEventListener('click', () => { setInitialView(DEFAULT_ZOOM); });




    function updateViewportInfo() {
        if (!viewportInfoDiv) return;
        const zoom = fabricCanvas.getZoom();
        const vpt = fabricCanvas.viewportTransform;
        const canvasActualCenterX = fabricCanvas.width / 2;
        const canvasActualCenterY = fabricCanvas.height / 2;
        const canvasCoordAtViewportCenter_X = ( (canvasContainer.offsetWidth / 2) - vpt[4]) / zoom;
        const canvasCoordAtViewportCenter_Y = ( (canvasContainer.offsetHeight / 2) - vpt[5]) / zoom;
        const userCoordX = canvasCoordAtViewportCenter_X - canvasActualCenterX;
        const userCoordY = canvasCoordAtViewportCenter_Y - canvasActualCenterY;
        viewportInfoDiv.innerHTML = `<div>배율: ${zoom.toFixed(1)},  X: ${userCoordX.toFixed(0)}, Y: ${userCoordY.toFixed(0)}</div>`;
    }

fabricCanvas.on('mouse:wheel', function(opt) {
    if (!opt.e) return;

    // --- 1단계: 줌 레벨 계산 및 실행 ---
    const delta = opt.e.deltaY;
    let zoom = fabricCanvas.getZoom();
    
    zoom *= 0.999 ** delta;
    if (zoom > MAX_ZOOM) zoom = MAX_ZOOM;
    if (zoom < MIN_ZOOM) zoom = MIN_ZOOM;

    // 줌 기준점: 화면 중앙
    const viewportCenter = new fabric.Point(
        canvasContainer.offsetWidth / 2,
        canvasContainer.offsetHeight / 2
    );
    fabricCanvas.zoomToPoint(viewportCenter, zoom);

    // --- 2단계 (경계 제한 로직) ---
    // 이 부분의 모든 로직을 생략합니다.

    // --- 3단계: 최종 적용 및 후속 작업 ---
    opt.e.preventDefault();
    opt.e.stopPropagation();
    
    // 부가 기능 호출
    if (typeof updateViewportInfo === 'function') {
        updateViewportInfo();
    }
    if (dataManager && typeof dataManager.debouncedSaveCanvasState === 'function') {
        dataManager.debouncedSaveCanvasState();
    }
});

    fabricCanvas.on('object:modified', (e) => { if (dataManager) dataManager.debouncedSaveCanvasState(); });
    debouncedRecordState();

    document.addEventListener('click', (e) => {
        const target = e.target;
        if (!target.closest('.tip-up-settings') && 
            !target.closest('.tipup-toggle-btn') && 
            target !== bgColorBtn && !bgColorBtn.contains(target) ) {
            closeAllTipups();
        }
    });
    

    if (toolbarElement && toolbarToggleElement && toolbarHideBtn) {
        toolbarElement.style.display = toolbarVisible ? 'flex' : 'none';
        toolbarToggleElement.style.display = toolbarVisible ? (toolbarWrapper.matches(':hover') ? 'block' : '') : 'block';
        toolbarHideBtn.innerHTML = toolbarVisible ? '<span class="arrow-down">▼</span>' : '<span class="arrow-up">▲</span>';
    }
    
    function formatDateForSaveDisplay(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${year}년 ${month}월 ${day}일 ${hours}시 ${minutes}분 ${seconds}초`;
    }
    
    let currentSaveOperationCallback = null;

    function openSaveConfirmModal(callback) {
        currentSaveOperationCallback = callback;
        saveScreenNameInput.value = "제목 없음"; // 기본값 "제목 없음"
        saveModalTimestamp.textContent = formatDateForSaveDisplay(new Date());
        saveConfirmModal.style.display = 'block';
        saveScreenNameInput.focus();
        saveScreenNameInput.select(); // 입력 필드 내용 전체 선택
    }


    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            if (!dataManager) { console.error("DataManager 미초기화"); return; }
    
            openSaveConfirmModal(async (baseName, timestampString) => {
                // data.js에서 baseName과 timestampString을 조합하여 screenKey를 생성하고,
                // baseName은 displayName으로, timestampString은 savedAt으로 저장할 것임.
                const editChecked = editLayerCheckbox.checked;
                const scheduleChecked = scheduleLayerCheckbox.checked;
    
                if (!editChecked && !scheduleChecked) {
                    alert("저장할 내용을 포함할 레이어를 하나 이상 선택해주세요 (툴바 체크박스).");
                    saveConfirmModal.style.display = 'none';
                    return;
                }
                let objectsToSaveCount = 0;
                fabricCanvas.getObjects().forEach(obj => {
                    if (editChecked && scheduleChecked) {
                        objectsToSaveCount++;
                    } else if (editChecked && (obj.customLayer === 'editLayer' || !obj.customLayer)) {
                        objectsToSaveCount++;
                    } else if (scheduleChecked && obj.customLayer === 'scheduleLayer') {
                        objectsToSaveCount++;
                    }
                });
    
                if (objectsToSaveCount === 0) {
                    if (!confirm("선택된 레이어에 저장할 내용이 없습니다. 빈 화면으로 저장하시겠습니까?")) {
                        saveConfirmModal.style.display = 'none';
                        return;
                    }
                }
    
                try {
                    // dataManager.saveNamedScreen는 이제 baseName과 timestampString을 받음
                    const savedKey = await dataManager.saveNamedScreen(baseName, timestampString, editChecked, scheduleChecked);
                    alert(`'${baseName}' 화면 저장 완료 (저장 시각: ${timestampString}).`);
                    if (scheduleModal.style.display === 'block') populateScheduledContentSelect();
                    if (loadSavedScreenModal.style.display === 'block') populateSavedScreenList();
                } catch (error) {
                    alert(`화면 저장 실패: ${error}`);
                    console.error("화면 저장 실패:", error);
                }
                saveConfirmModal.style.display = 'none';
            });
        });
    }
    
    if (confirmSaveBtn) {
        confirmSaveBtn.addEventListener('click', () => {
            const baseName = saveScreenNameInput.value.trim();
            const timestampString = saveModalTimestamp.textContent;
            if (baseName === "") {
                alert("화면 제목을 입력해주세요.");
                return;
            }
            if (currentSaveOperationCallback) {
                currentSaveOperationCallback(baseName, timestampString);
            }
        });
    }
    
    if (cancelSaveBtn) cancelSaveBtn.onclick = () => saveConfirmModal.style.display = 'none';
    if (closeSaveConfirmModalBtn) closeSaveConfirmModalBtn.onclick = () => saveConfirmModal.style.display = 'none';


    async function populateSavedScreenList() {
        if (!savedScreenListUl || !noSavedScreensP || !dataManager) return;
        try {
            // dataManager.getSavedScreensList()는 이제 {key, displayName, savedAt} 객체 배열 반환
            const screens = await dataManager.getSavedScreensList();
            savedScreenListUl.innerHTML = '';
            noSavedScreensP.style.display = screens.length === 0 ? 'block' : 'none';
            savedScreenListUl.style.display = screens.length > 0 ? 'block' : 'none';
    
            screens.forEach(screen => {
                const li = document.createElement('li');
    
                li.classList.add('saved-screen-list-item'); // CSS에서 사용할 클래스 추가

                // 화면 정보 (이름 + 타임스탬프)를 담을 div
                const screenInfoDiv = document.createElement('div');
                screenInfoDiv.classList.add('screen-info-container'); // CSS 클래스

                const nameSpan = document.createElement('span');
                nameSpan.classList.add('screen-name-display'); // CSS 클래스
                nameSpan.textContent = screen.displayName;
                nameSpan.title = `${screen.displayName} (${screen.savedAt})`; // 툴팁용 전체 텍스트
                screenInfoDiv.appendChild(nameSpan);

                const timestampSpan = document.createElement('span');
                timestampSpan.classList.add('screen-timestamp-display'); // CSS 클래스
                timestampSpan.textContent = `(${screen.savedAt})`;
                // timestampSpan.title = `${screen.displayName} (${screen.savedAt})`; // 이름에도 이미 있으므로 중복 방지
                screenInfoDiv.appendChild(timestampSpan);
                
                li.appendChild(screenInfoDiv);

                // 버튼들을 담을 div
                const buttonsDiv = document.createElement('div');
                buttonsDiv.classList.add('screen-item-actions'); // CSS 클래스

                const deleteBtn = document.createElement('button');
                deleteBtn.textContent = '삭제';
                deleteBtn.classList.add('delete-saved-item-btn'); // 기존 클래스 유지
                deleteBtn.onclick = async (evt) => {
                    evt.stopPropagation();
                    if (confirm(`'${screen.displayName}' (${screen.savedAt}) 화면을 정말 삭제하시겠습니까? 관련된 모든 스케줄도 함께 삭제됩니다.`)) {
                        try {
                            await dataManager.deleteNamedScreen(screen.key);
                            populateSavedScreenList();
                            if (scheduleModal.style.display === 'block') populateScheduledContentSelect();
                        } catch (delErr) { alert("화면 삭제 오류: " + delErr); }
                    }
                };
                buttonsDiv.appendChild(deleteBtn);
                // 만약 '수정' 버튼도 있다면 여기에 추가
                // const editBtn = document.createElement('button');
                // ...
                // buttonsDiv.appendChild(editBtn);

                li.appendChild(buttonsDiv);
                // -- HTML 구조 변경 끝 --

                li.addEventListener('click', async () => {
                    // ... (기존 클릭 이벤트 리스너 내용은 유지) ...
                    if (confirm(`'${screen.displayName}' 화면을 불러오시겠습니까? 현재 작업 내용은 덮어씌워집니다.`)) {
                        try {
                            await dataManager.loadNamedScreen(screen.key); 
                            loadSavedScreenModal.style.display = 'none';
                        } catch (loadErr) { alert("화면 불러오기 오류: " + loadErr); }
                    }
                });
                savedScreenListUl.appendChild(li);
            });

        } catch (error) {
            console.error("저장된 화면 목록 표시 오류:", error);
            noSavedScreensP.textContent = "목록을 불러오는 중 오류 발생";
            noSavedScreensP.style.display = 'block';
            savedScreenListUl.style.display = 'none';
        }
    }

    if (loadGeneralBtn) {
        loadGeneralBtn.addEventListener('click', () => {
            populateSavedScreenList();
            loadSavedScreenModal.style.display = 'block';
        });
    }
    if (closeLoadSavedScreenModalBtn) closeLoadSavedScreenModalBtn.onclick = () => loadSavedScreenModal.style.display = 'none';

    let currentEditingScheduleId = null;
    async function populateScheduledContentSelect(currentScreenKeyForEdit = null) {
        if (!scheduledContentSelect || !dataManager) return;
        try {
            // getSavedScreensList는 {key, displayName, savedAt} 객체 배열 반환
            const screens = await dataManager.getSavedScreensList();
            const originalValue = scheduledContentSelect.value; // 이전 선택된 screenKey
            scheduledContentSelect.innerHTML = '<option value="">-- 화면 선택 --</option>';
            const newSaveOption = document.createElement('option');
            newSaveOption.value = "current_canvas_new_save";
            newSaveOption.textContent = "** 현재 캔버스 내용으로 새 화면 저장 **";
            scheduledContentSelect.appendChild(newSaveOption);
    
            screens.forEach(screen => {
                const option = document.createElement('option');
                option.value = screen.key; // option의 value는 screenKey
                option.textContent = `${screen.displayName} (${screen.savedAt})`; // 표시되는 텍스트
                scheduledContentSelect.appendChild(option);
            });
    
            if (currentScreenKeyForEdit) {
                 scheduledContentSelect.value = currentScreenKeyForEdit;
            } else if (originalValue && screens.some(s => s.key === originalValue)) {
                 scheduledContentSelect.value = originalValue;
            }
        } catch (error) { console.error("스케줄 모달 화면 목록 채우기 오류:", error); }
    }

    if (deleteSelectedScheduledScreenBtn && scheduledContentSelect) {
        deleteSelectedScheduledScreenBtn.addEventListener('click', async () => {
            if (!dataManager) { console.error("DataManager 미초기화"); return; }
            const selectedScreenKey = scheduledContentSelect.value; // 이제 screenKey
             if (selectedScreenKey && selectedScreenKey !== "current_canvas_new_save" && selectedScreenKey !== "") {
                const selectedOptionText = scheduledContentSelect.options[scheduledContentSelect.selectedIndex].text;
                if (confirm(`'${selectedOptionText}' 화면을 정말 삭제하시겠습니까? 이 화면을 사용하는 모든 스케줄도 삭제됩니다.`)) {
                    try {
                        await dataManager.deleteNamedScreen(selectedScreenKey); // screenKey로 삭제
                        alert(`'${selectedOptionText}' 화면 및 관련 스케줄 삭제 완료.`);
                        populateScheduledContentSelect();
                        renderScheduleList();
                        if (loadSavedScreenModal.style.display === 'block') populateSavedScreenList();
                    } catch (err) { alert("화면 삭제 오류: " + err); }
                }
            } else { alert("삭제할 저장된 화면을 선택해주세요."); }
        });
    }

    async function renderScheduleList() {
        if (!scheduleListUl || !dataManager) return;
        try {
            const schedules = await dataManager.getAllScheduleEntries();
            // 스케줄 목록에 있는 screenName (실제로는 screenKey)을 displayName과 savedAt으로 변환하기 위해
            // 모든 저장된 화면 정보를 가져와 매핑 준비
            const savedScreens = await dataManager.getSavedScreensList();
            const screenMap = new Map(savedScreens.map(s => [s.key, s]));


            scheduleListUl.innerHTML = '';
            const daysOfWeek = ['일', '월', '화', '수', '목', '금', '토'];
            schedules.forEach(schedule => {
                const li = document.createElement('li');
                li.classList.add('schedule-list-item'); // CSS용 클래스

                const scheduleInfoDiv = document.createElement('div');
                scheduleInfoDiv.classList.add('schedule-info-container');

                const daysText = schedule.days.map(d => daysOfWeek[d]).join(', ');
                const screenDetail = screenMap.get(schedule.screenName);
                const displayScreenName = screenDetail ? `${screenDetail.displayName} (${screenDetail.savedAt})` : schedule.screenName;
                
                const scheduleTextSpan = document.createElement('span');
                scheduleTextSpan.classList.add('schedule-text-display');
                scheduleTextSpan.textContent = `[${daysText}] ${schedule.time} - ${displayScreenName}`;
                scheduleTextSpan.title = scheduleTextSpan.textContent; // 툴팁
                scheduleInfoDiv.appendChild(scheduleTextSpan);

                li.appendChild(scheduleInfoDiv);

                const btnContainer = document.createElement('div');
                btnContainer.classList.add('schedule-item-actions'); // CSS용 클래스

                const editBtn = document.createElement('button');
                editBtn.textContent = '수정';
                editBtn.onclick = () => {
                    currentEditingScheduleId = schedule.id;
                    scheduleDayCheckboxesContainer.querySelectorAll('input[name="scheduleDay"]').forEach(cb => {
                        cb.checked = schedule.days.includes(parseInt(cb.value));
                    });
                    scheduleTimeInput.value = schedule.time;
                    populateScheduledContentSelect(schedule.screenName); // screenName은 screenKey
                    addScheduleEntryBtn.textContent = '스케줄 수정';
                };
                btnContainer.appendChild(editBtn);

                const deleteBtn = document.createElement('button');
                deleteBtn.textContent = '삭제';
                deleteBtn.classList.add('delete-schedule-btn'); // 기존 클래스 유지
                deleteBtn.onclick = async () => {
                    if (confirm("이 스케줄을 삭제하시겠습니까?")) {
                        try {
                            await dataManager.deleteScheduleEntryById(schedule.id);
                            renderScheduleList();
                            if (currentEditingScheduleId === schedule.id) {
                                currentEditingScheduleId = null;
                                addScheduleEntryBtn.textContent = '스케줄 추가';
                            }
                        } catch (delErr) { alert("스케줄 삭제 오류: " + delErr); }
                    }
                };
                btnContainer.appendChild(deleteBtn);

                li.appendChild(btnContainer);
                scheduleListUl.appendChild(li);
            });

        } catch (error) { console.error("스케줄 목록 렌더링 오류:", error); }
    }

    if (scheduleBtn) {
        scheduleBtn.addEventListener('click', () => {
            if (!dataManager) { console.error("DataManager 미초기화"); return; }
            currentEditingScheduleId = null;
            addScheduleEntryBtn.textContent = '스케줄 추가';
            scheduleDayCheckboxesContainer.querySelectorAll('input[name="scheduleDay"]').forEach(cb => cb.checked = false);
            scheduleTimeInput.value = '';
            populateScheduledContentSelect();
            renderScheduleList();
            scheduleModal.style.display = 'block';
        });
    }
    if (closeScheduleModalBtn) closeScheduleModalBtn.onclick = () => scheduleModal.style.display = 'none';

    if (addScheduleEntryBtn) {
        addScheduleEntryBtn.addEventListener('click', async () => {
            if (!dataManager) { console.error("DataManager 미초기화"); return; }
            const selectedDays = Array.from(scheduleDayCheckboxesContainer.querySelectorAll('input[name="scheduleDay"]:checked')).map(cb => parseInt(cb.value));
            const time = scheduleTimeInput.value;
            let screenKeyForSchedule = scheduledContentSelect.value; // 이제 screenKey
    
            if (selectedDays.length === 0 || !time || !screenKeyForSchedule) {
                alert("요일, 시간, 로드할 화면을 모두 올바르게 선택 또는 입력하세요."); return;
            }
    
            if (screenKeyForSchedule === "current_canvas_new_save") {
                openSaveConfirmModal(async (baseName, timestampString) => {
                    const editChecked = editLayerCheckbox.checked;
                    const scheduleChecked = scheduleLayerCheckbox.checked;
    
                    if (!editChecked && !scheduleChecked) {
                        alert("스케줄용 화면 저장 시에도 내용을 포함할 레이어를 하나 이상 선택해야 합니다.");
                        saveConfirmModal.style.display = 'none';
                        return;
                    }
    
                    try {
                        const savedKey = await dataManager.saveNamedScreen(baseName, timestampString, editChecked, scheduleChecked);
                        alert(`'${baseName}' 화면 저장 완료. 이 화면으로 스케줄이 설정됩니다.`);
                        await populateScheduledContentSelect(savedKey); // 새 화면의 key로 select 업데이트
                        
                        const scheduleEntry = { days: selectedDays, time: time, screenName: savedKey }; // screenName에 key 저장
                        if (currentEditingScheduleId !== null) scheduleEntry.id = currentEditingScheduleId;
                        await dataManager.addOrUpdateScheduleEntry(scheduleEntry);
                        renderScheduleList();
                        currentEditingScheduleId = null;
                        addScheduleEntryBtn.textContent = '스케줄 추가';
                        scheduleDayCheckboxesContainer.querySelectorAll('input[name="scheduleDay"]').forEach(cb => cb.checked = false);
                        scheduleTimeInput.value = '';
                        populateScheduledContentSelect();

                    } catch (saveError) {
                        alert("새 화면 저장 오류: " + saveError);
                    }
                    saveConfirmModal.style.display = 'none';
                });
                return; 
            }
    
            const scheduleEntry = { days: selectedDays, time: time, screenName: screenKeyForSchedule };
            if (currentEditingScheduleId !== null) {
                scheduleEntry.id = currentEditingScheduleId;
            }
    
            try {
                await dataManager.addOrUpdateScheduleEntry(scheduleEntry);
                renderScheduleList();
                currentEditingScheduleId = null;
                addScheduleEntryBtn.textContent = '스케줄 추가';
                scheduleDayCheckboxesContainer.querySelectorAll('input[name="scheduleDay"]').forEach(cb => cb.checked = false);
                scheduleTimeInput.value = '';
                populateScheduledContentSelect();
            } catch (error) { alert("스케줄 추가/수정 오류: " + error); }
        });
    }

    // --- 모달 외부 클릭 시 닫기 로직 수정 ---
    let mouseDownTarget = null; // 마우스 다운 시 대상 요소를 저장할 변수

    // 각 모달 요소들을 배열로 관리
    const modalsToManage = [
        { element: scheduleModal, id: 'scheduleModal' },
        { element: loadSavedScreenModal, id: 'loadSavedScreenModal' },
        { element: clearConfirmModal, id: 'clearConfirmModal' },
        { element: saveConfirmModal, id: 'saveConfirmModal' }
    ];

    document.addEventListener('mousedown', function(event) {
        mouseDownTarget = event.target; // 마우스 다운 시 클릭된 요소를 기록
    }, true); // 캡처링 단계에서 처리하여 다른 mousedown 이벤트보다 먼저 실행될 수 있도록

    document.addEventListener('mouseup', function(event) {
        // mouseup 이벤트의 대상이 mousedown 이벤트의 대상과 동일하고,
        // 그 대상이 모달 배경(오버레이)일 경우에만 모달을 닫습니다.
        const mouseUpTarget = event.target;

        modalsToManage.forEach(modalInfo => {
            if (modalInfo.element && modalInfo.element.style.display !== 'none') { // 모달이 열려 있을 때만
                // mousedown과 mouseup이 동일한 요소에서 발생했고, 그 요소가 모달 배경 자신일 때
                if (mouseDownTarget === mouseUpTarget && mouseUpTarget === modalInfo.element) {
                    modalInfo.element.style.display = 'none';
                    // console.log(`${modalInfo.id} closed by clicking outside (target match).`);
                }
            }
        });
        mouseDownTarget = null; // 다음 클릭을 위해 초기화
    }, true); // 캡처링 단계

    // --- 모달 외부 클릭 수정 끝 ---


    const debouncedRecordState = debounce(() => recordState(fabricCanvas), 300);
    
    initializeClipboard(fabricCanvas, {
        getTargetLayerForDrawing: getTargetLayerForDrawing,
        debouncedSaveCanvasState: () => { if (dataManager) dataManager.debouncedSaveCanvasState(); }
    }, debouncedRecordState);
    
    
initializeHistory(fabricCanvas);
    
    if (typeof initializeDataAndScheduleFunctions === 'function') {
        dataManager = initializeDataAndScheduleFunctions(
            fabricCanvas,
            {
                debounce: debounce,
                onLoadSuccess: (loadedFabricInstance, loadedToLayer) => {
                    setInitialView(loadedFabricInstance.getZoom());
                    if (loadedToLayer === 'editLayer') {
                        editLayerCheckbox.checked = true;
                    }
                    updateLayerObjectsState();
                    updateViewportInfo();
                    console.log(`화면 로드 완료. 대상 레이어: ${loadedToLayer || '기존 레이어 유지(자동복원)'}`);
                    if (dataManager && dataManager.debouncedSaveCanvasState) {
                        dataManager.debouncedSaveCanvasState();
                    }
                },
                onScheduleLoadSuccess: (loadedFabricInstance, loadedToLayer) => {
                    setInitialView(loadedFabricInstance.getZoom());
                    scheduleLayerCheckbox.checked = true;
                    editLayerCheckbox.checked = false;
                    updateLayerObjectsState();
                    updateViewportInfo();
                    console.log(`스케줄에 의해 화면이 '${loadedToLayer}' 레이어로 로드됨.`);
                    if (dataManager && dataManager.debouncedSaveCanvasState) {
                        dataManager.debouncedSaveCanvasState();
                    }
                },
                onScheduleLoadError: (error, screenName) => {
                    alert(`스케줄된 화면 '${screenName}' 로드 중 오류가 발생했습니다: ${error}`);
                },
                onNoData: () => {
                    setInitialView(DEFAULT_ZOOM);
                    updateLayerObjectsState();
                },
                onLoadError: (error) => {
                    console.error("화면 로드 중 일반 오류:", error);
                    alert(`화면 로드 중 오류가 발생했습니다: ${error}`);
                    setInitialView(DEFAULT_ZOOM);
                    updateLayerObjectsState();
                }
            },
            {
                getTargetLayerForDrawing: getTargetLayerForDrawing,
                getCurrentTextSize: () => currentTextSize,
                getCurrentTextColor: () => currentTextColor,
                debouncedSaveCanvasStateForPaste: () => { if (dataManager) dataManager.debouncedSaveCanvasState(); }
            }
        );
        console.log('data.js 기능 초기화 완료.');

        try {
            if (dataManager && typeof dataManager.loadInitialCanvas === 'function') {
                await dataManager.loadInitialCanvas();
            } else {
                console.warn("dataManager.loadInitialCanvas를 찾을 수 없어 기본 뷰로 시작합니다.");
                setInitialView(DEFAULT_ZOOM);
                updateLayerObjectsState();
            }
        } catch (error) {
            console.error("최초 캔버스 상태 복원 중 오류:", error);
            setInitialView(DEFAULT_ZOOM);
            updateLayerObjectsState();
        }
    } else {
        console.error("오류: initializeDataAndScheduleFunctions를 찾을 수 없습니다. data.js가 로드되었는지 확인하세요.");
        setInitialView(DEFAULT_ZOOM);
        updateLayerObjectsState();
    }


    // ---  Delete 키로 선택 객체 지우기 ---
    document.addEventListener('keydown', function(event) {
        // 입력 필드(input, textarea)나 IText 편집 중에는 작동하지 않도록 함
        const activeElement = document.activeElement;
        const isInputFocused = activeElement.tagName === 'INPUT' || 
                               activeElement.tagName === 'TEXTAREA' ||
                               (activeElement.isContentEditable && activeElement.tagName !== 'BODY');

        const isITextEditing = fabricCanvas.getActiveObject() instanceof fabric.IText && 
                               fabricCanvas.getActiveObject().isEditing;

        if (isInputFocused || isITextEditing) {
            return; // 입력 필드나 IText 편집 중이면 키보드 삭제 기능 무시
        }

        // event.key === 'Delete' (Delete 키) 또는 event.keyCode === 46 (구형 브라우저 호환성)
        if (event.key === 'Delete' || event.code === 'Delete' || event.keyCode === 46) { // [7, 9]
            event.preventDefault(); // 기본 동작 (예: 브라우저 뒤로가기 등) 방지

            const activeObjects = fabricCanvas.getActiveObjects(); // 다중 선택된 객체들도 가져옴 [8, 10]
            if (activeObjects.length > 0) {
                activeObjects.forEach(obj => { 
                    fabricCanvas.remove(obj); // 각 선택된 객체 삭제 [8, 10]
                });
                fabricCanvas.discardActiveObject(); // 선택 해제
                fabricCanvas.renderAll();
                
                // 자동 저장 및 히스토리 저장을 위한 로직 (만약 있다면)
                if (dataManager && typeof dataManager.debouncedSaveCanvasState === 'function') {
                    dataManager.debouncedSaveCanvasState();
                }
                // 만약 Undo/Redo 히스토리 기능이 있다면 여기서 히스토리 저장 호출
                debouncedRecordState();
            }
        }
    });
    // --- Delete 키 핸들러 끝 ---



    updateButtonActiveState();
    updateLayerObjectsState();

/* === [ADD] 툴바 자동 스케일 === */
const BASE_WIDTH = 1500;   // 디자인 기준 폭(px)

function applyToolbarScale(){
  const scale = Math.min(window.innerWidth / BASE_WIDTH, 1); // 1280px보다 클 땐 1
  toolbarScaleWrap.style.transform = `scale(${scale})`;
  /* 스케일로 줄어든 실제 픽셀폭을 다시 100%로 맞춤 */
  toolbarScaleWrap.style.width = `${100 / scale}%`;
}

window.addEventListener('resize', applyToolbarScale);
applyToolbarScale();   



}); // DOMContentLoaded 끝
