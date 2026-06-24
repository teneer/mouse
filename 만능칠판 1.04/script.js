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
    const bgColorTipup = document.querySelector('.tip-up-settings[data-tipup=\"bgcolor\"]');
    const bgColorOptions = bgColorTipup.querySelectorAll('.color-btn');

    const penModeBtn = document.getElementById('penModeBtn');
    const penTipup = document.querySelector('.tip-up-settings[data-tipup=\"pen\"]');
    const penColorOptions = penTipup.querySelectorAll('.color-btn');
    const penWidthSlider = document.getElementById('penWidthSlider');
    const penWidthVal = document.getElementById('penWidthVal');

    const eraserModeBtn = document.getElementById('eraserModeBtn');
    const eraserTipup = document.querySelector('.tip-up-settings[data-tipup=\"eraser\"]');
    const eraserWidthSlider = document.getElementById('eraserWidthSlider');
    const eraserWidthVal = document.getElementById('eraserWidthVal');

    const textModeBtn = document.getElementById('textModeBtn');
    const textTipup = document.querySelector('.tip-up-settings[data-tipup=\"text\"]');
    const textColorOptions = textTipup.querySelectorAll('.color-btn');
    const fontSizeSlider = document.getElementById('fontSizeSlider');
    const fontSizeVal = document.getElementById('fontSizeVal');

    const clearBtn = document.getElementById('clearBtn');
    const addScheduleBtn = document.getElementById('addScheduleBtn');
    const loadSavedScreenBtn = document.getElementById('loadSavedScreenBtn');
    const saveScreenBtn = document.getElementById('saveScreenBtn');

    // 모달 관련 요소들
    const clearConfirmModal = document.getElementById('clearConfirmModal');
    const confirmClearBtn = document.getElementById('confirmClearBtn');
    const cancelClearBtn = document.getElementById('cancelClearBtn');
    const closeClearConfirmModal = document.getElementById('closeClearConfirmModal');

    const loadSavedScreenModal = document.getElementById('loadSavedScreenModal');
    const closeLoadSavedScreenModalBtn = document.getElementById('closeLoadSavedScreenModalBtn');
    const savedScreenList = document.getElementById('savedScreenList');
    const noSavedScreens = document.getElementById('noSavedScreens');

    const saveScreenModal = document.getElementById('saveScreenModal');
    const closeSaveScreenModalBtn = document.getElementById('closeSaveScreenModalBtn');
    const saveScreenForm = document.getElementById('saveScreenForm');
    const screenBaseNameInput = document.getElementById('screenBaseName');
    const saveEditLayerCheckbox = document.getElementById('saveEditLayer');
    const saveScheduleLayerCheckbox = document.getElementById('saveScheduleLayer');

    // 전역 상태 변수들
    let currentMode = 'select'; // 'select', 'move', 'pen', 'eraser', 'text'
    let isPanning = false;         // ⚠️ 상단 선언부 유지
    let lastPanPoint = { x: 0, y: 0 }; // ⚠️ 상단 선언부 유지

    let currentPenColor = '#000000';
    let currentPenWidth = 5;
    let currentEraserWidth = 30;
    let currentTextColor = '#000000';
    let currentFontSize = 40;

    const MIN_ZOOM = 0.1;
    const MAX_ZOOM = 10;

    // 디바운스 유틸리티 함수
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    const debouncedRecordState = debounce(() => {
        recordState(fabricCanvas);
    }, 300);

    // 공통 헬퍼 함수 정의
    const getTargetLayerForDrawing = () => {
        if (editLayerCheckbox.checked) return 'editLayer';
        if (scheduleLayerCheckbox.checked) return 'scheduleLayer';
        return 'editLayer';
    };

    // 묘화용 유틸리티 묶음 (임포트된 모듈 등에 전달용)
    const utilsForPaste = {
        getTargetLayerForDrawing: getTargetLayerForDrawing,
        debouncedSaveCanvasState: () => {
            if (dataManager && typeof dataManager.debouncedSaveCanvasState === "function") {
                dataManager.debouncedSaveCanvasState();
            }
        }
    };

    // 외부 모듈 초기화 (clipboard, history)
    initializeClipboard(fabricCanvas, utilsForPaste, debouncedRecordState);
    initializeHistory(fabricCanvas);

    // 전역 단축키 처리 모듈 (data.js) 로드 후 인스턴스 획득
    let dataManager = null;
    if (typeof initializeDataAndScheduleFunctions === 'function') {
        dataManager = initializeDataAndScheduleFunctions(fabricCanvas, {
            debounce: debounce,
            updateButtonActiveState: updateButtonActiveState,
            updateLayerObjectsState: updateLayerObjectsState,
            renderAll: () => fabricCanvas.renderAll()
        }, utilsForPaste);
        
        if (dataManager && typeof dataManager.loadInitialCanvas === 'function') {
            await dataManager.loadInitialCanvas();
        }
    }

    // 마우스 휠 줌 기능
    fabricCanvas.on('mouse:wheel', function(opt) {
        const delta = opt.e.deltaY;
        let zoom = fabricCanvas.getZoom();
        zoom *= 0.999 ** delta;
        if (zoom > MAX_ZOOM) zoom = MAX_ZOOM;
        if (zoom < MIN_ZOOM) zoom = MIN_ZOOM;
        fabricCanvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
        opt.e.preventDefault();
        opt.e.stopPropagation();
        updateViewportInfo();
    });

    // 뷰포트 정보 업데이트 디스플레이 함수
    function updateViewportInfo() {
        const vInfo = document.getElementById('viewport-info');
        if(!vInfo) return;
        const zoomPercent = Math.round(fabricCanvas.getZoom() * 100);
        const vPoint = fabricCanvas.viewportTransform;
        const panX = Math.round(vPoint[4]);
        const panY = Math.round(vPoint[5]);
        vInfo.innerText = `Zoom: ${zoomPercent}% | PanX: ${panX}px, PanY: ${panY}px`;
    }

    // 텍스트 추가 모드 전용 클릭 핸들러
    function addTextToCanvas(opt) {
        if (currentMode !== 'text') return;
        
        const pointer = fabricCanvas.getPointer(opt.e);
        const targetLayer = getTargetLayerForDrawing();

        const text = new fabric.IText('텍스트를 입력하세요', {
            left: pointer.x,
            top: pointer.y,
            fontSize: currentFontSize,
            fill: currentTextColor,
            fontFamily: 'Segoe UI',
            customLayer: targetLayer
        });

        fabricCanvas.add(text);
        fabricCanvas.setActiveObject(text);
        text.enterEditing();
        text.selectAll();

        currentMode = 'select';
        fabricCanvas.isDrawingMode = false;
        fabricCanvas.defaultCursor = 'default';
        updateButtonActiveState();
        updateLayerObjectsState();

        if (dataManager && typeof dataManager.debouncedSaveCanvasState === 'function') {
            dataManager.debouncedSaveCanvasState();
        }
        debouncedRecordState();
    }

    // 툴바 버튼 활성화 클래스 제어 함수
    function updateButtonActiveState() {
        const allButtons = [selectMoveToggleBtn, penModeBtn, eraserModeBtn, textModeBtn];
        allButtons.forEach(btn => btn.classList.remove('active-select', 'active-pen', 'active-eraser', 'active-text'));

        if (currentMode === 'select') {
            selectMoveToggleBtn.classList.add('active-select');
            selectMoveLabel.innerText = '선택';
        } else if (currentMode === 'move') {
            selectMoveToggleBtn.classList.add('active-select');
            selectMoveLabel.innerText = '이동';
        } else if (currentMode === 'pen') {
            penModeBtn.classList.add('active-pen');
        } else if (currentMode === 'eraser') {
            eraserModeBtn.classList.add('active-eraser');
        } else if (currentMode === 'text') {
            textModeBtn.classList.add('active-text');
        }
    }

    // 팝업 레이어 닫기 도우미
    function closeAllTipups() {
        const allTipups = [penTipup, eraserTipup, textTipup, bgColorTipup];
        allTipups.forEach(tu => tu.classList.remove('active'));
    }

    function positionTipup(button, tipup) {
        closeAllTipups();
        tipup.classList.add('active');
    }

    document.addEventListener('click', () => {
        closeAllTipups();
    });

    const tipupsStopProp = [penTipup, eraserTipup, textTipup, bgColorTipup];
    tipupsStopProp.forEach(tu => {
        tu.addEventListener('click', (e) => e.stopPropagation());
    });


    // =================================================================
    // 💡 [수정반영] 마우스 드래그 & 터치 멀티제스처 통합 제어 시스템 (오류 수정)
    // =================================================================

    // 1️⃣ [PC 전용] 스페이스바 단축키 핸들러
    let isSpacePressed = false;

    document.addEventListener('keydown', (e) => {
        const activeElement = document.activeElement;
        if (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA') return;
        if (fabricCanvas.getActiveObject()?.isEditing) return;

        if (e.code === 'Space' && !isSpacePressed) {
            e.preventDefault();
            isSpacePressed = true;
            fabricCanvas.setCursor('grab');
            
            fabricCanvas.selection = false;
            fabricCanvas.forEachObject(obj => {
                obj.selectable = false;
                obj.evented = false;
            });
            fabricCanvas.requestRenderAll();
        }
    });

    document.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            isSpacePressed = false;
            isPanning = false;

            fabricCanvas.selection = true;
            if (typeof updateLayerObjectsState === 'function') updateLayerObjectsState();
            fabricCanvas.requestRenderAll();
        }
    });

    // 2️⃣ 멀티터치 전용 제어 변수 (isPanning, lastPanPoint는 중복 선언 제거함)
    let touchStartDist = 0;
    let touchStartZoom = 1;
    let touchStartCenter = { x: 0, y: 0 };
    let isTwoFingerGesture = false;
    let gestureType = 'none'; 
    const GESTURE_LOCK_THRESHOLD = 15;

    function getTouchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function getTouchCenter(touches) {
        return {
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2
        };
    }

    // 3️⃣ [PC] 마우스 드래그(Pan) 이벤트 핸들러
    fabricCanvas.on('mouse:down', function(opt) {
        const e = opt.e;
        if ((currentMode === 'move' || isSpacePressed) && !e.touches) {
            isPanning = true;
            lastPanPoint = { x: e.clientX, y: e.clientY };
            fabricCanvas.setCursor('grabbing');
        }
    });

    fabricCanvas.on('mouse:move', function(opt) {
        const e = opt.e;
        if (isPanning && (currentMode === 'move' || isSpacePressed) && !e.touches) {
            const deltaX = e.clientX - lastPanPoint.x;
            const deltaY = e.clientY - lastPanPoint.y;
            
            lastPanPoint = { x: e.clientX, y: e.clientY };
            fabricCanvas.relativePan(new fabric.Point(deltaX, deltaY));
            if (typeof updateViewportInfo === 'function') updateViewportInfo();
        }
    });

    fabricCanvas.on('mouse:up', function() {
        if (!isTwoFingerGesture) {
            isPanning = false;
            fabricCanvas.setCursor(isSpacePressed ? 'grab' : (currentMode === 'move' ? 'default' : fabricCanvas.defaultCursor));
            if (dataManager && typeof dataManager.debouncedSaveCanvasState === 'function') {
                dataManager.debouncedSaveCanvasState();
            }
        }
    });

    // 4️⃣ [터치] 멀티터치 팬 & 피칭 줌 (시차 보정형)
    fabricCanvas.on('touch:start', function(opt) {
        const e = opt.e;
        if (!e || !e.touches) return;

        if (e.touches.length === 1) {
            isTwoFingerGesture = false;
            gestureType = 'none';

            if (currentMode === 'move') {
                if (typeof e.preventDefault === 'function') e.preventDefault();
                isPanning = true;
                lastPanPoint = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }
        } 
        else if (e.touches.length === 2) {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            isTwoFingerGesture = true;
            isPanning = false;

            if (fabricCanvas.isDrawingMode) {
                fabricCanvas.isDrawingMode = false;
                fabricCanvas.clearContext(fabricCanvas.contextTop); 
                if (fabricCanvas.freeDrawingBrush && fabricCanvas.freeDrawingBrush._reset) {
                    fabricCanvas.freeDrawingBrush._reset();
                }
            }

            touchStartDist = getTouchDistance(e.touches);
            touchStartZoom = fabricCanvas.getZoom();
            touchStartCenter = getTouchCenter(e.touches);
            lastPanPoint = touchStartCenter;
            gestureType = 'none';
        }
    });

    fabricCanvas.on('touch:move', function(opt) {
        const e = opt.e;
        if (!e || !e.touches) return;

        if (e.touches.length === 1 && isPanning && currentMode === 'move') {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            const touch = e.touches[0];
            const deltaX = touch.clientX - lastPanPoint.x;
            const deltaY = touch.clientY - lastPanPoint.y;
            
            lastPanPoint = { x: touch.clientX, y: touch.clientY };
            fabricCanvas.relativePan(new fabric.Point(deltaX, deltaY));
            if (typeof updateViewportInfo === 'function') updateViewportInfo();
        } 
        else if (e.touches.length === 2 && isTwoFingerGesture) {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            
            const currentCenter = getTouchCenter(e.touches);
            const currentDist = getTouchDistance(e.touches);

            if (gestureType === 'none') {
                const distChange = Math.abs(currentDist - touchStartDist);
                const panChange = Math.sqrt(
                    Math.pow(currentCenter.x - touchStartCenter.x, 2) + 
                    Math.pow(currentCenter.y - touchStartCenter.y, 2)
                );

                if (panChange > GESTURE_LOCK_THRESHOLD || distChange > GESTURE_LOCK_THRESHOLD) {
                    if (panChange > distChange) {
                        gestureType = 'pan';
                    } else {
                        gestureType = 'zoom';
                    }
                }
            }

            if (gestureType === 'pan') {
                const deltaX = currentCenter.x - lastPanPoint.x;
                const deltaY = currentCenter.y - lastPanPoint.y;
                lastPanPoint = currentCenter;
                
                fabricCanvas.relativePan(new fabric.Point(deltaX, deltaY));
                if (typeof updateViewportInfo === 'function') updateViewportInfo();
            } 
            else if (gestureType === 'zoom') {
                let newZoom = touchStartZoom * (currentDist / touchStartDist);
                
                if (newZoom > MAX_ZOOM) newZoom = MAX_ZOOM;
                if (newZoom < MIN_ZOOM) newZoom = MIN_ZOOM;

                const fabricPoint = new fabric.Point(currentCenter.x, currentCenter.y);
                fabricCanvas.zoomToPoint(fabricPoint, newZoom);
                
                const deltaX = currentCenter.x - lastPanPoint.x;
                const deltaY = currentCenter.y - lastPanPoint.y;
                lastPanPoint = currentCenter;
                fabricCanvas.relativePan(new fabric.Point(deltaX, deltaY));

                if (typeof updateViewportInfo === 'function') updateViewportInfo();
            }
        }
    });

    fabricCanvas.on('touch:end', function(opt) {
        isPanning = false;
        const touchesCount = (opt.e && opt.e.touches) ? opt.e.touches.length : 0;

        if (touchesCount === 0) {
            isTwoFingerGesture = false;
            gestureType = 'none';
            
            if (currentMode === 'pen') {
                fabricCanvas.isDrawingMode = true;
            }
        } 
        else if (touchesCount === 1) {
            isTwoFingerGesture = false;
        }

        if (dataManager && typeof dataManager.debouncedSaveCanvasState === 'function') {
            dataManager.debouncedSaveCanvasState();
        }
    });


    // ==========================================
    // 5️⃣ 레이어 객체 제어 상태 관리 로직
    // ==========================================
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
    }
    editLayerCheckbox.addEventListener('change', updateLayerObjectsState);
    scheduleLayerCheckbox.addEventListener('change', updateLayerObjectsState);


    // 배경색 설정 이벤트 바인딩
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

    // 선택/이동 모드 전환 토글 버튼 처리
    selectMoveToggleBtn.addEventListener('click', () => {
        if (currentMode === 'select') {
            currentMode = 'move';
            fabricCanvas.isDrawingMode = false;
            fabricCanvas.defaultCursor = 'grab';
        } else {
            currentMode = 'select';
            fabricCanvas.isDrawingMode = false;
            fabricCanvas.defaultCursor = 'default';
        }
        fabricCanvas.off('mouse:down', addTextToCanvas);
        updateButtonActiveState();
        updateLayerObjectsState();
    });

    // 펜 그리기 모드 이벤트 바인딩
    penModeBtn.addEventListener('click', (e) => {
        if (currentMode === 'pen') {
            currentMode = 'select';
            fabricCanvas.isDrawingMode = false;
            fabricCanvas.defaultCursor = 'default';
            updateLayerObjectsState();
        } else {
            e.stopPropagation();
            currentMode = 'pen';
            fabricCanvas.isDrawingMode = true;
            
            const currentBrush = new fabric.PencilBrush(fabricCanvas);
            currentBrush.color = currentPenColor;
            currentBrush.width = currentPenWidth;
            fabricCanvas.freeDrawingBrush = currentBrush;
            
            positionTipup(penModeBtn, penTipup);
            updateLayerObjectsState();
        }
        fabricCanvas.off('mouse:down', addTextToCanvas);
        updateButtonActiveState();
    });

    penColorOptions.forEach(option => {
        option.addEventListener('click', () => {
            currentPenColor = option.dataset.color;
            if (fabricCanvas.freeDrawingBrush && currentMode === 'pen') {
                fabricCanvas.freeDrawingBrush.color = currentPenColor;
            }
            penColorOptions.forEach(btn => btn.classList.remove('selected'));
            option.classList.add('selected');
        });
    });

    penWidthSlider.addEventListener('input', () => {
        currentPenWidth = parseInt(penWidthSlider.value);
        penWidthVal.innerText = currentPenWidth;
        if (fabricCanvas.freeDrawingBrush && currentMode === 'pen') {
            fabricCanvas.freeDrawingBrush.width = currentPenWidth;
        }
    });

    // 지우개 모드 이벤트 바인딩
    eraserModeBtn.addEventListener('click', (e) => {
        if (currentMode === 'eraser') {
            currentMode = 'select';
            fabricCanvas.isDrawingMode = false;
            fabricCanvas.defaultCursor = 'default';
            updateLayerObjectsState();
        } else {
            e.stopPropagation();
            currentMode = 'eraser';
            fabricCanvas.isDrawingMode = true;

            const eraserBrush = new fabric.EraserBrush(fabricCanvas);
            eraserBrush.width = currentEraserWidth;
            fabricCanvas.freeDrawingBrush = eraserBrush;

            positionTipup(eraserModeBtn, eraserTipup);
            updateLayerObjectsState();
        }
        fabricCanvas.off('mouse:down', addTextToCanvas);
        updateButtonActiveState();
    });

    eraserWidthSlider.addEventListener('input', () => {
        currentEraserWidth = parseInt(eraserWidthSlider.value);
        eraserWidthVal.innerText = currentEraserWidth;
        if (fabricCanvas.freeDrawingBrush && currentMode === 'eraser') {
            fabricCanvas.freeDrawingBrush.width = currentEraserWidth;
        }
    });

    // 텍스트 모드 이벤트 바인딩
    textModeBtn.addEventListener('click', (e) => {
        if (currentMode === 'text') {
            currentMode = 'select';
            fabricCanvas.off('mouse:down', addTextToCanvas);
            fabricCanvas.defaultCursor = 'default';
        } else {
            e.stopPropagation();
            currentMode = 'text';
            fabricCanvas.isDrawingMode = false;
            fabricCanvas.defaultCursor = 'text';
            
            fabricCanvas.off('mouse:down', addTextToCanvas);
            fabricCanvas.on('mouse:down', addTextToCanvas);
            
            positionTipup(textModeBtn, textTipup);
        }
        updateButtonActiveState();
        updateLayerObjectsState();
    });

    textColorOptions.forEach(option => {
        option.addEventListener('click', () => {
            currentTextColor = option.dataset.color;
            textColorOptions.forEach(btn => btn.classList.remove('selected'));
            option.classList.add('selected');
        });
    });

    fontSizeSlider.addEventListener('input', () => {
        currentFontSize = parseInt(fontSizeSlider.value);
        fontSizeVal.innerText = currentFontSize;
    });

    // 드로잉 패스 객체 생성 시 메타데이터 주입
    fabricCanvas.on('path:created', function(opt) {
        const path = opt.path;
        const targetLayer = getTargetLayerForDrawing();
        path.set('customLayer', targetLayer);
        
        if (dataManager && typeof dataManager.debouncedSaveCanvasState === 'function') {
            dataManager.debouncedSaveCanvasState();
        }
        debouncedRecordState();
    });

    fabricCanvas.on('object:modified', function() {
        if (dataManager && typeof dataManager.debouncedSaveCanvasState === 'function') {
            dataManager.debouncedSaveCanvasState();
        }
        debouncedRecordState();
    });

    // 전체 지우기 모달 및 로직 처리
    clearBtn.addEventListener('click', () => {
        clearConfirmModal.style.display = 'block';
    });

    closeClearConfirmModal.addEventListener('click', () => {
        clearConfirmModal.style.display = 'none';
    });

    cancelClearBtn.addEventListener('click', () => {
        clearConfirmModal.style.display = 'none';
    });

    confirmClearBtn.addEventListener('click', () => {
        const editLayerVisible = editLayerCheckbox.checked;
        const scheduleLayerVisible = scheduleLayerCheckbox.checked;

        const objectsToRemove = [];
        fabricCanvas.forEachObject(obj => {
            if ((obj.customLayer === 'editLayer' || !obj.customLayer) && editLayerVisible) {
                objectsToRemove.push(obj);
            } else if (obj.customLayer === 'scheduleLayer' && scheduleLayerVisible) {
                objectsToRemove.push(obj);
            }
        });

        objectsToRemove.forEach(obj => fabricCanvas.remove(obj));
        fabricCanvas.discardActiveObject();
        fabricCanvas.renderAll();

        clearConfirmModal.style.display = 'none';
        
        if (dataManager && typeof dataManager.debouncedSaveCanvasState === 'function') {
            dataManager.debouncedSaveCanvasState();
        }
        debouncedRecordState();
    });

    // 화면 저장 및 수동 모달 연동 로직
    saveScreenBtn.addEventListener('click', () => {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const date = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');

        screenBaseNameInput.value = `${year}${month}${date}_${hours}${minutes}`;
        saveEditLayerCheckbox.checked = editLayerCheckbox.checked;
        saveScheduleLayerCheckbox.checked = scheduleLayerCheckbox.checked;

        saveScreenModal.style.display = 'block';
    });

    closeSaveScreenModalBtn.addEventListener('click', () => {
        saveScreenModal.style.display = 'none';
    });

    saveScreenForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const baseName = screenBaseNameInput.value.trim();
        if (!baseName) return;

        const editSelected = saveEditLayerCheckbox.checked;
        const scheduleSelected = saveScheduleLayerCheckbox.checked;

        if (!editSelected && !scheduleSelected) {
            alert('저장할 레이어를 최소 하나 이상 선택해 주세요.');
            return;
        }

        const now = new Date();
        const timestampString = now.toLocaleString('ko-KR');

        if (dataManager && typeof dataManager.saveNamedScreen === 'function') {
            await dataManager.saveNamedScreen(baseName, timestampString, editSelected, scheduleSelected);
            saveScreenModal.style.display = 'none';
            alert(`"${baseName}" 화면이 성공적으로 수동 저장되었습니다.`);
        }
    });

    // 불러오기 모달 연동 및 화면 목록 렌더링
    loadSavedScreenBtn.addEventListener('click', async () => {
        if (!dataManager || typeof dataManager.getSavedScreensList !== 'function') return;

        const screens = await dataManager.getSavedScreensList();
        savedScreenList.innerHTML = '';

        if (screens.length === 0) {
            noSavedScreens.style.display = 'block';
        } else {
            noSavedScreens.style.display = 'none';
            screens.forEach(screen => {
                const li = document.createElement('li');
                li.className = 'saved-screen-item';
                li.style.display = 'flex';
                li.style.justifyContent = 'space-between';
                li.style.alignItems = 'center';
                li.style.padding = '8px';
                li.style.borderBottom = '1px solid #eee';

                const infoDiv = document.createElement('div');
                infoDiv.innerHTML = `<strong>${screen.displayName}</strong><br><small style="color:#777;">저장일시: ${screen.savedAt}</small>`;
                li.appendChild(infoDiv);

                const actionsDiv = document.createElement('createElement');
                actionsDiv.className = 'saved-screen-actions';
                actionsDiv.style.display = 'flex';
                actionsDiv.style.gap = '6px';

                const loadBtn = document.createElement('button');
                loadBtn.className = 'action-btn';
                loadBtn.innerText = '불러오기';
                loadBtn.addEventListener('click', async () => {
                    if (confirm(`"${screen.displayName}" 상태를 불러오시겠습니까?\n현재 캔버스의 일치하는 레이어 내용이 대체됩니다.`)) {
                        await dataManager.loadNamedScreen(screen.key);
                        loadSavedScreenModal.style.display = 'none';
                    }
                });

                const delBtn = document.createElement('button');
                delBtn.className = 'action-btn';
                delBtn.innerText = '삭제';
                delBtn.style.background = '#ff4444';
                delBtn.style.color = '#fff';
                delBtn.addEventListener('click', async () => {
                    if (confirm(`"${screen.displayName}" 저장본을 영구 삭제하시겠습니까?`)) {
                        await dataManager.deleteNamedScreen(screen.key);
                        li.remove();
                        const currentScreens = await dataManager.getSavedScreensList();
                        if (currentScreens.length === 0) noSavedScreens.style.display = 'block';
                    }
                });

                actionsDiv.appendChild(loadBtn);
                actionsDiv.appendChild(delBtn);
                li.appendChild(actionsDiv);
                savedScreenList.appendChild(li);
            });
        }
        loadSavedScreenModal.style.display = 'block';
    });

    closeLoadSavedScreenModalBtn.addEventListener('click', () => {
        loadSavedScreenModal.style.display = 'none';
    });

    // 스케줄 생성 버튼 클릭 리스너 정의
    addScheduleBtn.addEventListener('click', () => {
        const schedulePanel = document.getElementById('schedulePanel');
        if (schedulePanel) {
            schedulePanel.style.display = (schedulePanel.style.display === 'none' || schedulePanel.style.display === '') ? 'block' : 'none';
        }
    });

    // Delete 키 오브젝트 삭제 핸들러
    document.addEventListener('keydown', (event) => {
        const activeElement = document.activeElement;
        if (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA') return;
        if (fabricCanvas.getActiveObject()?.isEditing) return;

        if (event.key === 'Delete' || event.code === 'Delete' || event.keyCode === 46) {
            event.preventDefault();

            const activeObjects = fabricCanvas.getActiveObjects();
            if (activeObjects.length > 0) {
                activeObjects.forEach(obj => { 
                    fabricCanvas.remove(obj);
                });
                fabricCanvas.discardActiveObject();
                fabricCanvas.renderAll();
                
                if (dataManager && typeof dataManager.debouncedSaveCanvasState === 'function') {
                    dataManager.debouncedSaveCanvasState();
                }
                debouncedRecordState();
            }
        }
    });

    updateButtonActiveState();
    updateLayerObjectsState();

    /* === 툴바 자동 스케일 === */
    const BASE_WIDTH = 1500;

    function applyToolbarScale(){
        const scale = Math.min(window.innerWidth / BASE_WIDTH, 1);
        const wrap = document.getElementById('toolbarScaleWrap');
        if(wrap) {
            wrap.style.transform = `scale(${scale})`;
        }
    }

    window.addEventListener('resize', applyToolbarScale);
    applyToolbarScale();
});