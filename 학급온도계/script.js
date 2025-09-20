const SUPABASE_URL = 'https://yzprxcrczhddcoimrtco.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6cHJ4Y3JjemhkZGNvaW1ydGNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYzNzk1MjAsImV4cCI6MjA3MTk1NTUyMH0.ECFX8-GSBUbFeNcC9Iu_X6mAAlLyz2BGUlYW0pw139g';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const sounds = {
    mainIncrease: new Audio('Sound/Egg up.mp3'),
    mainDecrease: new Audio('Sound/Egg down.mp3'),
    teamIncrease: new Audio('Sound/Plus.mp3'),
    teamDecrease: new Audio('Sound/Minus.mp3'),
    confirm: new Audio('Sound/confirm.mp3')
};

function playSound(sound) {
    const soundClone = sound.cloneNode();
    soundClone.play();
}

let count = 0;
const step = 1;
const numberElement = document.getElementById('number');
const changeElement = document.getElementById('change');
const minScore = -10000;
const maxScore = 10000;

// Undo 관련 변수
let undoStack = [];
let undoTimer = null;
let undoAvailable = false;
let undoInterval = null;
let undoSeconds = 60;

// undo 버튼
const undoBtn = document.getElementById('undo-btn');
if (undoBtn) undoBtn.style.display = 'none';

function showChange(amount) {
    changeElement.textContent = (typeof amount === "number" && amount > 0 ? "+" : "") + amount;
    changeElement.style.top = "55px";
    changeElement.style.opacity = 1;
    setTimeout(() => {
        changeElement.style.opacity = 0;
        changeElement.style.top = "35px";
    }, 600);
}

async function updateNumber(className) {
    numberElement.textContent = count;
    numberElement.className = className;
    setTimeout(() => numberElement.className = "", 200);
    await supabase.from('main_score').update({ score: count }).eq('id', 1);
}

function updateUndoBtnText() {
    if (undoBtn) {
        undoBtn.textContent = `되돌리기 ${undoSeconds.toString().padStart(2, '0')}초 남았습니다`;
    }
}

function showUndoButtonFor1min() {
    if (!undoBtn) return;
    undoAvailable = true;
    undoBtn.style.display = 'block';
    undoSeconds = 60;
    updateUndoBtnText();

    if (undoInterval) clearInterval(undoInterval);
    undoInterval = setInterval(() => {
        undoSeconds--;
        updateUndoBtnText();
        if (undoSeconds <= 0) {
            hideUndoButton();
        }
    }, 1000);

    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = setTimeout(hideUndoButton, 60000);
}

function hideUndoButton() {
    undoAvailable = false;
    undoStack = [];
    if (undoBtn) {
        undoBtn.style.display = 'none';
        undoBtn.classList.remove('clicked');
    }
    if (undoInterval) clearInterval(undoInterval);
    undoInterval = null;
}

function saveUndoState() {
    undoStack.push({
        count: count,
        teams: JSON.parse(JSON.stringify(teams))
    });
    if (undoStack.length > 30) undoStack.shift();
    showUndoButtonFor1min();
}

async function undoLastAction() {
    if (!undoAvailable || undoStack.length === 0) return;
    const lastState = undoStack.pop();

    // 클릭 피드백 효과
    if (undoBtn) {
        undoBtn.classList.add('clicked');
        setTimeout(() => {
            undoBtn.classList.remove('clicked');
        }, 120);
    }

    count = lastState.count;
    await supabase.from('main_score').update({ score: count }).eq('id', 1);
    for (let i = 0; i < lastState.teams.length; i++) {
        await supabase.from('teams').update({
            score: lastState.teams[i].score,
            name: lastState.teams[i].name
        }).eq('id', lastState.teams[i].id);
    }
    teams = JSON.parse(JSON.stringify(lastState.teams));
    renderTeams();
    numberElement.textContent = count;
    if (undoStack.length === 0) {
        hideUndoButton();
    }
}

