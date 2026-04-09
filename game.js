/* ── Diamond Dash – game.js ── */

/* Tile types */
const EMPTY=0,WALL=1,GEM=2,FIRE=3,ICE_GEM=4,TIME_GEM=5,BOMB_GEM=6;
const SPECIAL_CHANCE=0.15,COMBO_WINDOW=1500,FIRE_LIFE_MIN=6000,FIRE_LIFE_MAX=12000;

const canvas=document.getElementById('canvas');
const ctx=canvas.getContext('2d');

/* State */
let level,COLS,ROWS,NEED,DX,DY,T=40;
let grid,px,py,collected,doorOpen,dead,score;
let rafId,fireTimerId,nextBurn,burnStartTime,baseFireMs;
let combo,lastPickupTime,comboPopups;
let fireFrozen,freezeEndTime,fireSlowed,slowEndTime;
let levelComplete,levelCompleteTime;
let fireAge; /* Map "x,y" → timestamp when fire was placed */
let extinguishTimerId;

/* ── Level config ── */
function lvlCfg(l){
  const s=Math.min(7+(l-1)*2,13);
  return{cols:s,rows:s,
    fireMs:Math.max(1500,4000-(l-1)*300),
    need:Math.min(3+l*2,15),
    iFire:Math.min(2+l*2,12),
    iGem:Math.min(6+l*3,25)};
}

/* ── Helpers ── */
function calcTile(){return Math.max(26,Math.floor(Math.min(window.innerWidth-24,540)/COLS));}
function resizeCanvas(){T=calcTile();canvas.width=COLS*T;canvas.height=ROWS*T;}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=0|Math.random()*(i+1);[a[i],a[j]]=[a[j],a[i]]}return a;}
function isGem(t){return t===GEM||t===ICE_GEM||t===TIME_GEM||t===BOMB_GEM;}
function gemCount(){let g=0;for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++)if(isGem(grid[y][x]))g++;return g;}

function pickNextBurn(){
  let gems=[];
  for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++)if(isGem(grid[y][x]))gems.push({x,y});
  if(!gems.length){nextBurn=null;return;}
  nextBurn=gems[0|Math.random()*gems.length];burnStartTime=performance.now();
}

function setFire(x,y){grid[y][x]=FIRE;fireAge.set(`${x},${y}`,performance.now()+FIRE_LIFE_MIN+Math.random()*(FIRE_LIFE_MAX-FIRE_LIFE_MIN));}
function getFireMs(){return(fireSlowed&&performance.now()<slowEndTime)?baseFireMs*2:baseFireMs;}
function scheduleBurn(){if(fireTimerId)clearTimeout(fireTimerId);fireTimerId=setTimeout(burnOne,getFireMs());}

function extinguishOld(){
  if(dead||levelComplete)return;
  const now=performance.now();
  for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
    if(grid[y][x]===FIRE){
      const key=`${x},${y}`;
      const expire=fireAge.get(key);
      if(expire&&now>=expire){grid[y][x]=EMPTY;fireAge.delete(key);}
    }
  }
  scheduleExtinguish();
}
function scheduleExtinguish(){if(extinguishTimerId)clearTimeout(extinguishTimerId);extinguishTimerId=setTimeout(extinguishOld,1000);}

function burnOne(){
  if(dead||levelComplete)return;
  const now=performance.now();
  if(fireFrozen&&now<freezeEndTime){scheduleBurn();return;}
  if(now>=freezeEndTime)fireFrozen=false;
  if(now>=slowEndTime)fireSlowed=false;
  if(nextBurn&&isGem(grid[nextBurn.y][nextBurn.x]))setFire(nextBurn.x,nextBurn.y);
  updHUD();pickNextBurn();scheduleBurn();
}

/* ── HUD ── */
function updHUD(){
  document.getElementById('c').textContent=collected;
  document.getElementById('n').textContent=NEED;
  document.getElementById('r').textContent=gemCount();
  document.getElementById('sc').textContent=score;
  document.getElementById('lv').textContent=level;
  document.getElementById('fi').textContent=(baseFireMs/1000).toFixed(1);
}

