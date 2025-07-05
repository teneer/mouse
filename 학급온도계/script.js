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

let count = localStorage.getItem('mainScore') ? parseInt(localStorage.getItem('mainScore')) : 0;
const step = 1;
const numberElement = document.getElementById('number');
const changeElement = document.getElementById('change');
const minScore = -10000;
const maxScore = 10000;

function showChange(amount) {
  changeElement.textContent = (typeof amount === "number" && amount > 0 ? "+" : "") + amount;
  changeElement.style.top = "55px";
  changeElement.style.opacity = 1;
  setTimeout(() => {
    changeElement.style.opacity = 0;
    changeElement.style.top = "35px";
  }, 600);
}

function updateNumber(className) {
  numberElement.textContent = count;
  numberElement.className = className;
  setTimeout(() => numberElement.className = "", 200);
  localStorage.setItem('mainScore', count);
}

function increment() {
  if (count + step <= maxScore) {
    count += step;
    updateNumber('increase');
    showChange(step);
    playSound(sounds.mainIncrease);
  }
}

function decrement() {
  if (count - step >= minScore) {
    count -= step;
    updateNumber('decrease');
    showChange(-step);
    playSound(sounds.mainDecrease);
  }
}

function resetScore() {
  count = 0;
  updateNumber('');
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

function loadTeamsFromStorage() {
  const savedTeams = localStorage.getItem('teams');
  if (savedTeams) {
    teams = JSON.parse(savedTeams);
    renderTeams();
  } else {
    teams = [];
    renderTeams();
  }
}

function saveTeamsToStorage() {
  localStorage.setItem('teams', JSON.stringify(teams));
}

function showTeamSetupModal() {
  teamSetupModal.style.display = 'flex';
  document.getElementById('team-count').focus();
}

function hideTeamSetupModal() {
  teamSetupModal.style.display = 'none';
}

function createTeams() {
  let countInput = document.getElementById('team-count');
  let n = parseInt(countInput.value, 10);
  if (isNaN(n) || n < 1) n = 1;
  if (n > 24) n = 24;
  countInput.value = n;
  let currentCount = teams.length;
  for (let i = 1; i <= n; i++) {
    teams.push({ name: `모둠 ${currentCount + i}`, score: 0 });
  }
  hideTeamSetupModal();
  renderTeams();
  saveTeamsToStorage();
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
      if (
        e.target.classList.contains('team-minus-btn') ||
        e.target.classList.contains('team-remove-btn') ||
        e.target.classList.contains('team-name') ||
        e.target.classList.contains('team-name-input') ||
        e.target.classList.contains('team-score-input') ||
        e.target.classList.contains('team-number')
      ) return;
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

window.changeTeamScore = function(idx, amount) {
  const team = teams[idx];
  const newScore = team.score + amount;
  if (newScore > maxScore || newScore < minScore) return;
  team.score = newScore;
  const numberEl = document.getElementById(`team-number-${idx}`);
  const changeEl = document.getElementById(`team-change-${idx}`);
  numberEl.textContent = team.score;
  numberEl.className = 'team-number ' + (amount > 0 ? 'team-increase' : 'team-decrease');
  if (amount > 0) {
    playSound(sounds.teamIncrease);
  } else {
    playSound(sounds.teamDecrease);
  }
  setTimeout(() => numberEl.className = 'team-number', 200);
  changeEl.textContent = (amount > 0 ? "+" : "") + amount;
  changeEl.style.top = "10px";
  changeEl.style.opacity = 1;
  setTimeout(() => {
    changeEl.style.opacity = 0;
    changeEl.style.top = "0px";
  }, 600);
  saveTeamsToStorage();
};

function resetAllTeams() {
  if (teams.length === 0) return;
  teams.forEach((team, idx) => {
    team.score = 0;
    const numberEl = document.getElementById(`team-number-${idx}`);
    if (numberEl) {
      numberEl.textContent = 0;
      numberEl.className = 'team-number';
    }
    const changeEl = document.getElementById(`team-change-${idx}`);
    if (changeEl) {
      changeEl.textContent = "리셋";
      changeEl.style.top = "10px";
      changeEl.style.opacity = 1;
      setTimeout(() => {
        changeEl.style.opacity = 0;
        changeEl.style.top = "0px";
      }, 600);
    }
  });
  saveTeamsToStorage();
  playSound(sounds.confirm);
}

function removeTeam(idx) {
  teams.splice(idx, 1);
  renderTeams();
  saveTeamsToStorage();
  playSound(sounds.confirm);
}

window.editTeamName = function(idx) {
  const team = teams[idx];
  const nameSpan = document.getElementById(`team-name-${idx}`);
  if (!nameSpan) return;
  if (nameSpan.parentNode.querySelector('.team-name-input')) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = team.name;
  input.className = 'team-name-input';
  input.maxLength = 20;
  input.onkeydown = function(e) {
    if (e.key === 'Enter') {
      input.blur();
    }
  };
  input.onblur = function() {
    let newName = input.value.trim();
    if (!newName) newName = `모둠 ${idx+1}`;
    team.name = newName;
    renderTeams();
    saveTeamsToStorage();
  };
  nameSpan.replaceWith(input);
  input.focus();
  input.select();
};

window.editTeamScore = function(idx) {
  const team = teams[idx];
  const numberSpan = document.getElementById(`team-number-${idx}`);
  if (!numberSpan) return;
  if (numberSpan.parentNode.querySelector('.team-score-input')) return;
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
  input.onkeydown = function(e) {
    if (e.key === 'Enter') {
      input.blur();
    }
  };
  input.onblur = function() {
    let newValue = parseInt(input.value, 10);
    if (isNaN(newValue)) newValue = 0;
    if (newValue < minScore) newValue = minScore;
    if (newValue > maxScore) newValue = maxScore;
    team.score = newValue;
    saveTeamsToStorage();
    renderTeams();
  };
  numberSpan.replaceWith(input);
  input.focus();
  input.select();
};

numberElement.title = '점수 변경';
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
  input.onkeydown = function(e) {
    if (e.key === 'Enter') {
      input.blur();
    }
  };
  input.onblur = function() {
    let newValue = parseInt(input.value, 10);
    if (isNaN(newValue)) newValue = 0;
    if (newValue < minScore) newValue = minScore;
    if (newValue > maxScore) newValue = maxScore;
    count = newValue;
    updateNumber('');
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
  numberElement.textContent = count;
  loadTeamsFromStorage();
};

teamSetupModal.addEventListener('mousedown', function(e) {
  if (e.target === teamSetupModal) hideTeamSetupModal();
});

const settingsPanel = document.getElementById('settings-panel');
const settingsToggleBtn = document.getElementById('settings-toggle-btn');
let settingsOpen = false;
settingsToggleBtn.onclick = function() {
  settingsOpen = !settingsOpen;
  if (settingsOpen) {
    settingsPanel.classList.add('open');
  } else {
    settingsPanel.classList.remove('open');
  }
};
document.addEventListener('mousedown', function(e) {
  if (settingsOpen && !settingsPanel.contains(e.target) && !settingsToggleBtn.contains(e.target)) {
    settingsPanel.classList.remove('open');
    settingsOpen = false;
  }
});
