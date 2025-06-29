// --- IndexedDB 설정 ---
const DATA_DB_NAME = 'WhiteboardAppDB';
const DATA_DB_VERSION = 3; // 데이터 구조 변경으로 버전업 (savedScreens 키 방식 변경 등)
const CANVAS_STATE_STORE_NAME = 'canvasState'; // 자동 저장용
const CANVAS_STATE_KEY = 'latestCanvas'; // 자동 저장용 키
const SAVED_SCREENS_STORE_NAME = 'savedScreens'; // 수동 저장 화면용
const SCHEDULE_STORE_NAME = 'schedules'; // 스케줄용
let dataDb; // IndexedDB 인스턴스

// --- IndexedDB 열기 및 업그레이드 ---
function openDataDB() {
    return new Promise((resolve, reject) => {
        if (dataDb) {
            resolve(dataDb);
            return;
        }

        const request = indexedDB.open(DATA_DB_NAME, DATA_DB_VERSION);

        request.onerror = (event) => {
            console.error('Data.js IndexedDB 오류:', event.target.errorCode);
            reject('Data.js IndexedDB 오류: ' + event.target.errorCode);
        };

        request.onsuccess = (event) => {
            dataDb = event.target.result;
            console.log('Data.js에서 IndexedDB가 성공적으로 열렸습니다.');
            resolve(dataDb);
        };

        request.onupgradeneeded = (event) => {
            const tempDb = event.target.result;
            console.log('Data.js: onupgradeneeded 이벤트 발생 (DB 버전: ' + tempDb.version + ')');

            if (!tempDb.objectStoreNames.contains(CANVAS_STATE_STORE_NAME)) {
                tempDb.createObjectStore(CANVAS_STATE_STORE_NAME);
                console.log(`객체 저장소 '${CANVAS_STATE_STORE_NAME}' 생성 (data.js)`);
            }

            // savedScreens 저장소는 키 경로 없이 생성 (외부에서 키 제공)
            if (tempDb.objectStoreNames.contains(SAVED_SCREENS_STORE_NAME) && event.oldVersion < 3) {
                // 버전 3 이전이면 기존 저장소 삭제 후 재생성 (키 구조 변경 대응)
                tempDb.deleteObjectStore(SAVED_SCREENS_STORE_NAME);
                console.log(`기존 객체 저장소 '${SAVED_SCREENS_STORE_NAME}' 삭제 (data.js)`);
            }
            if (!tempDb.objectStoreNames.contains(SAVED_SCREENS_STORE_NAME)) {
                tempDb.createObjectStore(SAVED_SCREENS_STORE_NAME);
                console.log(`객체 저장소 '${SAVED_SCREENS_STORE_NAME}' 생성 (data.js)`);
            }

            if (!tempDb.objectStoreNames.contains(SCHEDULE_STORE_NAME)) {
                const scheduleStore = tempDb.createObjectStore(SCHEDULE_STORE_NAME, { keyPath: 'id', autoIncrement: true });
                console.log(`객체 저장소 '${SCHEDULE_STORE_NAME}' 생성 (data.js)`);
                if (!scheduleStore.indexNames.contains('screenName')) {
                    scheduleStore.createIndex('screenName', 'screenName', { unique: false });
                    console.log(`'${SCHEDULE_STORE_NAME}' 저장소에 'screenName' 인덱스 생성 (data.js)`);
                }
            } else { // 스케줄 저장소가 이미 존재하면 인덱스 확인/추가
                const transaction = event.target.transaction;
                const scheduleStore = transaction.objectStore(SCHEDULE_STORE_NAME);
                if (!scheduleStore.indexNames.contains('screenName')) {
                    scheduleStore.createIndex('screenName', 'screenName', { unique: false });
                    console.log(`기존 '${SCHEDULE_STORE_NAME}' 저장소에 'screenName' 인덱스 생성 (data.js)`);
                }
            }
        };
    });
}

