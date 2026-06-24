// history.js

let history = []; // 캔버스 상태(JSON)를 저장할 배열
let currentStateIndex = -1; // 현재 상태를 가리키는 인덱스
let isReverting = false; // Undo/Redo 실행 중에 새로운 히스토리가 기록되는 것을 방지하는 플래그
const MAX_HISTORY = 50; // 메모리 관리를 위해 최대 50개까지만 상태를 저장합니다.

/**
 * 실행 취소/다시 실행 기능을 초기화하는 메인 함수
 * @param {fabric.Canvas} fabricCanvas - 메인 캔버스 인스턴스
 */
export function initializeHistory(fabricCanvas) {
    // 앱이 시작될 때 초기 상태를 한 번 기록합니다.
    recordState(fabricCanvas);

    // 키보드 이벤트 리스너 설정
    document.addEventListener('keydown', (e) => {
        // 입력창에 포커스가 있을 때는 단축키를 무시합니다.
        const activeElement = document.activeElement;
        if (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA') return;
        if (fabricCanvas.getActiveObject()?.isEditing) return;

        // Ctrl 또는 Command 키가 눌렸을 때만 작동
        if (e.ctrlKey || e.metaKey) {
            if (e.key.toLowerCase() === 'z') {
                e.preventDefault();
                undo(fabricCanvas);
            } else if (e.key.toLowerCase() === 'y') {
                e.preventDefault();
                redo(fabricCanvas);
            }
        }
    });

    console.log("Undo/Redo 히스토리 기능이 초기화되었습니다.");
}

/**
 * 현재 캔버스 상태를 히스토리 배열에 기록하는 핵심 함수
 * @param {fabric.Canvas} canvas
 */
export function recordState(canvas) {
    if (isReverting) return; // Undo/Redo 중에는 이 함수가 실행되지 않도록 방지합니다.

    // 현재 상태 이후의 히스토리(Redo 스택)를 모두 제거합니다.
    // 사용자가 새로운 작업을 시작하면, '다시 실행'할 미래는 없어지기 때문입니다.
    if (currentStateIndex < history.length - 1) {
        history = history.slice(0, currentStateIndex + 1);
    }

    // 캔버스 상태를 JSON으로 변환하여 저장합니다.
    const state = canvas.toJSON(['customLayer', 'id']);
    history.push(state);
    currentStateIndex++;

    // 최대 히스토리 개수를 초과하면 가장 오래된 것부터 제거합니다.
    if (history.length > MAX_HISTORY) {
        history.shift();
        currentStateIndex--;
    }
}

/**
 * 실행 취소 (Undo)
 * @param {fabric.Canvas} canvas
 */
function undo(canvas) {
    if (currentStateIndex > 0) {
        isReverting = true; // 되돌리는 중임을 표시
        currentStateIndex--;
        const prevState = history[currentStateIndex];
        canvas.loadFromJSON(prevState, () => {
            canvas.renderAll();
            isReverting = false; // 되돌리기 완료
        });
    }
}

/**
 * 다시 실행 (Redo)
 * @param {fabric.Canvas} canvas
 */
function redo(canvas) {
    if (currentStateIndex < history.length - 1) {
        isReverting = true; // 되돌리는 중임을 표시
        currentStateIndex++;
        const nextState = history[currentStateIndex];
        canvas.loadFromJSON(nextState, () => {
            canvas.renderAll();
            isReverting = false; // 되돌리기 완료
        });
    }
}