function addPopup(text,x,y,color){
  comboPopups.push({text,x,y,start:performance.now(),dur:1200,color:color||'#fbbf24'});
}

/* ── Init ── */
function initLevel(){
  if(rafId)cancelAnimationFrame(rafId);
  if(fireTimerId)clearTimeout(fireTimerId);
  if(extinguishTimerId)clearTimeout(extinguishTimerId);
  const cfg=lvlCfg(level);
  COLS=cfg.cols;ROWS=cfg.rows;NEED=cfg.need;
  baseFireMs=cfg.fireMs;DX=COLS-2;DY=ROWS-2;
  resizeCanvas();
  collected=0;doorOpen=false;dead=false;levelComplete=false;
  px=1;py=1;nextBurn=null;combo=1;lastPickupTime=0;
  fireFrozen=false;fireSlowed=false;freezeEndTime=0;slowEndTime=0;
  comboPopups=[];
  fireAge=new Map();

  grid=Array.from({length:ROWS},(_,y)=>Array.from({length:COLS},(_,x)=>
    (x===0||x===COLS-1||y===0||y===ROWS-1)?WALL:(x%2===0&&y%2===0)?WALL:EMPTY));
  const safe=new Set(['1,1','2,1','1,2',`${DX},${DY}`]);
  let open=[];
  for(let y=1;y<ROWS-1;y++)for(let x=1;x<COLS-1;x++)
    if(grid[y][x]===EMPTY&&!safe.has(`${x},${y}`))open.push({x,y});
  shuffle(open);
  let idx=0;
  for(let i=0;i<cfg.iFire&&idx<open.length;i++,idx++)setFire(open[idx].x,open[idx].y);
  for(let i=0;i<cfg.iGem&&idx<open.length;i++,idx++){
    if(Math.random()<SPECIAL_CHANCE){
      grid[open[idx].y][open[idx].x]=[ICE_GEM,TIME_GEM,BOMB_GEM][0|Math.random()*3];
    }else{
      grid[open[idx].y][open[idx].x]=GEM;
    }
  }

  updHUD();
  document.getElementById('msg').textContent=level>1?`Level ${level} — Go!`:'';
  if(level>1)setTimeout(()=>{if(!dead&&!levelComplete)document.getElementById('msg').textContent='';},2000);
  document.getElementById('rb').style.display='none';
  pickNextBurn();scheduleBurn();scheduleExtinguish();rafId=requestAnimationFrame(loop);
}

function initGame(){level=1;score=0;comboPopups=[];initLevel();}

/* ── Movement ── */
function tryMove(dx,dy){
  if(dead||levelComplete)return;
  const nx=px+dx,ny=py+dy;
  if(nx<0||nx>=COLS||ny<0||ny>=ROWS||grid[ny][nx]===WALL)return;
  px=nx;py=ny;
  const tile=grid[ny][nx],now=performance.now();

  if(isGem(tile)){
    grid[ny][nx]=EMPTY;
    if(nextBurn&&nextBurn.x===nx&&nextBurn.y===ny)pickNextBurn();
    collected++;
    /* Combo */
    if(lastPickupTime&&now-lastPickupTime<COMBO_WINDOW)combo++;else combo=1;
    lastPickupTime=now;
    const pts=10*combo;score+=pts;
    if(combo>1)addPopup(`x${combo} +${pts}`,nx*T+T/2,ny*T);
    /* Specials */
    if(tile===ICE_GEM){
      fireFrozen=true;freezeEndTime=now+5000;
      addPopup('❄️ FREEZE!',nx*T+T/2,ny*T-T*0.3,'#67e8f9');
    }else if(tile===TIME_GEM){
      fireSlowed=true;slowEndTime=now+8000;
      addPopup('⏳ SLOW!',nx*T+T/2,ny*T-T*0.3,'#fde68a');
    }else if(tile===BOMB_GEM){
      let ext=0;
      for(let by=ny-1;by<=ny+1;by++)for(let bx=nx-1;bx<=nx+1;bx++)
        if(by>=0&&by<ROWS&&bx>=0&&bx<COLS&&grid[by][bx]===FIRE){grid[by][bx]=EMPTY;fireAge.delete(`${bx},${by}`);ext++;}
      addPopup(`💥 -${ext}🔥`,nx*T+T/2,ny*T-T*0.3,'#f87171');
    }
    if(collected>=NEED&&!doorOpen){
      doorOpen=true;
      document.getElementById('msg').textContent='The door is open! Find it!';
      setTimeout(()=>{if(!dead&&!levelComplete)document.getElementById('msg').textContent='';},2500);
    }
    updHUD();
  }else if(tile===FIRE){
    dead=true;if(fireTimerId)clearTimeout(fireTimerId);if(extinguishTimerId)clearTimeout(extinguishTimerId);
    document.getElementById('msg').textContent='You burned! Game over.';
    document.getElementById('rb').style.display='block';
  }else if(doorOpen&&nx===DX&&ny===DY){
    levelComplete=true;levelCompleteTime=performance.now();
    if(fireTimerId)clearTimeout(fireTimerId);if(extinguishTimerId)clearTimeout(extinguishTimerId);
    const bonus=50*level;score+=bonus;
    document.getElementById('msg').textContent=`Level ${level} complete! +${bonus} bonus`;
    updHUD();
    setTimeout(()=>{level++;initLevel();},2000);
  }
}