// --- 캔버스 자동 저장 ---
async function saveCanvasStateToDB(fabricInstance) {
    if (!fabricInstance) {
        console.warn("Data.js: 자동 저장을 위한 fabricInstance가 없습니다.");
        return Promise.reject("fabricInstance 없음");
    }
    try {
        const currentDb = await openDataDB();
        const canvasJson = fabricInstance.toJSON(['customLayer', 'id']); // 레이어 정보 포함 저장
        const transaction = currentDb.transaction([CANVAS_STATE_STORE_NAME], 'readwrite');
        const objectStore = transaction.objectStore(CANVAS_STATE_STORE_NAME);
        const request = objectStore.put(canvasJson, CANVAS_STATE_KEY);

        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event.target.error);
        });
    } catch (error) {
        console.error('Data.js: 캔버스 상태 자동 저장 중 예외:', error);
        return Promise.reject(error);
    }
}

// --- 캔버스 자동 복원 ---
async function loadCanvasStateFromDB(fabricInstance, callbacks) {
    if (!fabricInstance) return Promise.reject("fabricInstance 없음");
    try {
        const currentDb = await openDataDB();
        const transaction = currentDb.transaction([CANVAS_STATE_STORE_NAME], 'readonly');
        const objectStore = transaction.objectStore(CANVAS_STATE_STORE_NAME);
        const request = objectStore.get(CANVAS_STATE_KEY);

        return new Promise((resolve, reject) => {
            request.onsuccess = (event) => {
                const savedCanvasJson = event.target.result;
                if (savedCanvasJson) {
                    fabricInstance.loadFromJSON(savedCanvasJson, () => {
                        // 자동 복원 시에는 객체들의 customLayer 속성을 그대로 유지
                        if (callbacks && typeof callbacks.onLoadSuccess === 'function') {
                            callbacks.onLoadSuccess(fabricInstance, null); // loadedToLayer는 null (강제 지정 안함)
                        }
                        resolve(true);
                    });
                } else {
                    if (callbacks && typeof callbacks.onNoData === 'function') callbacks.onNoData();
                    resolve(false); // 저장된 데이터 없음
                }
            };
            request.onerror = (event) => {
                if (callbacks && typeof callbacks.onLoadError === 'function') callbacks.onLoadError(event.target.error);
                reject(event.target.error);
            };
        });
    } catch (error) {
        if (callbacks && typeof callbacks.onLoadError === 'function') callbacks.onLoadError(error);
        return Promise.reject(error);
    }
}

// --- 화면 수동 저장 ---
// baseName: 사용자가 입력한 순수 제목
// timestampString: "yyyy년 mm월 dd일 hh:mm:ss" 형식의 문자열
async function saveCurrentScreen(fabricInstance, baseName, timestampString, editLayerSelected, scheduleLayerSelected) {
    if (!fabricInstance || !baseName || baseName.trim() === "" || !timestampString) {
        return Promise.reject("유효하지 않은 화면 이름 또는 타임스탬프");
    }
    if (!editLayerSelected && !scheduleLayerSelected) {
        return Promise.reject("저장할 레이어가 선택되지 않았습니다.");
    }

    const canvasJson = fabricInstance.toJSON(['customLayer', 'id']);
    let objectsForSaving = [];

    if (editLayerSelected && scheduleLayerSelected) {
        // 두 레이어 모두 선택 시: customLayer 속성 제거 (하나의 레이어로 통합된 것처럼)
        objectsForSaving = canvasJson.objects.map(obj => {
            const newObj = { ...obj };
            delete newObj.customLayer; // 불러올 때 어차피 targetLayer로 지정됨
            return newObj;
        });
    } else if (editLayerSelected) {
        objectsForSaving = canvasJson.objects.filter(obj => obj.customLayer === 'editLayer' || !obj.customLayer); // 기존 호환성을 위해 !obj.customLayer도 포함
    } else if (scheduleLayerSelected) {
        objectsForSaving = canvasJson.objects.filter(obj => obj.customLayer === 'scheduleLayer');
    }

    // 저장될 데이터 구조
    const dataToSave = {
        displayName: baseName.trim(), // 사용자가 입력한 순수 제목
        savedAt: timestampString, // "yyyy년 mm월 dd일 hh:mm:ss" 형식의 문자열
        canvasData: { ...canvasJson, objects: objectsForSaving } // 실제 캔버스 객체 데이터 (배경색 등 포함)
    };

    // IndexedDB에 저장될 키는 "제목||타임스탬프" 형식으로 조합
    const screenKey = `${baseName.trim()}||${timestampString}`;

    try {
        const currentDb = await openDataDB();
        const transaction = currentDb.transaction([SAVED_SCREENS_STORE_NAME], 'readwrite');
        const objectStore = transaction.objectStore(SAVED_SCREENS_STORE_NAME);
        const request = objectStore.put(dataToSave, screenKey); // dataToSave 객체를 screenKey로 저장

        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                console.log(`Data.js: 화면 '${screenKey}' 저장 완료.`);
                resolve(screenKey); // 저장된 실제 키 (제목||타임스탬프) 반환
            };
            request.onerror = (event) => {
                console.error(`Data.js: '${screenKey}' 화면 저장 오류:`, event.target.error);
                reject(event.target.error);
            };
        });
    } catch (error) {
        console.error(`Data.js: '${screenKey}' 화면 저장 중 예외:`, error);
        return Promise.reject(error);
    }
}

