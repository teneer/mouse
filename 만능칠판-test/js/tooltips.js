const descriptions={
  undoBtn:'이 페이지의 최근 편집을 되돌립니다.',
  redoBtn:'되돌린 편집을 다시 적용합니다.',
  selectMoveToggleBtn:'개체 선택과 칠판 이동 모드를 전환합니다.',
  penModeBtn:'펜으로 칠판에 필기합니다.',
  markerModeBtn:'반투명한 형광펜으로 표시합니다.',
  freeTextModeBtn:'칠판에 편집 가능한 글자를 넣습니다.',
  answerCoverTool:'가릴 영역을 드래그합니다. 다시 눌러 종료합니다.',
  eraserModeBtn:'지나간 펜 획이나 개체를 지웁니다.',
  deleteSelectionBtn:'선택한 개체를 삭제합니다. 길게 누르면 페이지 지우기를 엽니다.',
  currentColorButton:'현재 도구의 색상을 고릅니다.',
  currentSizeButton:'현재 도구의 굵기나 글자 크기를 고릅니다.',
  backgroundBtn:'현재 페이지 배경을 바꿉니다.',
  homeBtn:'칠판을 기본 위치와 100% 배율로 되돌립니다.',
  previousPageBtn:'이전 페이지로 이동합니다.',
  pageListBtn:'전체 페이지의 썸네일을 엽니다.',
  nextPageBtn:'다음 페이지로 이동합니다.',
  zoomInBtn:'칠판을 확대합니다.',
  zoomOutBtn:'칠판을 축소합니다.',
  viewSync:'선택한 탭에 현재 페이지와 확대 위치를 공유합니다.',
  viewSyncTrigger:'화면 동기화에 참여할 탭을 고릅니다.',
  scorePanelToggle:'학급과 모둠 점수판을 열거나 닫습니다.',
  moreBtn:'저장, 자료, 기기 연결 등 추가 도구를 엽니다.',
  loadGeneralBtn:'저장한 화면을 새 페이지로 불러옵니다.',
  saveBtn:'현재 페이지를 별도 화면으로 저장합니다.',
  copyBtn:'선택한 개체를 클립보드에 복사합니다.',
  pasteBtn:'클립보드 내용을 칠판에 붙여넣습니다.',
  importFileBtn:'이미지나 PDF를 현재 페이지에 추가합니다.',
  deviceConnectBtn:'다른 기기를 연결하고 공유 상태를 확인합니다.',
  fileManagerBtn:'이미지·PDF 원본 위치를 확인하고 필요한 파일을 받습니다.',
  backgroundManageBtn:'배경으로 고정한 개체를 확인하고 고정을 해제합니다.',
  helpBtn:'기능별 사용법을 다섯 쪽으로 봅니다.',
  colorSettingsBtn:'빠른 색상과 크기 즐겨찾기를 편집합니다.',
  moreTextPropsBtn:'새 텍스트 박스의 배경과 테두리 기본값을 정합니다.',
  exportBackupBtn:'칠판 데이터와 자료를 JSON 백업으로 내려받습니다.',
  importBackupBtn:'JSON 백업에서 페이지와 저장 화면을 가져옵니다.',
  importLegacyBtn:'이 브라우저에 남은 이전 버전 자료를 가져옵니다.',
  contextAnswerCover:'칠판 위에 정답 가리개를 그립니다.',
  contextRenameCover:'가리개 중앙에 표시할 이름을 바꿉니다.',
  contextPin:'선택한 개체를 배경으로 고정합니다.',
  contextFront:'선택한 개체를 앞으로 올립니다.',
  contextBack:'선택한 개체를 뒤로 보냅니다.',
  contextGroup:'선택한 개체를 한 그룹으로 묶습니다.',
  contextUngroup:'그룹을 개별 개체로 나눕니다.',
  contextTextProps:'선택한 텍스트의 배경과 테두리를 바꿉니다.',
  helpPrevious:'사용법의 이전 쪽으로 이동합니다.',
  helpNext:'사용법의 다음 쪽으로 이동합니다.',
  'score-conflicts':'동시에 편집된 점수의 값을 비교합니다.',
  'score-unlock-audio':'이 탭에서 점수 효과음을 사용할 수 있게 합니다.',
  'score-maximize':'점수판 전체 화면을 켜거나 끕니다.',
  'settings-toggle-btn':'칠판 중앙에서 점수판 설정을 엽니다.',
  'class-pursuit':'학급 추격 기준과 패널티 문구를 편집합니다.',
  'team-pursuit':'모둠 추격 기준과 패널티 문구를 편집합니다.',
  'create-teams-btn':'새 모둠 카드를 추가합니다.',
  'undo-score':'마지막 점수 변경을 되돌립니다.',
  'apply-batch':'입력한 점수를 선택한 모둠에 각각 반영합니다.',
  'score-panel-side':'점수판을 칠판 왼쪽이나 오른쪽으로 옮깁니다.',
  'score-layout-mode':'모둠 카드의 자동 배치와 열 지정을 전환합니다.',
  'score-card-ratio':'모둠 카드의 가로세로 비율을 바꿉니다.',
  'manage-pursuit':'한 창에서 학급과 모둠의 추격자를 관리합니다.',
  'open-goal-modal-btn':'목표 점수와 달성 기록을 관리합니다.',
  'open-management-modal-btn':'학급 점수와 모둠 이름·점수를 직접 편집합니다.',
  'reset-main-btn':'학급 점수를 초기화합니다.',
  'reset-teams-btn':'모든 모둠 점수를 초기화합니다.'
};