if (undoBtn) {
    undoBtn.onclick = undoLastAction;
}

async function increment() {
    saveUndoState();
    if (count + step <= maxScore) {
        count += step;
        await updateNumber('increase');
        showChange(step);
        playSound(sounds.mainIncrease);
    }
}

async function decrement() {
    saveUndoState();
    if (count - step >= minScore) {
        count -= step;
        await updateNumber('decrease');
        showChange(-step);
        playSound(sounds.mainDecrease);
    }
}

async function resetScore() {
    saveUndoState();
    count = 0;
    await updateNumber('');
    showChange('리셋');
    playSound(sounds.confirm);
}

document.addEventListener('keydown', function(event) {
    const tag = event.target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (event.key === "+" || event.key === "ArrowUp") increment();
    if (event.key === "-" || event.key === "ArrowDown") decrement();
    if (event.key === "0") resetScore();
});

let teams = [];
const scoreboard = document.getElementById('scoreboard');
const scoreboardTitle = document.getElementById('scoreboard-title');
const createTeamsBtnWrap = document.getElementById('create-teams-btn-wrap');
const teamSetupModal = document.getElementById('team-setup-modal');

async function loadInitialData() {
    const { data: mainScoreData, error: mainError } = await supabase.from('main_score').select('score').eq('id', 1).single();
    if (mainError && mainError.code !== 'PGRST116') {
        console.error('메인 점수 로딩 에러:', mainError);
    } else if (mainScoreData) {
        count = mainScoreData.score;
        numberElement.textContent = count;
    } else {
        await supabase.from('main_score').insert({ id: 1, score: 0 });
        count = 0;
        numberElement.textContent = count;
    }

    const { data: teamsData, error: teamsError } = await supabase.from('teams').select('*').order('created_at', { ascending: true });
    if (teamsError) {
        console.error('모둠 목록 로딩 에러:', teamsError);
    } else {
        teams = teamsData;
        renderTeams();
    }
}

function listenToChanges() {
    const handleTeamChanges = (payload) => {
        const { eventType, new: newRecord, old: oldRecord } = payload;
        if (eventType === 'INSERT') {
            teams.push(newRecord);
        } else if (eventType === 'UPDATE') {
            const teamIndex = teams.findIndex(t => t.id === newRecord.id);
            if (teamIndex !== -1) teams[teamIndex] = newRecord;
        } else if (eventType === 'DELETE') {
            teams = teams.filter(t => t.id !== oldRecord.id);
        }
        teams.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        renderTeams();
    };

    supabase.channel('public:teams')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, handleTeamChanges)
        .subscribe();

    supabase.channel('public:main_score')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'main_score' }, (payload) => {
            if (payload.new && payload.new.score !== undefined) {
                count = payload.new.score;
                numberElement.textContent = count;
            }
        })
        .subscribe();
}

function showTeamSetupModal() {
    teamSetupModal.style.display = 'flex';
    document.getElementById('team-count').focus();
}

function hideTeamSetupModal() {
    teamSetupModal.style.display = 'none';
}

async function createTeams() {
    let countInput = document.getElementById('team-count');
    let n = parseInt(countInput.value, 10);
    if (isNaN(n) || n < 1) n = 1;
    if (n > 24) n = 24;
    countInput.value = n;

    const newTeams = [];
    for (let i = 1; i <= n; i++) {
        newTeams.push({ name: `모둠 ${teams.length + i}`, score: 0 });
    }

    if (newTeams.length > 0) {
        const { error } = await supabase.from('teams').insert(newTeams).select();
        if (error) {
            console.error('모둠 생성 중 오류 발생:', error);
            alert('모둠 생성에 실패했습니다. 콘솔을 확인해주세요.');
        }
    }

    hideTeamSetupModal();
    playSound(sounds.confirm);
}