// --- 저장된 화면 목록 가져오기 ---
// 반환값: { key: "제목||타임스탬프", displayName: "제목", savedAt: "타임스탬프" } 객체의 배열
async function getSavedScreens() {
    try {
        const currentDb = await openDataDB();
        const transaction = currentDb.transaction([SAVED_SCREENS_STORE_NAME], 'readonly');
        const objectStore = transaction.objectStore(SAVED_SCREENS_STORE_NAME);
        const request = objectStore.getAllKeys(); // 모든 키("제목||타임스탬프")를 가져옴

        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                const screenKeys = request.result;
                const formattedScreens = screenKeys.map(key => {
                    const parts = key.split('||');
                    return {
                        key: key, // 전체 키 (삭제 및 로드 시 사용)
                        displayName: parts[0], // 사용자에게 보여줄 제목
                        savedAt: parts[1] || '' // 저장 시각 (이전 버전 호환)
                    };
                }).sort((a, b) => { // 저장 시간 최신순 정렬 (savedAt 문자열 비교, 내림차순)
                    return (b.savedAt || '').localeCompare(a.savedAt || '');
                });
                resolve(formattedScreens);
            };
            request.onerror = (event) => {
                console.error("Data.js: 저장된 화면 목록 불러오기 오류:", event.target.error);
                reject(event.target.error);
            };
        });
    } catch (error) {
        console.error("Data.js: 저장된 화면 목록 가져오기 중 예외:", error);
        return Promise.reject(error);
    }
}