export function wireTooltips() {
  const tooltip=document.createElement('div');
  tooltip.id='boardButtonTooltip';
  tooltip.className='board-tooltip';
  tooltip.setAttribute('role','tooltip');
  tooltip.hidden=true;
  document.body.append(tooltip);
  let active,timer,nativeTitle,previousDescription;

  function hide() {
    clearTimeout(timer);
    tooltip.hidden=true;
    if (!active) return;
    if (nativeTitle!==null && !active.hasAttribute('title')) active.title=nativeTitle;
    if (previousDescription===null) active.removeAttribute('aria-describedby');
    else active.setAttribute('aria-describedby',previousDescription);
    active=null;
  }
  function description(button) {
    if (button.id==='answerCoverAll') return '이 페이지의 가리개를 '+(button.title==='모두 닫기'?'모두 닫습니다.':'모두 엽니다.');
    if (button.id==='answerCoverSync') return '가리개 동기화 · 이 페이지의 열림 상태를 다른 탭과 공유합니다.';
    if (button.id==='select-all-teams') return button.textContent==='전체해제'?'선택한 모둠을 모두 해제합니다.':'모든 모둠을 선택합니다.';
    if (button.hasAttribute('data-help-topic')) return button.textContent.trim()+' 사용법으로 이동합니다.';
    return descriptions[button.id] || button.dataset.tooltip || button.title ||
      button.getAttribute('aria-label') || button.textContent.trim().replace(/\s+/g,' ');
  }
  function position(button) {
    const rect=button.getBoundingClientRect(),width=tooltip.offsetWidth,height=tooltip.offsetHeight;
    tooltip.style.left=Math.max(6,Math.min(innerWidth-width-6,rect.left+(rect.width-width)/2))+'px';
    tooltip.style.top=Math.max(6,Math.min(innerHeight-height-6,rect.top-height-6>=6?rect.top-height-6:rect.bottom+6))+'px';
  }
  function show(button,delay) {
    hide();
    const text=description(button);
    if (!text) return;
    active=button;
    nativeTitle=button.getAttribute('title');
    previousDescription=button.getAttribute('aria-describedby');
    if (nativeTitle!==null) button.removeAttribute('title');
    timer=setTimeout(()=>{
      if (active!==button || !button.getClientRects().length) {hide();return;}
      const host=button.closest('dialog[open],:popover-open') || document.body;
      host.append(tooltip);
      tooltip.textContent=text;
      tooltip.hidden=false;
      position(button);
      button.setAttribute('aria-describedby',[previousDescription,tooltip.id].filter(Boolean).join(' '));
    },delay);
  }
  const match=target=>target instanceof Element && target.closest('button,[role="button"],#answerCoverSync,#score-progress');
  document.addEventListener('pointerover',event=>{
    const button=match(event.target);
    if (button && button!==match(event.relatedTarget) && event.pointerType!=='touch') show(button,350);
  });
  document.addEventListener('pointerout',event=>{
    if (active===match(event.target) && active!==match(event.relatedTarget)) hide();
  });
  document.addEventListener('focusin',event=>{
    const button=match(event.target);
    if (button?.matches(':focus-visible')) show(button,0);
  });
  document.addEventListener('focusout',event=>{if (active===match(event.target)) hide();});
  document.addEventListener('pointerdown',hide,true);
  document.addEventListener('scroll',()=>{
    if (!active?.matches(':focus-visible')) hide();
    else if (!tooltip.hidden) position(active);
  },true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape') hide();},true);
  window.addEventListener('resize',hide);
}
