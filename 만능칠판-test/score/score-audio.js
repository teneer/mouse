const storageKey='whiteboard.score-audio.v1';
const tabKey=storageKey+':tab';

// Browsers release the lock if its tab closes. Only successful playback claims the sound.
export async function playScoreSoundOnce(eventKey,src,play,preferred=false) {
  if (!eventKey) return play();
  if (!preferred && document.hidden) await new Promise(resolve=>setTimeout(resolve,250));
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

export function wireScoreAudio(sounds) {
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
  const frame=window.frameElement;
  const path=new URL('../',location.href).pathname;
  const speakerKey='whiteboard.speaker:'+path;
  let channel;
  try {channel=new BroadcastChannel(speakerKey);} catch {}
  if (channel) channel.onmessage=({data})=>{
    if (!frame?.dataset.tabId || data.target!==frame.dataset.tabId || localStorage.getItem(speakerKey)!==data.target) return;
    const sound=Object.values(sounds).find(item=>item.src===data.src);
    if (sound) play(sound,data.scale,data.eventKey,true);
  };
  const decoded=new Map();
  async function play(sound,scale,eventKey,preferred) {
    if (!sound || settings.muted || settings.volume===0) return;
    const element=sound.cloneNode();
    const volume=settings.volume/100*scale;
    async function startPlayback() {
      // Chrome can defer play() indefinitely in a background tab.
      const timeout=setTimeout(()=>element.pause(),2000);
      try {await element.play();} finally {clearTimeout(timeout);}
    }
    try {
      const audio=audioContext();
      if (audio) {
        if (audio.state!=='running' && !navigator.userActivation?.hasBeenActive) {
          unlock.hidden=false;return;
        }
        if (audio.state!=='running') await audio.resume();
        function connect(source) {
          const gain=audio.createGain(), limiter=audio.createDynamicsCompressor();
          gain.gain.value=volume;
          limiter.threshold.value=-1;limiter.knee.value=0;limiter.ratio.value=20;limiter.attack.value=.001;
          source.connect(gain);
          if (volume>1) gain.connect(limiter).connect(audio.destination);
          else gain.connect(audio.destination);
          return ()=>{source.disconnect();gain.disconnect();limiter.disconnect();};
        }
        if (preferred) {
          await playScoreSoundOnce(eventKey,sound.src,async()=>{
            if (!decoded.has(sound.src)) decoded.set(sound.src,fetch(sound.src).then(response=>{
              if (!response.ok) throw Error(response.statusText);
              return response.arrayBuffer();
            }).then(bytes=>audio.decodeAudioData(bytes)).catch(error=>{decoded.delete(sound.src);throw error;}));
            const buffer=await decoded.get(sound.src);
            const source=audio.createBufferSource();
            source.buffer=buffer;
            source.onended=connect(source);
            source.start();
          },true);
          unlock.hidden=true;
          return;
        }
        const source=audio.createMediaElementSource(element);
        const cleanup=connect(source);
        element.addEventListener('ended',cleanup,{once:true});
        element.addEventListener('error',cleanup,{once:true});
        try {await playScoreSoundOnce(eventKey,sound.src,startPlayback,preferred);} finally {
          if (element.paused) cleanup();
        }
      } else {
        element.volume=Math.min(1,volume);
        await playScoreSoundOnce(eventKey,sound.src,startPlayback,preferred);
      }
      unlock.hidden=true;
    } catch (error) {if (error.name==='NotAllowedError') unlock.hidden=false;else if (error.name!=='AbortError') console.warn(error);}
  }
  return async (sound,scale=1,eventKey)=>{
    const target=localStorage.getItem(speakerKey);
    const preferred=!!target && target===frame?.dataset.tabId;
    if (channel && target && !preferred && localStorage.getItem('whiteboard.view-tab:'+path+':'+target)) {
      eventKey??=crypto.randomUUID();
      channel.postMessage({target,src:sound.src,scale,eventKey});
      await new Promise(resolve=>setTimeout(resolve,350));
    }
    return play(sound,scale,eventKey,preferred);
  };
}