// --- 특정 저장 화면 불러오기 (수정된 함수) ---
// screenKey: "제목||타임스탬프" 형식의 키
async function loadSavedScreenByName(fabricInstance, screenKey, callbacks, targetLayerOverride = null) {
    if (!fabricInstance || !screenKey) return Promise.reject("잘못된 인자 (fabricInstance 또는 screenKey 없음)");

    try {
        const currentDb = await openDataDB();
        const transaction = currentDb.transaction([SAVED_SCREENS_STORE_NAME], 'readonly');
        const objectStore = transaction.objectStore(SAVED_SCREENS_STORE_NAME);
        const request = objectStore.get(screenKey);

        return new Promise((resolve, reject) => {
            request.onsuccess = (event) => {
                const savedData = event.target.result; // {displayName, savedAt, canvasData} 형태

                if (savedData && savedData.canvasData && Array.isArray(savedData.canvasData.objects)) {
                    const finalTargetLayer = targetLayerOverride || 'editLayer'; // 기본은 'editLayer'

                    // 1. 대상 레이어의 기존 객체들 삭제
                    const objectsToRemove = fabricInstance.getObjects().filter(obj => obj.customLayer === finalTargetLayer);
                    objectsToRemove.forEach(obj => fabricInstance.remove(obj));

                    // 2. 배경색 설정 (저장된 화면의 배경색으로)
                    // fabric.js toJSON()은 background 또는 backgroundColor로 저장할 수 있음.
                    // 현재 캔버스의 기본 배경색 또는 저장된 배경색 사용
                    const newBackgroundColor = savedData.canvasData.background || savedData.canvasData.backgroundColor || fabricInstance.backgroundColor;
                    
                    fabricInstance.setBackgroundColor(newBackgroundColor, () => {
                        // 배경색 설정 콜백에서 객체 로드 및 렌더링 진행

                        // 3. 새로운 객체들을 enlivenObjects로 되살리고, customLayer 설정 후 캔버스에 추가
                        fabric.util.enlivenObjects(savedData.canvasData.objects, function(enlivenedObjects) {
                            enlivenedObjects.forEach(obj => {
                                obj.set('customLayer', finalTargetLayer);
                                // 저장 시 ID가 포함되어 있으므로, 별도 ID 할당은 일반적으로 불필요.
                                // 만약 ID가 없다면: if (!obj.id) obj.id = fabric.util.createClass(fabric.Object).prototype.type + '_' + Date.now() + Math.random().toString(36).substr(2, 9);
                                fabricInstance.add(obj);
                            });

                            // 4. 레이어 순서 재정렬 (script.js의 로직과 유사하게)
                            // 편집용 레이어 객체들이 스케줄 레이어 객체들보다 위에 오도록 함.
                            const allObjects = fabricInstance.getObjects();
                            allObjects.sort((a, b) => {
                                const layerPriority = { 'editLayer': 1, 'scheduleLayer': 0 }; // editLayer가 높은 우선순위
                                const priorityA = layerPriority[a.customLayer] !== undefined ? layerPriority[a.customLayer] : -1;
                                const priorityB = layerPriority[b.customLayer] !== undefined ? layerPriority[b.customLayer] : -1;
                                if (priorityA > priorityB) return 1; // a가 b보다 위로
                                if (priorityA < priorityB) return -1; // a가 b보다 아래로
                                return 0;
                            });
                            allObjects.forEach((obj, index) => fabricInstance.moveTo(obj, index));
                            
                            // 5. 캔버스 렌더링
                            fabricInstance.requestRenderAll();

                            console.log(`Data.js: '${screenKey}' 화면 불러오기 완료. '${finalTargetLayer}' 레이어 정리 후 객체 추가됨. 배경색 적용.`);
                            if (callbacks && typeof callbacks.onLoadSuccess === 'function') {
                                callbacks.onLoadSuccess(fabricInstance, finalTargetLayer);
                            }
                            resolve(true); // 성공적으로 로드됨
                        }, ''); // 네임스페이스 인자는 비워둠
                    }); // setBackgroundColor 콜백 끝
                } else {
                    console.log(`Data.js: '${screenKey}' 화면 없음 또는 canvasData.objects가 배열이 아님.`);
                    if (callbacks && typeof callbacks.onLoadError === 'function') {
                        callbacks.onLoadError(`'${screenKey}' 화면을 찾을 수 없거나 데이터 형식이 잘못되었습니다.`);
                    }
                    reject(`'${screenKey}' 화면을 찾을 수 없거나 데이터 형식이 잘못되었습니다.`);
                }
            }; // request.onsuccess 끝

            request.onerror = (event) => {
                console.error(`Data.js: '${screenKey}' 화면 불러오기 오류:`, event.target.error);
                if (callbacks && typeof callbacks.onLoadError === 'function') {
                    callbacks.onLoadError(event.target.error);
                }
                reject(event.target.error);
            };
        }); // Promise 끝
    } catch (error) {
        console.error(`Data.js: '${screenKey}' 화면 로드 중 예외:`, error);
        if (callbacks && typeof callbacks.onLoadError === 'function') {
            callbacks.onLoadError(error);
        }
        return Promise.reject(error);
    }
}