function renderTeams() {
    if (teams.length === 0) {
        scoreboard.innerHTML = '';
        scoreboardTitle.style.display = 'none';
        createTeamsBtnWrap.style.display = 'flex';
        return;
    }
    scoreboard.innerHTML = '';
    scoreboardTitle.style.display = '';
    createTeamsBtnWrap.style.display = 'none';
    teams.forEach((team, idx) => {
        const card = document.createElement('div');
        card.className = 'team-card';
        card.setAttribute('tabindex', '0');
        card.setAttribute('title', '점수 증가');
        card.onclick = function(e) {
            if (e.target.closest('.team-minus-btn, .team-remove-btn, .team-name, .team-number')) return;
            changeTeamScore(idx, step);
        };
        const removeBtn = document.createElement('button');
        removeBtn.className = 'team-remove-btn';
        removeBtn.title = '모둠 삭제';
        removeBtn.innerHTML = '×';
        removeBtn.onclick = function(event) {
            event.stopPropagation();
            if (confirm('정말 삭제하시겠습니까?')) {
                removeTeam(idx);
            }
        };
        card.appendChild(removeBtn);

        let nameSpan = document.createElement('span');
        nameSpan.className = 'team-name';
        nameSpan.id = `team-name-${idx}`;
        nameSpan.title = '이름 변경';
        nameSpan.textContent = team.name;
        nameSpan.onclick = function(event) {
            event.stopPropagation();
            editTeamName(idx);
        };
        card.appendChild(nameSpan);

        let controlsDiv = document.createElement('div');
        controlsDiv.className = 'team-controls';
        let teamNumberSpan = document.createElement('span');
        teamNumberSpan.id = `team-number-${idx}`;
        teamNumberSpan.className = 'team-number';
        teamNumberSpan.textContent = team.score;
        teamNumberSpan.title = '점수 변경';
        teamNumberSpan.onclick = function(event) {
            event.stopPropagation();
            editTeamScore(idx);
        };
        controlsDiv.appendChild(teamNumberSpan);
        card.appendChild(controlsDiv);

        let changeDiv = document.createElement('div');
        changeDiv.id = `team-change-${idx}`;
        changeDiv.className = 'team-change';
        card.appendChild(changeDiv);

        const minusBtn = document.createElement('button');
        minusBtn.className = 'team-minus-btn';
        minusBtn.title = '점수 감소';
        minusBtn.innerHTML = '−';
        minusBtn.onclick = function(event) {
            event.stopPropagation();
            changeTeamScore(idx, -step);
        };
        card.appendChild(minusBtn);

        scoreboard.appendChild(card);
    });
}

window.changeTeamScore = async function(idx, amount) {
    saveUndoState();
    const team = teams[idx];
    if (!team) return;
    const newScore = team.score + amount;
    if (newScore > maxScore || newScore < minScore) return;

    if (amount > 0) {
        playSound(sounds.teamIncrease);
    } else {
        playSound(sounds.teamDecrease);
    }

    const numberEl = document.getElementById(`team-number-${idx}`);
    if (numberEl) numberEl.textContent = newScore;

    await supabase.from('teams').update({ score: newScore }).eq('id', team.id);
};

async function resetAllTeams() {
    saveUndoState();
    if (teams.length === 0) return;
    const teamIds = teams.map(team => team.id);
    await supabase.from('teams').update({ score: 0 }).in('id', teamIds);
    playSound(sounds.confirm);
}

async function removeTeam(idx) {
    saveUndoState();
    const teamToDelete = teams[idx];
    if (!teamToDelete) return;
    await supabase.from('teams').delete().eq('id', teamToDelete.id);
    playSound(sounds.confirm);
}

window.editTeamName = function(idx) {
    saveUndoState();
    const team = teams[idx];
    const nameSpan = document.getElementById(`team-name-${idx}`);
    if (!nameSpan || nameSpan.parentNode.querySelector('.team-name-input')) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = team.name;
    input.className = 'team-name-input';
    input.maxLength = 20;
    input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); };
    input.onblur = async () => {
        let newName = input.value.trim() || `모둠 ${idx + 1}`;
        await supabase.from('teams').update({ name: newName }).eq('id', teams[idx].id);
    };
    nameSpan.replaceWith(input);
    input.focus();
    input.select();
};

