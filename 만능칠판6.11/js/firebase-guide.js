const steps = [
  {
    title:'프로젝트와 웹 앱 등록',
    diagram:'<div class="guide-sidebar"><span>Firebase 콘솔</span><strong>프로젝트 개요</strong><span>프로젝트 설정</span></div><div class="guide-preview"><strong class="guide-highlight">앱 추가 → &lt;/&gt; 웹</strong><span>앱 닉네임: 만능칠판</span><b>앱 등록</b></div>',
    instructions:'Firebase 콘솔에서 무료 Spark 프로젝트를 만듭니다. 프로젝트 개요에서 웹 앱을 추가하고 앱 이름을 정한 뒤 등록합니다. 이미 등록한 웹 앱이 있다면 그대로 사용합니다.',
    link:'<a href="https://console.firebase.google.com/" target="_blank" rel="noopener">Firebase 콘솔 열기</a>'
  },
  {
    title:'Firestore 데이터베이스 만들기',
    diagram:'<div class="guide-sidebar"><span>데이터베이스 및 스토리지</span><strong class="guide-highlight">Firestore</strong><span>Realtime Database</span></div><div class="guide-preview"><strong>데이터베이스 만들기</strong><span>Standard · (default)</span><b class="guide-highlight">프로덕션 모드</b></div>',
    instructions:'왼쪽의 데이터베이스 및 스토리지에서 Firestore를 엽니다. 데이터베이스를 Standard, 기본 ID (default), 프로덕션 모드로 만듭니다. Realtime Database는 같은 메뉴에 있는 별도 서비스입니다.'
  },
  {
    title:'만능칠판 보안 규칙 게시',
    diagram:'<div class="guide-sidebar"><strong>Firestore</strong><span>데이터</span><strong class="guide-highlight">규칙</strong></div><div class="guide-preview"><code>rules_version = &#39;2&#39;;<br>service cloud.firestore { … }</code><b class="guide-highlight">게시</b></div>',
    instructions:'보안 규칙 파일의 내용을 복사해 Firestore의 규칙 편집기에 붙여넣고 게시합니다. 파일이 다운로드되면 메모장으로 열어 Ctrl+A, Ctrl+C를 누릅니다. 같은 프로젝트의 다른 앱 규칙도 함께 쓰고 있다면 유지하세요.',
    link:'<div class="cloud-buttons"><button type="button" class="dialog-action" data-copy-rules>보안 규칙 복사</button><a href="firestore.rules" target="_blank" rel="noopener">보안 규칙 파일 열기</a></div><p data-rules-message role="status"></p>'
  },
  {
    title:'익명 로그인 켜기',
    diagram:'<div class="guide-sidebar"><span>보안</span><strong>Authentication</strong><span>로그인 방법</span></div><div class="guide-preview"><strong>익명</strong><span class="guide-highlight">사용 설정</span><b>저장</b></div>',
    instructions:'Authentication에서 처음이라면 시작하기를 누릅니다. 로그인 방법에서 익명을 사용 설정한 뒤 저장합니다. 연결 확인에서 auth/configuration-not-found가 나오면 이 설정과 프로젝트 ID를 확인합니다.'
  },
  {
    title:'이 기기의 첫 동기화 시작',
    diagram:'<div class="guide-sidebar"><span>프로젝트 설정</span><strong>일반 → 내 앱</strong><span>SDK 설정 및 구성</span></div><div class="guide-preview"><code class="guide-highlight">const firebaseConfig = {<br> &nbsp;apiKey: "…",<br> &nbsp;authDomain: "…",<br> &nbsp;projectId: "…",<br> &nbsp;appId: "…"<br>};</code><span>이 블록을 아래 칸에 붙여넣기 ↓</span></div>',
    instructions:'Firebase 프로젝트 설정의 일반 → 내 앱에서 웹 앱의 SDK 설정을 엽니다. const firebaseConfig로 시작하는 설정 블록을 복사합니다. 만능칠판에서 연결을 확인한 뒤 기기 이름을 적고 첫 동기화를 시작합니다.'
  },
  {
    title:'다른 기기 추가',
    diagram:'<div class="guide-preview"><strong>연결된 교실 PC</strong><span class="guide-highlight">기기 추가 → 초대 만들기</span><span>QR 표시 · 연결 키 복사</span></div><div class="guide-preview"><strong>새 기기</strong><span>QR 스캔 또는 키 붙여넣기</span><b class="guide-highlight">칠판에 연결</b></div>',
    instructions:'먼저 연결한 기기에서 기기 추가를 열고 초대를 만듭니다. 새 기기로 QR을 스캔하거나, 새 기기의 이 기기 추가하기에서 연결 키를 붙여넣습니다.'
  }
];

export function wireFirebaseGuide(root) {
  const content=root.querySelector('[data-guide-content]');
  const counter=root.querySelector('[data-guide-step]');
  const progress=root.querySelector('progress');
  const setup=root.querySelector('#deviceSetupControls');
  const previous=root.querySelector('[data-guide-prev]');
  const next=root.querySelector('[data-guide-next]');
  let index=0, readOnly=false;
  progress.max=steps.length;
  function show(newIndex) {
    index=Math.max(0,Math.min(steps.length-1,newIndex));
    const {title,diagram,instructions,link}=steps[index];
    counter.textContent=(index+1)+' / '+steps.length;
    progress.value=index+1;
    content.innerHTML='<h3>'+title+'</h3><div class="guide-diagram" aria-label="메뉴 위치 안내">'+diagram+'</div><p>'+instructions+'</p>'+(link||'');
    setup.hidden=readOnly||index!==4;
    const copyRules=content.querySelector('[data-copy-rules]');
    if (copyRules) copyRules.onclick=async()=>{
      const feedback=content.querySelector('[data-rules-message]');
      copyRules.disabled=true;
      try {
        const response=await fetch('firestore.rules',{cache:'no-cache'});
        if (!response.ok) throw Error();
        const rules=await response.text();
        if (!rules.includes('service cloud.firestore')) throw Error();
        await navigator.clipboard.writeText(rules);
        feedback.textContent='복사했습니다. Firestore의 규칙 편집기에 붙여넣으세요.';
      } catch {feedback.textContent='파일을 열어 내용을 복사해 주세요.';}
      finally {copyRules.disabled=false;}
    };
    previous.disabled=index===0;
    next.disabled=index===steps.length-1;
  }
  previous.onclick=()=>show(index-1);
  next.onclick=()=>show(index+1);
  return {open(guideOnly=false,start=0){readOnly=guideOnly;show(start);}};
}