// --- 저장된 화면 삭제 ---
// screenKey: "제목||타임스탬프" 형식의 키
async function deleteSavedScreen(screenKey) {
    if (!screenKey) return Promise.reject("삭제할 화면 키가 없습니다.");

    try {
        const currentDb = await openDataDB();
        const transaction = currentDb.transaction([SAVED_SCREENS_STORE_NAME], 'readwrite');
        const objectStore = transaction.objectStore(SAVED_SCREENS_STORE_NAME);
        const request = objectStore.delete(screenKey);

        return new Promise((resolve, reject) => {
            request.onsuccess = async () => {
                console.log(`Data.js: '${screenKey}' 화면 삭제 완료.`);
                await deleteSchedulesByScreenName(screenKey); // 관련된 스케줄도 삭제
                resolve(true);
            };
            request.onerror = (event) => {
                console.error(`Data.js: '${screenKey}' 화면 삭제 오류:`, event.target.error);
                reject(event.target.error);
            };
        });
    } catch (error) {
        console.error(`Data.js: '${screenKey}' 화면 삭제 중 예외:`, error);
        return Promise.reject(error);
    }
}

// --- 스케줄 추가/수정 ---
// scheduleEntry.screenName은 이제 "제목||타임스탬프" 형식의 screenKey가 됨
async function addOrUpdateSchedule(scheduleEntry) {
    if (!scheduleEntry || !scheduleEntry.days || scheduleEntry.days.length === 0 || !scheduleEntry.time || !scheduleEntry.screenName) {
        return Promise.reject("잘못된 스케줄 정보");
    }

    try {
        const currentDb = await openDataDB();
        const transaction = currentDb.transaction([SCHEDULE_STORE_NAME], 'readwrite');
        const objectStore = transaction.objectStore(SCHEDULE_STORE_NAME);
        const request = objectStore.put(scheduleEntry); // id가 있으면 업데이트, 없으면 추가

        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result); // 성공 시 자동 생성/업데이트된 id 반환
            request.onerror = (event) => reject(event.target.error);
        });
    } catch (error) {
        console.error("Data.js: 스케줄 저장/수정 중 예외:", error);
        return Promise.reject(error);
    }
}

// --- 모든 스케줄 불러오기 ---
async function getAllSchedules() {
    try {
        const currentDb = await openDataDB();
        const transaction = currentDb.transaction([SCHEDULE_STORE_NAME], 'readonly');
        const objectStore = transaction.objectStore(SCHEDULE_STORE_NAME);
        const request = objectStore.getAll();

        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                resolve(request.result.sort((a, b) => a.time.localeCompare(b.time))); // 시간순 정렬
            };
            request.onerror = (event) => reject(event.target.error);
        });
    } catch (error) {
        console.error("Data.js: 모든 스케줄 가져오기 중 예외:", error);
        return Promise.reject(error);
    }
}

// --- 특정 스케줄 삭제 ---
async function deleteScheduleById(scheduleId) {
    if (typeof scheduleId !== 'number') return Promise.reject("유효하지 않은 스케줄 ID");
    try {
        const currentDb = await openDataDB();
        const transaction = currentDb.transaction([SCHEDULE_STORE_NAME], 'readwrite');
        const objectStore = transaction.objectStore(SCHEDULE_STORE_NAME);
        const request = objectStore.delete(scheduleId);

        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(true);
            request.onerror = (event) => reject(event.target.error);
        });
    } catch (error) {
        console.error(`Data.js: 스케줄 ID ${scheduleId} 삭제 중 예외:`, error);
        return Promise.reject(error);
    }
}