window.editTeamScore = function(idx) {
    saveUndoState();
    const team = teams[idx];
    const numberSpan = document.getElementById(`team-number-${idx}`);
    if (!numberSpan || numberSpan.parentNode.querySelector('.team-score-input')) return;
    const input = document.createElement('input');
    input.type = 'number';
    input.value = team.score;
    input.className = 'team-score-input';
    input.min = minScore;
    input.max = maxScore;
    input.setAttribute('autocomplete', 'off');
    input.style.fontSize = '36px';
    input.style.minWidth = '60px';
    input.style.maxWidth = '180px';
    input.style.width = getInputWidth(input.value, 36) + 'px';
    input.oninput = function() {
        input.style.width = getInputWidth(input.value, 36) + 'px';
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); };
    input.onblur = async () => {
        let newValue = parseInt(input.value, 10);
        if (isNaN(newValue)) newValue = 0;
        newValue = Math.max(minScore, Math.min(maxScore, newValue));
        await supabase.from('teams').update({ score: newValue }).eq('id', teams[idx].id);
    };
    numberSpan.replaceWith(input);
    input.focus();
    input.select();
};

numberElement.onclick = function(event) {
    event.stopPropagation();
    if (document.getElementById('main-score-input')) return;
    const input = document.createElement('input');
    input.type = 'number';
    input.value = count;
    input.id = 'main-score-input';
    input.min = minScore;
    input.max = maxScore;
    input.setAttribute('autocomplete', 'off');
    input.style.fontSize = '65px';
    input.style.minWidth = '80px';
    input.style.maxWidth = '300px';
    input.style.width = getInputWidth(input.value, 65) + 'px';
    input.oninput = function() {
        input.style.width = getInputWidth(input.value, 65) + 'px';
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') { input.blur(); } };
    input.onblur = async () => {
        let newValue = parseInt(input.value, 10);
        if (isNaN(newValue)) newValue = 0;
        count = Math.max(minScore, Math.min(maxScore, newValue));
        await updateNumber('');
        input.replaceWith(numberElement);
    };
    numberElement.replaceWith(input);
    input.focus();
    input.select();
};

function getInputWidth(value, fontSize) {
    return Math.max((String(value).length || 1) * fontSize * 0.6 + 30, fontSize + 30);
}

const mainIncreaseBtn = document.getElementById('main-increase-btn');
if (mainIncreaseBtn) mainIncreaseBtn.title = '점수 증가';
const mainDecreaseBtn = document.getElementById('main-decrease-btn');
if (mainDecreaseBtn) mainDecreaseBtn.title = '점수 감소';
const createTeamsBtn = document.getElementById('create-teams-btn');
if (createTeamsBtn) createTeamsBtn.title = '모둠 생성';
const resetMainBtn = document.getElementById('reset-main-btn');
if (resetMainBtn) resetMainBtn.title = '메인 점수 초기화';
const resetTeamsBtn = document.getElementById('reset-teams-btn');
if (resetTeamsBtn) resetTeamsBtn.title = '모든 모둠 점수 초기화';

window.onload = function() {
    loadInitialData();
    listenToChanges();
};

teamSetupModal.addEventListener('mousedown', function(e) {
    if (e.target === teamSetupModal) hideTeamSetupModal();
});

const settingsPanel = document.getElementById('settings-panel');
const settingsToggleBtn = document.getElementById('settings-toggle-btn');
let settingsOpen = false;
settingsToggleBtn.onclick = function() {
    settingsOpen = !settingsOpen;
    settingsPanel.classList.toggle('open');
};
document.addEventListener('mousedown', function(e) {
    if (settingsOpen && !settingsPanel.contains(e.target) && !settingsToggleBtn.contains(e.target)) {
        settingsPanel.classList.remove('open');
        settingsOpen = false;
    }
});