/* ══════════════════════ Drawing ══════════════════════ */

function drawFloor(x,y){
  const bx=x*T,by=y*T;
  ctx.fillStyle='#111827';ctx.fillRect(bx,by,T,T);
  ctx.strokeStyle='rgba(148,163,184,0.04)';ctx.lineWidth=0.5;
  ctx.strokeRect(bx+.25,by+.25,T-.5,T-.5);
}

function drawWall(x,y){
  const bx=x*T,by=y*T;
  const grd=ctx.createLinearGradient(bx,by,bx,by+T);
  grd.addColorStop(0,'#1e293b');grd.addColorStop(0.5,'#1a2332');grd.addColorStop(1,'#0f172a');
  ctx.fillStyle=grd;ctx.fillRect(bx,by,T,T);
  ctx.fillStyle='rgba(148,163,184,0.08)';ctx.fillRect(bx,by,T,Math.max(2,T/10));
  ctx.fillStyle='rgba(0,0,0,0.25)';ctx.fillRect(bx,by+T-Math.max(2,T/12),T,Math.max(2,T/12));
  ctx.strokeStyle='rgba(148,163,184,0.05)';ctx.lineWidth=0.5;ctx.strokeRect(bx+0.5,by+0.5,T-1,T-1);
}

function drawGem(x,y,t,type){
  const isDoomed=nextBurn&&nextBurn.x===x&&nextBurn.y===y;
  const cx=x*T+T/2,cy=y*T+T/2,hs=T*0.22;
  const special=type!==GEM;
  const pulse=special?(0.92+0.08*Math.sin(t*0.006)):1;
  const phs=hs*pulse;

  ctx.save();
  ctx.translate(cx,cy);
  ctx.rotate(Math.PI/4+Math.sin(t*0.002)*0.1);

  if(isDoomed){
    const elapsed=t-burnStartTime;
    const w=0.5+0.5*Math.sin(elapsed*(0.007+0.004*(elapsed/baseFireMs))*2*Math.PI/1000);
    ctx.shadowColor=`rgba(255,${0|100*(1-w)},0,0.6)`;ctx.shadowBlur=T*0.4;
    ctx.fillStyle=`rgb(255,${0|120*(1-w)},${0|30*(1-w)})`;
    ctx.fillRect(-phs,-phs,phs*2,phs*2);
    ctx.shadowBlur=0;
    ctx.fillStyle=`rgba(255,200,${0|80*(1-w)},0.5)`;
    ctx.fillRect(-phs,-phs,phs*0.5,phs*0.5);
  }else{
    let c1,c2,c3,glow;
    switch(type){
      case ICE_GEM:c1='#67e8f9';c2='#a5f3fc';c3='#22d3ee';glow='rgba(103,232,249,0.6)';break;
      case TIME_GEM:c1='#fbbf24';c2='#fde68a';c3='#f59e0b';glow='rgba(251,191,36,0.6)';break;
      case BOMB_GEM:c1='#f87171';c2='#fca5a5';c3='#ef4444';glow='rgba(248,113,113,0.6)';break;
      default:c1='#60a5fa';c2='#38bdf8';c3='#818cf8';glow='rgba(96,165,250,0.4)';
    }
    ctx.shadowColor=glow;
    ctx.shadowBlur=T*(special?0.5+0.15*Math.sin(t*0.006):0.35);
    const g=ctx.createLinearGradient(-phs,-phs,phs,phs);
    g.addColorStop(0,c1);g.addColorStop(0.5,c2);g.addColorStop(1,c3);
    ctx.fillStyle=g;ctx.fillRect(-phs,-phs,phs*2,phs*2);
    ctx.shadowBlur=0;
    ctx.fillStyle='rgba(255,255,255,0.5)';ctx.fillRect(-phs,-phs,phs*0.5,phs*0.5);
    ctx.fillStyle='rgba(0,0,0,0.25)';ctx.fillRect(phs*0.44,phs*0.44,phs*0.56,phs*0.56);
  }
  ctx.restore();

  /* Emoji icon for special gems */
  if(special&&!isDoomed){
    ctx.save();
    ctx.font=`${Math.max(8,T*0.28)}px sans-serif`;
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(type===ICE_GEM?'❄️':type===TIME_GEM?'⏳':'💥',cx,cy);
    ctx.restore();
  }

  /* Doomed fire indicator above gem */
  if(isDoomed){
    const pct=Math.min(1,(t-burnStartTime)/baseFireMs);
    ctx.fillStyle=`rgba(255,80,0,${pct*0.7})`;
    ctx.beginPath();ctx.arc(cx,cy-T*0.32-pct*T*0.1,(2+pct*2)*T/40*1.5,0,Math.PI*2);ctx.fill();
  }
}