// --- 특정 화면(screenKey)을 사용하는 스케줄 삭제 ---
async function deleteSchedulesByScreenName(screenKeyToDelete) {
    try {
        const currentDb = await openDataDB();
        const allSchedules = await getAllSchedules(); // 모든 스케줄 가져오기
        const schedulesToDelete = allSchedules.filter(s => s.screenName === screenKeyToDelete);

        if (schedulesToDelete.length > 0) {
            const deleteTransaction = currentDb.transaction([SCHEDULE_STORE_NAME], 'readwrite');
            const deleteObjectStore = deleteTransaction.objectStore(SCHEDULE_STORE_NAME);
            for (const schedule of schedulesToDelete) {
                deleteObjectStore.delete(schedule.id);
            }
            await new Promise((resolve, reject) => { // 트랜잭션 완료 기다리기
                deleteTransaction.oncomplete = resolve;
                deleteTransaction.onerror = reject;
            });
            console.log(`Data.js: '${screenKeyToDelete}' 화면 사용 스케줄 ${schedulesToDelete.length}개 삭제 완료.`);
        }
    } catch (error) {
        console.error(`Data.js: '${screenKeyToDelete}' 화면 관련 스케줄 삭제 중 예외:`, error);
        // 이 함수는 백그라운드 작업이므로 여기서 에러를 던지지 않을 수 있음
    }
}

// ========================================================
// ▼▼▼ 앱 시작 시 가장 마지막 스케줄을 찾아 실행하는 새 로직 ▼▼▼
// ========================================================

/**
 * 앱이 시작될 때, 등록된 모든 스케줄 중 "최근 1시간 이내에" 실행되었어야 할
 * 가장 마지막 스케줄을 찾아 화면에 적용합니다.
 * @param {object} fabricInstance - fabric.js 캔버스 인스턴스
 * @param {object} callbacks - script.js의 콜백 함수들
 */
async function runMostRecentPastSchedule(fabricInstance, callbacks) {
    try {
        const schedules = await getAllSchedules();
        // 스케줄이 없으면 오류 없이 바로 종료
        if (schedules.length === 0) {
            console.log("Data.js: 실행할 스케줄이 없습니다.");
            return;
        }

        // 1. 기준 시간 설정: 현재와 1시간 전
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000); // 1시간(3600초 * 1000ms) 전

        let latestScheduleToRun = null;
        let latestScheduleTime = null;

        console.log(`Data.js: 최근 1시간(${oneHourAgo.toLocaleTimeString()} ~ ${now.toLocaleTimeString()}) 내의 스케줄을 확인합니다.`);

        schedules.forEach(schedule => {
            const [hour, minute] = schedule.time.split(':').map(Number);

            // 오늘과 어제만 확인해도 1시간 범위를 충분히 커버 가능
            for (let i = 0; i < 2; i++) {
                const checkDate = new Date(now);
                checkDate.setDate(now.getDate() - i);

                if (schedule.days.includes(checkDate.getDay())) {
                    const scheduleDateTime = new Date(checkDate);
                    scheduleDateTime.setHours(hour, minute, 0, 0);

                    // 2. 이 실행 시점이 지난 1시간 내에 있는지 확인하는 핵심 조건
                    if (scheduleDateTime >= oneHourAgo && scheduleDateTime <= now) {
                        
                        // 3. 1시간 내의 스케줄 중 가장 최신 것인지 확인
                        if (!latestScheduleTime || scheduleDateTime > latestScheduleTime) {
                            latestScheduleTime = scheduleDateTime;
                            latestScheduleToRun = schedule;
                        }
                    }
                    // 해당 스케줄에 대한 가장 가까운 과거 실행일을 찾았으므로 더 과거로 갈 필요 없음
                    break; 
                }
            }
        });

        if (latestScheduleToRun) {
            console.log(`Data.js: 최근 1시간 내 가장 마지막 스케줄 [${latestScheduleToRun.screenName}]을 실행합니다.`);
            // schedule.screenName은 "제목||타임스탬프" 형식의 키입니다.
            // 스케줄로 로드할 때는 'scheduleLayer'에 적용합니다.
            loadSavedScreenByName(fabricInstance, latestScheduleToRun.screenName, callbacks, 'scheduleLayer');
        } else {
            console.log("Data.js: 최근 1시간 내에 실행될 스케줄이 없습니다.");
        }
    } catch (error) {
        console.error("Data.js: 마지막 스케줄 실행 중 오류 발생:", error);
    }
}


