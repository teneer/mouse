const storageKey='whiteboard.score-audio.v1';
const tabKey=storageKey+':tab';

// Browsers release the lock if its tab closes. Only successful playback claims the sound.
export async function playScoreSoundOnce(eventKey,src,play) {
  if (!eventKey) return play();
  const historyKey='whiteboard.score-sounds:'+src;
  const claim=async()=>{
    let recent=[];
    try {recent=JSON.parse(localStorage.getItem(historyKey)||'[]');} catch {}
    if (recent.includes(eventKey)) return;
    await play();
    recent.push(eventKey);
    try {localStorage.setItem(historyKey,JSON.stringify(recent.slice(-256)));} catch {}
  };
  if (navigator.locks) return navigator.locks.request(historyKey,claim);
  return claim();
}

export function wireScoreAudio() {
  let settings={volume:100,muted:false}, context;
  try {
    const stored=JSON.parse(sessionStorage.getItem(tabKey)||localStorage.getItem(storageKey)||'null');
    if (stored) settings={...settings,...stored};
  } catch {}
  const slider=document.getElementById('score-volume'), mute=document.getElementById('score-mute');
  const output=document.getElementById('score-volume-level'), unlock=document.getElementById('score-unlock-audio');
  function audioContext() {
    const Constructor=window.AudioContext||window.webkitAudioContext;
    if (!Constructor) return null;
    return context ??= new Constructor();
  }
  function save() {
    output.textContent=settings.volume+'%';
    const json=JSON.stringify(settings);
    try {sessionStorage.setItem(tabKey,json);localStorage.setItem(storageKey,json);} catch {}
  }
  slider.value=settings.volume;mute.checked=settings.muted;output.textContent=settings.volume+'%';
  slider.oninput=()=>{settings.volume=Number(slider.value);save();};
  mute.onchange=()=>{settings.muted=mute.checked;save();};
  async function enable() {
    try {
      const audio=audioContext();
      await audio?.resume();
      unlock.hidden=audio?.state==='running';
    } catch {unlock.hidden=false;}
  }
  unlock.onclick=enable;
  return async (sound,scale=1,eventKey)=>{
    if (!sound || settings.muted || settings.volume===0) return;
    const element=sound.cloneNode();
    const volume=settings.volume/100*scale;
    try {
      const audio=audioContext();
      if (audio) {
        if (audio.state!=='running' && !navigator.userActivation?.hasBeenActive) {
          unlock.hidden=false;return;
        }
        if (audio.state!=='running') await audio.resume();
        const source=audio.createMediaElementSource(element), gain=audio.createGain(), limiter=audio.createDynamicsCompressor();
        gain.gain.value=volume;
        limiter.threshold.value=-1;limiter.knee.value=0;limiter.ratio.value=20;limiter.attack.value=.001;
        source.connect(gain);
        if (volume>1) gain.connect(limiter).connect(audio.destination);
        else gain.connect(audio.destination);
        const cleanup=()=>{source.disconnect();gain.disconnect();limiter.disconnect();};
        element.addEventListener('ended',cleanup,{once:true});
        element.addEventListener('error',cleanup,{once:true});
        try {await playScoreSoundOnce(eventKey,sound.src,()=>element.play());} finally {
          if (element.paused) cleanup();
        }
      } else {
        element.volume=Math.min(1,volume);
        await playScoreSoundOnce(eventKey,sound.src,()=>element.play());
      }
      unlock.hidden=true;
    } catch (error) {if (error.name==='NotAllowedError') unlock.hidden=false;else console.warn(error);}
  };
}
