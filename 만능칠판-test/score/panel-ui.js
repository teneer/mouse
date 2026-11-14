/* 학급온도계 원본 로직을 수정하지 않는 패널 크기 보조 기능 */
(()=>{
 const stateKey='whiteboard.test.score-scale.v1',root=document.body;
 const value=document.getElementById('scoreSizeValue');
 let scale=100;
 try{const saved=Number(localStorage.getItem(stateKey));if(saved>=60&&saved<=150)scale=saved;}catch{}
 const setScale=n=>{
  scale=Math.max(60,Math.min(150,n));root.style.setProperty('--score-scale',String(scale/100));
  root.style.setProperty('--score-inverse-width',(10000/scale)+'%');
  value.textContent=scale+'%';
  try{localStorage.setItem(stateKey,String(scale));}catch{}
  requestAnimationFrame(updateColumns);
 };
 document.getElementById('scoreSizeDown').addEventListener('click',()=>setScale(scale-10));
 document.getElementById('scoreSizeUp').addEventListener('click',()=>setScale(scale+10));
 document.getElementById('scoreSizeReset').addEventListener('click',()=>setScale(100));
 const scoreboard=document.getElementById('scoreboard');
 function updateColumns(){
  // 기본 약 30% 너비에서는 3열. 넓어질수록 열을 추가하고, 극단적으로 좁을 때만 축소
  const available=scoreboard.getBoundingClientRect().width/(scale/100);
  let columns;
  if(available<205)columns=1;
  else if(available<245)columns=2;
  else columns=Math.max(3,Math.floor((available+8)/108));
  columns=Math.min(12,columns);
  scoreboard.style.setProperty('--team-columns',String(columns));
 }
 if(typeof ResizeObserver!=='undefined')new ResizeObserver(updateColumns).observe(scoreboard);
 window.addEventListener('resize',updateColumns);
 setScale(scale);
})();