// --- 붙여넣기 핸들러 ---
function initializeGlobalPasteHandler(fabricInstance, utils) {
    if (!fabricInstance) {
        console.error("Paste Handler: fabricInstance가 초기화를 위해 제공되지 않았습니다.");
        return;
    }
    if (!utils ||
        typeof utils.getTargetLayerForDrawing !== 'function' ||
        typeof utils.getCurrentTextSize !== 'function' ||
        typeof utils.getCurrentTextColor !== 'function' ||
        typeof utils.debouncedSaveCanvasStateForPaste !== 'function') {
        console.error("Paste Handler: 필수 유틸리티(getTargetLayerForDrawing, getCurrentTextSize, getCurrentTextColor, debouncedSaveCanvasStateForPaste)가 초기화를 위해 제공되지 않았습니다.");
        return;
    }

    document.addEventListener('paste', async (event) => {
        const activeElement = document.activeElement;
        let skipCanvasPaste = false;

        if (activeElement) {
            const tagName = activeElement.tagName.toLowerCase();
            const elementId = activeElement.id;

            if ((tagName === 'input' || tagName === 'textarea') &&
                (elementId === 'saveScreenNameInput' || elementId === 'scheduleTimeInput')) {
                skipCanvasPaste = true;
            } else if (fabricInstance && fabricInstance.getActiveObject() &&
                       fabricInstance.getActiveObject().isEditing &&
                       (fabricInstance.getActiveObject().type === 'i-text' || fabricInstance.getActiveObject().type === 'textbox')) {
                skipCanvasPaste = true;
            }
        }

        if (skipCanvasPaste) {
            return; // 캔버스 붙여넣기 건너뛰고 기본 브라우저 동작 허용
        }

        const items = (event.clipboardData || window.clipboardData).items;
        let foundItemToPaste = false;

        // 공통 위치 계산 (뷰포트 좌상단 기준 약간 안쪽)
        const offsetX = 20;
        const offsetY = 20;
        const screenTopLeftPoint = { x: 0, y: 0 }; // 뷰포트의 좌상단 픽셀 좌표
        const invertedVptMatrix = fabric.util.invertTransform(fabricInstance.viewportTransform);
        const canvasCoordOfViewportTopLeft = fabric.util.transformPoint(screenTopLeftPoint, invertedVptMatrix);
        const pasteX = canvasCoordOfViewportTopLeft.x + offsetX / fabricInstance.getZoom(); // 줌 레벨 고려
        const pasteY = canvasCoordOfViewportTopLeft.y + offsetY / fabricInstance.getZoom(); // 줌 레벨 고려


        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const targetLayer = utils.getTargetLayerForDrawing() || 'editLayer'; // 기본값 editLayer

            // 텍스트 붙여넣기
            if (item.type.indexOf('text/plain') !== -1) {
                item.getAsString((text) => {
                    if (text.trim() === '') return;
                    
                    const fabricText = new fabric.IText(text, {
                        left: pasteX,
                        top: pasteY,
                        originX: 'left',
                        originY: 'top',
                        fontSize: utils.getCurrentTextSize() || 24,
                        fill: utils.getCurrentTextColor() || '#000000',
                        customLayer: targetLayer,
                        padding: 5,
                        id: 'pastedText_' + Date.now() // 고유 ID 추가
                    });
                    fabricInstance.add(fabricText);
                    
                    // 레이어 순서 정렬
                    const objects = fabricInstance.getObjects();
                    objects.sort((a, b) => {
                        const layerPriority = { 'editLayer': 1, 'scheduleLayer': 0 };
                        const priorityA = layerPriority[a.customLayer] !== undefined ? layerPriority[a.customLayer] : -1;
                        const priorityB = layerPriority[b.customLayer] !== undefined ? layerPriority[b.customLayer] : -1;
                        if (priorityA > priorityB) return 1;
                        if (priorityA < priorityB) return -1;
                        return 0;
                    });
                    objects.forEach((obj, index) => fabricInstance.moveTo(obj, index));

                    fabricInstance.setActiveObject(fabricText);
                    fabricText.enterEditing();
                    fabricText.selectAll();
                    fabricInstance.requestRenderAll();
                    utils.debouncedSaveCanvasStateForPaste();
                });
                foundItemToPaste = true;
                break; 
            }
            // 이미지 붙여넣기
            else if (item.type.indexOf('image') !== -1) {
                const blob = item.getAsFile();
                if (!blob) continue;

                const reader = new FileReader();
                reader.onload = (f) => {
                    fabric.Image.fromURL(f.target.result, (img) => {
                        img.set({
                            left: pasteX,
                            top: pasteY,
                            originX: 'left',
                            originY: 'top',
                            customLayer: targetLayer,
                            id: 'pastedImage_' + Date.now() // 고유 ID 추가
                        });
                        // (선택적) 이미지 크기 자동 조절 로직 (원본 크기로 붙이려면 주석 처리)
                        // const maxDim = Math.min(fabricInstance.width, fabricInstance.height) * 0.3 / fabricInstance.getZoom();
                        // if (img.width > maxDim || img.height > maxDim) {
                        //     img.scaleToWidth(maxDim); // 또는 scaleToHeight
                        // }
                        fabricInstance.add(img);

                        // 레이어 순서 정렬
                        const objects = fabricInstance.getObjects();
                        objects.sort((a, b) => {
                            const layerPriority = { 'editLayer': 1, 'scheduleLayer': 0 };
                            const priorityA = layerPriority[a.customLayer] !== undefined ? layerPriority[a.customLayer] : -1;
                            const priorityB = layerPriority[b.customLayer] !== undefined ? layerPriority[b.customLayer] : -1;
                            if (priorityA > priorityB) return 1;
                            if (priorityA < priorityB) return -1;
                            return 0;
                        });
                        objects.forEach((obj, index) => fabricInstance.moveTo(obj, index));
                        
                        fabricInstance.setActiveObject(img);
                        fabricInstance.requestRenderAll();
                        utils.debouncedSaveCanvasStateForPaste();
                    });
                };
                reader.readAsDataURL(blob);
                foundItemToPaste = true;
                break; 
            }
        }

        if (foundItemToPaste) {
            event.preventDefault();
            event.stopPropagation();
        }
    });
    console.log("붙여넣기 핸들러가 (입력 필드 예외 처리 포함) 초기화되었습니다.");
}