function drawFire(x,y,t){
  const bx=x*T,by=y*T,h=T,w=T;
  const s=(seed)=>0.5+0.5*Math.sin(t*.01+seed);
  const f1=s(x*2.1+y*1.7),f2=s(x*1.5+y*2.3+1.5),f3=s(x*1.9+y*1.2+3.0);
  ctx.save();
  ctx.shadowColor='rgba(239,68,68,0.3)';ctx.shadowBlur=T*0.5;
  ctx.fillStyle='#1c0a0a';ctx.fillRect(bx+w*.075,by+h*.825,w*.85,h*.175);
  ctx.shadowBlur=0;ctx.restore();
  ctx.beginPath();ctx.moveTo(bx+w*.1,by+h*.95);ctx.quadraticCurveTo(bx+w*.05+f1*w*.075,by+h*.5+f1*h*.1,bx+w*.35,by+h*.3+f1*h*.15);ctx.quadraticCurveTo(bx+w*.5,by+h*.5,bx+w*.42,by+h*.95);ctx.closePath();ctx.fillStyle='#991b1b';ctx.fill();
  ctx.beginPath();ctx.moveTo(bx+w*.58,by+h*.95);ctx.quadraticCurveTo(bx+w*.95+f3*w*.05,by+h*.5+f3*h*.1,bx+w*.7,by+h*.3+f3*h*.15);ctx.quadraticCurveTo(bx+w*.5,by+h*.5,bx+w*.9,by+h*.95);ctx.closePath();ctx.fillStyle='#991b1b';ctx.fill();
  ctx.beginPath();ctx.moveTo(bx+w*.175,by+h*.95);ctx.quadraticCurveTo(bx+w*.125+f2*w*.05,by+h*.35+f2*h*.1,bx+w*.5,by+h*.12+f2*h*.2);ctx.quadraticCurveTo(bx+w*.875+f2*w*.05,by+h*.35+f2*h*.1,bx+w*.825,by+h*.95);ctx.closePath();ctx.fillStyle='#dc2626';ctx.fill();
  ctx.beginPath();ctx.moveTo(bx+w*.275,by+h*.95);ctx.quadraticCurveTo(bx+w*.225+f2*w*.05,by+h*.45+f2*h*.1,bx+w*.5,by+h*.3+f2*h*.2);ctx.quadraticCurveTo(bx+w*.775+f2*w*.05,by+h*.45+f2*h*.1,bx+w*.725,by+h*.95);ctx.closePath();ctx.fillStyle='#ef4444';ctx.fill();
  ctx.beginPath();ctx.moveTo(bx+w*.375,by+h*.95);ctx.quadraticCurveTo(bx+w*.5,by+h*.38+f2*h*.15,bx+w*.625,by+h*.95);ctx.closePath();ctx.fillStyle='#fbbf24';ctx.fill();
  ctx.beginPath();ctx.moveTo(bx+w*.44,by+h*.55+f2*h*.1);ctx.quadraticCurveTo(bx+w*.5,by+h*.28+f2*h*.15,bx+w*.56,by+h*.55+f2*h*.1);ctx.closePath();ctx.fillStyle='#fef3c7';ctx.fill();
}