// --- 초기화 함수 (script.js에서 호출) ---
function initializeDataAndScheduleFunctions(fabricInstance, callbacks, utilsForPaste) {
    const debouncedAutoSave = callbacks.debounce(() => saveCanvasStateToDB(fabricInstance), 1000);
    
    initializeGlobalPasteHandler(fabricInstance, utilsForPaste);

    // ▼▼▼ 앱 시작 시 새로운 스케줄 로직을 단 한 번만 호출하도록 변경 ▼▼▼
    runMostRecentPastSchedule(fabricInstance, callbacks);

    return {
        loadInitialCanvas: () => loadCanvasStateFromDB(fabricInstance, callbacks),
        debouncedSaveCanvasState: debouncedAutoSave,
        // saveNamedScreen은 이제 baseName, timestampString, 레이어 선택 여부를 받음
        saveNamedScreen: (baseName, timestampString, editLayerSelected, scheduleLayerSelected) => 
            saveCurrentScreen(fabricInstance, baseName, timestampString, editLayerSelected, scheduleLayerSelected),
        getSavedScreensList: getSavedScreens, // {key, displayName, savedAt} 객체 배열 반환
        // loadNamedScreen은 이제 screenKey("제목||타임스탬프")를 받음, targetLayer는 'editLayer'가 기본
        loadNamedScreen: (screenKey) => loadSavedScreenByName(fabricInstance, screenKey, callbacks, 'editLayer'),
        // deleteNamedScreen은 이제 screenKey("제목||타임스탬프")를 받음
        deleteNamedScreen: deleteSavedScreen,
        addOrUpdateScheduleEntry: addOrUpdateSchedule, // scheduleEntry.screenName은 screenKey
        getAllScheduleEntries: getAllSchedules,
        deleteScheduleEntryById: deleteScheduleById,
    };
}