function drawDoor(t){
  const bx=DX*T,by=DY*T,p=0.7+0.3*Math.sin(t*.004);
  ctx.save();
  ctx.shadowColor='rgba(52,211,153,0.4)';ctx.shadowBlur=T*0.5;
  ctx.fillStyle='#064e3b';ctx.fillRect(bx,by,T,T);
  ctx.shadowBlur=0;ctx.restore();
  const doorGrd=ctx.createLinearGradient(bx,by,bx+T,by+T);
  doorGrd.addColorStop(0,`rgba(16,${0|140+40*p},80,1)`);
  doorGrd.addColorStop(1,`rgba(5,${0|100+30*p},60,1)`);
  ctx.fillStyle=doorGrd;ctx.fillRect(bx+T*.125,by+T*.125,T*.75,T*.875);
  ctx.fillStyle=`rgba(52,${0|200+55*p},140,1)`;ctx.fillRect(bx+T*.2,by+T*.2,T*.6,T*.7);
  ctx.fillStyle='#fbbf24';ctx.beginPath();ctx.arc(bx+T*.7,by+T*.5,T*.075,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle=`rgba(52,211,153,${0.3+0.15*p})`;ctx.lineWidth=2;ctx.strokeRect(bx+2,by+2,T-4,T-4);
}

function drawPlayer(){
  const cx=px*T+T/2,cy=py*T+T/2,r=T*0.34;
  ctx.save();
  ctx.shadowColor='rgba(251,191,36,0.5)';ctx.shadowBlur=T*0.35;
  const bGrd=ctx.createRadialGradient(cx-r*0.2,cy-r*0.15,0,cx,cy,r);
  bGrd.addColorStop(0,'#fde68a');bGrd.addColorStop(0.6,'#f59e0b');bGrd.addColorStop(1,'#d97706');
  ctx.fillStyle=bGrd;
  ctx.beginPath();ctx.arc(cx,cy+r*0.05,r,0,Math.PI*2);ctx.fill();
  ctx.shadowBlur=0;
  ctx.strokeStyle='#b45309';ctx.lineWidth=Math.max(1.5,T/24);ctx.stroke();
  ctx.fillStyle='#f59e0b';
  ctx.beginPath();ctx.moveTo(cx-r*0.75,cy-r*0.55);ctx.lineTo(cx-r*0.35,cy-r*1.15);ctx.lineTo(cx-r*0.05,cy-r*0.6);ctx.closePath();ctx.fill();
  ctx.strokeStyle='#b45309';ctx.lineWidth=Math.max(1,T/28);ctx.stroke();
  ctx.beginPath();ctx.moveTo(cx+r*0.75,cy-r*0.55);ctx.lineTo(cx+r*0.35,cy-r*1.15);ctx.lineTo(cx+r*0.05,cy-r*0.6);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.fillStyle='#fbbf24';
  ctx.beginPath();ctx.moveTo(cx-r*0.6,cy-r*0.58);ctx.lineTo(cx-r*0.37,cy-r*0.95);ctx.lineTo(cx-r*0.15,cy-r*0.62);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.moveTo(cx+r*0.6,cy-r*0.58);ctx.lineTo(cx+r*0.37,cy-r*0.95);ctx.lineTo(cx+r*0.15,cy-r*0.62);ctx.closePath();ctx.fill();
  const er=r*0.22;
  ctx.fillStyle='#fff';
  ctx.beginPath();ctx.ellipse(cx-r*0.3,cy-r*0.1,er,er*1.15,0,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.ellipse(cx+r*0.3,cy-r*0.1,er,er*1.15,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#1c1917';
  const pr=er*0.45;
  ctx.beginPath();ctx.ellipse(cx-r*0.3,cy-r*0.08,pr*0.45,pr*1.4,0,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.ellipse(cx+r*0.3,cy-r*0.08,pr*0.45,pr*1.4,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.85)';
  ctx.beginPath();ctx.arc(cx-r*0.25,cy-r*0.18,er*0.22,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.arc(cx+r*0.35,cy-r*0.18,er*0.22,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#f472b6';
  ctx.beginPath();ctx.moveTo(cx,cy+r*0.12);ctx.lineTo(cx-r*0.1,cy+r*0.22);ctx.lineTo(cx+r*0.1,cy+r*0.22);ctx.closePath();ctx.fill();
  ctx.strokeStyle='#92400e';ctx.lineWidth=Math.max(1,T/32);
  ctx.beginPath();ctx.arc(cx-r*0.08,cy+r*0.3,r*0.12,0,Math.PI*0.8);ctx.stroke();
  ctx.beginPath();ctx.arc(cx+r*0.08,cy+r*0.3,r*0.12,Math.PI*0.2,Math.PI);ctx.stroke();
  ctx.strokeStyle='#78716c';ctx.lineWidth=Math.max(0.8,T/40);
  ctx.beginPath();ctx.moveTo(cx-r*0.2,cy+r*0.18);ctx.lineTo(cx-r*1.05,cy+r*0.05);ctx.stroke();
  ctx.beginPath();ctx.moveTo(cx-r*0.2,cy+r*0.25);ctx.lineTo(cx-r*1.05,cy+r*0.3);ctx.stroke();
  ctx.beginPath();ctx.moveTo(cx+r*0.2,cy+r*0.18);ctx.lineTo(cx+r*1.05,cy+r*0.05);ctx.stroke();
  ctx.beginPath();ctx.moveTo(cx+r*0.2,cy+r*0.25);ctx.lineTo(cx+r*1.05,cy+r*0.3);ctx.stroke();
  ctx.restore();
}

/* ── Effects overlay (active powerups) ── */
function drawEffects(t){
  let items=[];
  if(fireFrozen&&t<freezeEndTime)items.push({icon:'❄️',sec:((freezeEndTime-t)/1000).toFixed(1),color:'#67e8f9'});
  if(fireSlowed&&t<slowEndTime)items.push({icon:'⏳',sec:((slowEndTime-t)/1000).toFixed(1),color:'#fbbf24'});
  if(!items.length)return;
  ctx.save();
  const fs=Math.max(11,T*0.32);
  ctx.font=`600 ${fs}px 'Inter',system-ui,sans-serif`;
  ctx.textAlign='right';ctx.textBaseline='top';
  let y=T*0.2;
  for(const it of items){
    const txt=`${it.icon} ${it.sec}s`;
    const w=ctx.measureText(txt).width+12;
    ctx.fillStyle='rgba(0,0,0,0.6)';
    ctx.fillRect(canvas.width-w-6,y-2,w+4,fs+6);
    ctx.fillStyle=it.color;
    ctx.fillText(txt,canvas.width-8,y);
    y+=fs+8;
  }
  ctx.restore();
}

/* ── Combo / powerup popups ── */
function drawPopups(t){
  comboPopups=comboPopups.filter(p=>t-p.start<p.dur);
  for(const p of comboPopups){
    const prog=(t-p.start)/p.dur;
    const alpha=Math.max(0,1-prog*1.2);
    const yOff=prog*T*1.5;
    ctx.save();
    ctx.globalAlpha=alpha;
    ctx.font=`700 ${Math.max(12,T*0.35)}px 'Orbitron','Inter',system-ui,sans-serif`;
    ctx.textAlign='center';
    ctx.shadowColor=p.color;ctx.shadowBlur=8;
    ctx.fillStyle=p.color;
    ctx.fillText(p.text,p.x,p.y-yOff);
    ctx.restore();
  }
}

/* ── Main loop ── */
function loop(t){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
    drawFloor(x,y);
    const tile=grid[y][x];
    if(tile===WALL)drawWall(x,y);
    else if(isGem(tile))drawGem(x,y,t,tile);
    else if(tile===FIRE)drawFire(x,y,t);
    if(doorOpen&&x===DX&&y===DY)drawDoor(t);
  }
  drawPlayer();
  drawEffects(t);
  drawPopups(t);

  if(dead){
    ctx.fillStyle='rgba(8,9,15,0.75)';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.save();
    const fSize=Math.max(16,T*.5);
    ctx.font=`700 ${fSize}px 'Orbitron','Inter',system-ui,sans-serif`;
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.shadowColor='rgba(239,68,68,0.6)';ctx.shadowBlur=20;ctx.fillStyle='#ef4444';
    ctx.fillText('You burned!',canvas.width/2,canvas.height/2-fSize*0.3);
    ctx.shadowBlur=0;
    ctx.font=`600 ${Math.max(12,T*.32)}px 'Inter',system-ui,sans-serif`;
    ctx.fillStyle='#fbbf24';
    ctx.fillText(`Score: ${score}  \u2022  Level ${level}`,canvas.width/2,canvas.height/2+fSize*0.6);
    ctx.font=`500 ${Math.max(11,T*.25)}px 'Inter',system-ui,sans-serif`;
    ctx.fillStyle='rgba(200,202,208,0.6)';
    ctx.fillText('Press Enter or tap New Game',canvas.width/2,canvas.height/2+fSize*1.3);
    ctx.restore();
    return;
  }

  if(levelComplete){
    const elapsed=t-levelCompleteTime;
    const alpha=Math.min(0.7,elapsed/500);
    ctx.fillStyle=`rgba(8,9,15,${alpha})`;ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.save();
    const fSize=Math.max(16,T*.45);
    ctx.font=`700 ${fSize}px 'Orbitron','Inter',system-ui,sans-serif`;
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.shadowColor='rgba(52,211,153,0.6)';ctx.shadowBlur=20;ctx.fillStyle='#34d399';
    ctx.fillText(`Level ${level} Complete!`,canvas.width/2,canvas.height/2);
    ctx.shadowBlur=0;
    ctx.restore();
  }

  rafId=requestAnimationFrame(loop);
}

/* ── Input ── */
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&dead){initGame();e.preventDefault();return;}
  if(dead||levelComplete)return;
  const m={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0],
    w:[0,-1],s:[0,1],a:[-1,0],d:[1,0],W:[0,-1],S:[0,1],A:[-1,0],D:[1,0]};
  if(m[e.key]){tryMove(...m[e.key]);e.preventDefault();}
});
function bindBtn(id,dx,dy){const btn=document.getElementById(id);let active=false;btn.addEventListener('touchstart',e=>{e.preventDefault();if(!active){active=true;tryMove(dx,dy);}},{passive:false});btn.addEventListener('touchend',()=>{active=false;},{passive:true});btn.addEventListener('click',()=>tryMove(dx,dy));}
bindBtn('btn-up',0,-1);bindBtn('btn-down',0,1);bindBtn('btn-left',-1,0);bindBtn('btn-right',1,0);
let ts=null;canvas.addEventListener('touchstart',e=>{ts={x:e.touches[0].clientX,y:e.touches[0].clientY};e.preventDefault();},{passive:false});canvas.addEventListener('touchend',e=>{if(!ts)return;const dx=e.changedTouches[0].clientX-ts.x,dy=e.changedTouches[0].clientY-ts.y;if(Math.max(Math.abs(dx),Math.abs(dy))>18)Math.abs(dx)>Math.abs(dy)?tryMove(dx>0?1:-1,0):tryMove(0,dy>0?1:-1);ts=null;e.preventDefault();},{passive:false});
let resizeTimer=null;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(dead||levelComplete)return;T=calcTile();canvas.width=COLS*T;canvas.height=ROWS*T;},100);});

initGame();
