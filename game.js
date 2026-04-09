/* ── Diamond Dash – game.js ── */

/* Tile types */
const EMPTY=0,WALL=1,GEM=2,FIRE=3,ICE_GEM=4,TIME_GEM=5,BOMB_GEM=6;
const SPECIAL_CHANCE=0.18,COMBO_WINDOW=1500,FIRE_LIFE_MIN=2500,FIRE_LIFE_MAX=6000,GEM_RESPAWN_MIN=2000,GEM_RESPAWN_MAX=4500;

const canvas=document.getElementById('canvas');
const ctx=canvas.getContext('2d');

/* State */
let level,COLS,ROWS,NEED,DX,DY,T=40;
let grid,px,py,collected,doorOpen,dead,score;
let rafId,fireTimerId,nextBurn,burnStartTime,baseFireMs;
let combo,lastPickupTime,comboPopups;
let fireFrozen,freezeEndTime,fireSlowed,slowEndTime;
let levelComplete,levelCompleteTime;
let fireAge; /* Map "x,y" → expiry timestamp */
let burnedGems; /* Map "x,y" → respawn timestamp */
let extinguishTimerId;
let facingDir,lastMoveTime; /* direction: 1=right,-1=left,0=front; idle tracking */

/* ── Level config ── */
function lvlCfg(l){
  const s=Math.min(7+(l-1)*2,13);
  return{cols:s,rows:s,
    fireMs:Math.max(800,3000-(l-1)*350),
    need:Math.min(3+l*2,15),
    iFire:Math.min(3+l*2,15),
    iGem:Math.min(6+l*3,25)};
}

/* ── Particles ── */
let particles=[];
function spawnParticles(cx,cy,color,count){
  for(let i=0;i<count;i++){
    const angle=Math.random()*Math.PI*2;
    const speed=1.5+Math.random()*3;
    particles.push({
      x:cx,y:cy,
      vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,
      life:1,decay:0.015+Math.random()*0.015,
      size:2+Math.random()*3,
      color:color
    });
  }
}
function updateAndDrawParticles(){
  particles=particles.filter(p=>p.life>0);
  for(const p of particles){
    p.x+=p.vx;p.y+=p.vy;p.vy+=0.08;p.life-=p.decay;
    if(p.life<=0)continue;
    const r=Math.max(0,p.size*p.life);
    if(r<0.1)continue;
    ctx.save();
    ctx.globalAlpha=Math.max(0,Math.min(1,p.life));
    ctx.fillStyle=p.color;
    ctx.shadowColor=p.color;ctx.shadowBlur=6;
    ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();
    ctx.restore();
  }
}

/* ── Screen shake ── */
function triggerShake(){
  const wrap=document.getElementById('canvas-wrap');
  wrap.classList.remove('shake');
  void wrap.offsetWidth; /* reflow to re-trigger */
  wrap.classList.add('shake');
  setTimeout(()=>wrap.classList.remove('shake'),500);
}

/* ── Confetti on level complete (loaded async) ── */
(function(){var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js';s.async=true;document.head.appendChild(s);})();
function triggerConfetti(){
  if(typeof confetti!=='function')return;
  try{
    const canvasRect=document.getElementById('canvas').getBoundingClientRect();
    const cx=(canvasRect.left+canvasRect.right)/2/window.innerWidth;
    const cy=(canvasRect.top+canvasRect.bottom)/2/window.innerHeight;
    confetti({particleCount:80,spread:70,origin:{x:cx,y:cy},colors:['#34d399','#60a5fa','#a78bfa','#fbbf24'],gravity:0.8});
    setTimeout(()=>confetti({particleCount:50,spread:90,origin:{x:cx,y:cy},colors:['#34d399','#67e8f9','#fde68a'],gravity:0.7}),300);
  }catch(e){}
}

/* ── HUD pop animation ── */
function popHudCard(id){
  const el=document.getElementById(id);
  if(!el)return;
  const card=el.closest('.hud-card');
  if(!card)return;
  card.classList.remove('pop');
  void card.offsetWidth;
  card.classList.add('pop');
}

/* ── Helpers ── */
function calcTile(){
  /* Desktop: fit to viewport height; Mobile: fit to width */
  const isMobile=window.innerWidth<=768;
  if(isMobile){
    return Math.max(26,Math.floor(Math.min(window.innerWidth-24,540)/COLS));
  }
  const maxH=window.innerHeight-60;
  const maxW=window.innerWidth-340; /* leave room for sidebar */
  const tH=Math.floor(maxH/ROWS);
  const tW=Math.floor(maxW/COLS);
  return Math.max(26,Math.min(tH,tW,60));
}
function resizeCanvas(){T=calcTile();canvas.width=COLS*T;canvas.height=ROWS*T;}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=0|Math.random()*(i+1);[a[i],a[j]]=[a[j],a[i]]}return a;}
function isGem(t){return t===GEM||t===ICE_GEM||t===TIME_GEM||t===BOMB_GEM;}
function gemCount(){let g=0;for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++)if(isGem(grid[y][x]))g++;return g;}

/* ══════════════════════ Maze generators ══════════════════════ */

/* BFS reachability check */
function isReachable(g,x1,y1,x2,y2){
  if(g[y1][x1]===WALL||g[y2][x2]===WALL)return false;
  const vis=new Set([`${x1},${y1}`]);
  const q=[[x1,y1]];
  while(q.length){
    const[x,y]=q.shift();
    if(x===x2&&y===y2)return true;
    for(const[dx,dy]of[[0,1],[0,-1],[1,0],[-1,0]]){
      const nx=x+dx,ny=y+dy,k=`${nx},${ny}`;
      if(nx>0&&nx<COLS-1&&ny>0&&ny<ROWS-1&&!vis.has(k)&&g[ny][nx]!==WALL){vis.add(k);q.push([nx,ny]);}
    }
  }
  return false;
}

/* Carve an L-shaped path to guarantee connectivity */
function carvePath(g,x1,y1,x2,y2){
  let x=x1,y=y1;
  while(x!==x2){if(g[y][x]===WALL)g[y][x]=EMPTY;x+=x<x2?1:-1;}
  while(y!==y2){if(g[y][x]===WALL)g[y][x]=EMPTY;y+=y<y2?1:-1;}
  g[y2][x2]=EMPTY;
}

/* Make base grid (border walls, empty inside) */
function baseGrid(){
  return Array.from({length:ROWS},(_,y)=>Array.from({length:COLS},(_,x)=>
    (x===0||x===COLS-1||y===0||y===ROWS-1)?WALL:EMPTY));
}

/* Ensure start/exit are open and connected */
function ensureConnected(g){
  g[1][1]=EMPTY;g[1][2]=EMPTY;g[2][1]=EMPTY;
  g[DY][DX]=EMPTY;
  if(g[DY-1][DX]===WALL&&g[DY][DX-1]===WALL)g[DY][DX-1]=EMPTY;
  if(!isReachable(g,1,1,DX,DY))carvePath(g,1,1,DX,DY);
  return g;
}

/* Type 0 — Pillars (original) */
function genPillars(){
  const g=baseGrid();
  for(let y=1;y<ROWS-1;y++)for(let x=1;x<COLS-1;x++)
    if(x%2===0&&y%2===0)g[y][x]=WALL;
  return ensureConnected(g);
}

/* Type 1 — DFS Maze (winding corridors) */
function genDFSMaze(){
  const g=Array.from({length:ROWS},(_,y)=>Array.from({length:COLS},(_,x)=>
    (x===0||x===COLS-1||y===0||y===ROWS-1)?WALL:WALL));
  const vis=new Set();
  const stack=[{x:1,y:1}];
  vis.add('1,1');g[1][1]=EMPTY;
  while(stack.length){
    const{x,y}=stack[stack.length-1];
    const dirs=shuffle([[0,-2],[0,2],[-2,0],[2,0]]);
    let moved=false;
    for(const[dx,dy]of dirs){
      const nx=x+dx,ny=y+dy;
      if(nx>0&&nx<COLS-1&&ny>0&&ny<ROWS-1&&!vis.has(`${nx},${ny}`)){
        vis.add(`${nx},${ny}`);
        g[y+dy/2][x+dx/2]=EMPTY;
        g[ny][nx]=EMPTY;
        stack.push({x:nx,y:ny});
        moved=true;break;
      }
    }
    if(!moved)stack.pop();
  }
  /* Open extra passages for more room to play */
  const extra=Math.floor(COLS*ROWS*0.04);
  for(let i=0;i<extra;i++){
    const x=1+((0|Math.random()*(COLS-2))/1|0);
    const y=1+((0|Math.random()*(ROWS-2))/1|0);
    if(g[y][x]===WALL)g[y][x]=EMPTY;
  }
  return ensureConnected(g);
}

/* Type 2 — Rooms & Corridors (dungeon) */
function genRooms(){
  const g=Array.from({length:ROWS},(_,y)=>Array.from({length:COLS},(_,x)=>
    (x===0||x===COLS-1||y===0||y===ROWS-1)?WALL:WALL));
  const rooms=[];
  const numRooms=3+Math.min(2,Math.floor(COLS/4));
  for(let attempt=0;attempt<numRooms*20&&rooms.length<numRooms;attempt++){
    const rw=2+(0|Math.random()*Math.min(3,COLS/3));
    const rh=2+(0|Math.random()*Math.min(3,ROWS/3));
    const rx=1+(0|Math.random()*(COLS-2-rw));
    const ry=1+(0|Math.random()*(ROWS-2-rh));
    let overlap=false;
    for(const r of rooms)
      if(rx<r.x+r.w+1&&rx+rw+1>r.x&&ry<r.y+r.h+1&&ry+rh+1>r.y){overlap=true;break;}
    if(!overlap){
      rooms.push({x:rx,y:ry,w:rw,h:rh});
      for(let y=ry;y<ry+rh&&y<ROWS-1;y++)for(let x=rx;x<rx+rw&&x<COLS-1;x++)g[y][x]=EMPTY;
    }
  }
  /* Connect rooms with L-shaped corridors */
  const centers=rooms.map(r=>({x:r.x+(r.w>>1),y:r.y+(r.h>>1)}));
  centers.sort((a,b)=>(a.x+a.y)-(b.x+b.y));
  for(let i=0;i<centers.length-1;i++){
    const a=centers[i],b=centers[i+1];
    let x=a.x,y=a.y;
    while(x!==b.x){if(x>0&&x<COLS-1)g[y][x]=EMPTY;x+=x<b.x?1:-1;}
    while(y!==b.y){if(y>0&&y<ROWS-1)g[y][x]=EMPTY;y+=y<b.y?1:-1;}
  }
  return ensureConnected(g);
}

/* Type 3 — Open arena with scattered wall clusters */
function genOpenScatter(){
  const g=baseGrid();
  const clusters=2+Math.floor(COLS*ROWS*0.01);
  const safe=new Set(['1,1','2,1','1,2',`${DX},${DY}`,`${DX-1},${DY}`,`${DX},${DY-1}`]);
  for(let c=0;c<clusters;c++){
    const cx=2+(0|Math.random()*(COLS-4));
    const cy=2+(0|Math.random()*(ROWS-4));
    const size=1+(0|Math.random()*2);
    for(let dy=-size;dy<=size;dy++)for(let dx=-size;dx<=size;dx++){
      const x=cx+dx,y=cy+dy;
      if(x>0&&x<COLS-1&&y>0&&y<ROWS-1&&!safe.has(`${x},${y}`)&&Math.random()<0.7)
        g[y][x]=WALL;
    }
  }
  return ensureConnected(g);
}

/* Type 4 — Cross pattern with four quadrants */
function genCross(){
  const g=baseGrid();
  const mx=COLS>>1,my=ROWS>>1;
  /* Horizontal and vertical walls forming a cross */
  for(let x=1;x<COLS-1;x++)if(x!==mx-1&&x!==mx&&x!==mx+1)g[my][x]=WALL;
  for(let y=1;y<ROWS-1;y++)if(y!==my-1&&y!==my&&y!==my+1)g[y][mx]=WALL;
  /* One opening per quadrant wall */
  const openH=1+(0|Math.random()*(mx-2));
  const openH2=mx+2+(0|Math.random()*(COLS-mx-3));
  const openV=1+(0|Math.random()*(my-2));
  const openV2=my+2+(0|Math.random()*(ROWS-my-3));
  if(openH>0&&openH<COLS-1)g[my][openH]=EMPTY;
  if(openH2>0&&openH2<COLS-1)g[my][openH2]=EMPTY;
  if(openV>0&&openV<ROWS-1)g[openV][mx]=EMPTY;
  if(openV2>0&&openV2<ROWS-1)g[openV2][mx]=EMPTY;
  /* Add some pillars in each quadrant */
  for(let y=2;y<ROWS-2;y+=3)for(let x=2;x<COLS-2;x+=3)
    if(g[y][x]===EMPTY&&Math.random()<0.35)g[y][x]=WALL;
  return ensureConnected(g);
}

/* Type 5 — Diagonal stripes */
function genDiagonal(){
  const g=baseGrid();
  for(let y=1;y<ROWS-1;y++)for(let x=1;x<COLS-1;x++)
    if((x+y)%3===0)g[y][x]=WALL;
  /* Punch holes for playability */
  for(let y=1;y<ROWS-1;y++)for(let x=1;x<COLS-1;x++)
    if(g[y][x]===WALL&&Math.random()<0.3)g[y][x]=EMPTY;
  return ensureConnected(g);
}

const MAZE_TYPES=6;
function generateGrid(lvl){
  const type=(lvl-1)%MAZE_TYPES;
  switch(type){
    case 0:return genPillars();
    case 1:return genDFSMaze();
    case 2:return genRooms();
    case 3:return genOpenScatter();
    case 4:return genCross();
    case 5:return genDiagonal();
    default:return genPillars();
  }
}

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
  let changed=false;
  for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
    const key=`${x},${y}`;
    if(grid[y][x]===FIRE){
      const expire=fireAge.get(key);
      if(expire&&now>=expire){grid[y][x]=EMPTY;fireAge.delete(key);changed=true;}
    }
    /* respawn burned gems */
    if(grid[y][x]===EMPTY&&burnedGems.has(key)){
      if(now>=burnedGems.get(key)&&!(px===x&&py===y)){
        grid[y][x]=GEM;burnedGems.delete(key);changed=true;
      }
    }
  }
  if(changed){updHUD();pickNextBurn();}
  scheduleExtinguish();
}
function scheduleExtinguish(){if(extinguishTimerId)clearTimeout(extinguishTimerId);extinguishTimerId=setTimeout(extinguishOld,500);}

function burnOne(){
  if(dead||levelComplete)return;
  const now=performance.now();
  if(fireFrozen&&now<freezeEndTime){scheduleBurn();return;}
  if(now>=freezeEndTime)fireFrozen=false;
  if(now>=slowEndTime)fireSlowed=false;
  if(nextBurn&&isGem(grid[nextBurn.y][nextBurn.x])){
    setFire(nextBurn.x,nextBurn.y);
    const key=`${nextBurn.x},${nextBurn.y}`;
    const expire=fireAge.get(key);
    burnedGems.set(key,expire+GEM_RESPAWN_MIN+Math.random()*(GEM_RESPAWN_MAX-GEM_RESPAWN_MIN));
  }
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
  px=1;py=1;nextBurn=null;combo=1;lastPickupTime=0;facingDir=1;lastMoveTime=0;
  fireFrozen=false;fireSlowed=false;freezeEndTime=0;slowEndTime=0;
  comboPopups=[];particles=[];
  fireAge=new Map();
  burnedGems=new Map();

  grid=generateGrid(level);
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
  if(dx!==0)facingDir=dx; /* -1 left, 1 right */
  lastMoveTime=performance.now();
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
    /* Particle burst on gem collect */
    const pColors={[GEM]:'#60a5fa',[ICE_GEM]:'#67e8f9',[TIME_GEM]:'#fbbf24',[BOMB_GEM]:'#f87171'};
    spawnParticles(nx*T+T/2,ny*T+T/2,pColors[tile]||'#60a5fa',combo>1?18:10);
    popHudCard('sc');
    /* Specials */
    if(tile===ICE_GEM){
      fireFrozen=true;freezeEndTime=now+5000;
      addPopup('❄️ IMMUNE!',nx*T+T/2,ny*T-T*0.3,'#67e8f9');
    }else if(tile===TIME_GEM){
      fireSlowed=true;slowEndTime=now+8000;
      addPopup('⏳ SLOW!',nx*T+T/2,ny*T-T*0.3,'#fde68a');
    }else if(tile===BOMB_GEM){
      let ext=0;
      for(let by=ny-1;by<=ny+1;by++)for(let bx=nx-1;bx<=nx+1;bx++)
        if(by>=0&&by<ROWS&&bx>=0&&bx<COLS&&grid[by][bx]===FIRE){const bk=`${bx},${by}`;grid[by][bx]=EMPTY;fireAge.delete(bk);burnedGems.delete(bk);ext++;}
      addPopup(`💥 -${ext}🔥`,nx*T+T/2,ny*T-T*0.3,'#f87171');
      /* explosion particles */
      spawnParticles(nx*T+T/2,ny*T+T/2,'#ef4444',25);
    }
    if(collected>=NEED&&!doorOpen){
      doorOpen=true;
      document.getElementById('msg').textContent='The door is open! Find it!';
      setTimeout(()=>{if(!dead&&!levelComplete)document.getElementById('msg').textContent='';},2500);
    }
    updHUD();
  }else if(tile===FIRE){
    if(fireFrozen&&performance.now()<freezeEndTime){
      /* immune – walk through fire, extinguish it */
      grid[ny][nx]=EMPTY;fireAge.delete(`${nx},${ny}`);
      spawnParticles(nx*T+T/2,ny*T+T/2,'#67e8f9',12);
    }else{
    dead=true;if(fireTimerId)clearTimeout(fireTimerId);if(extinguishTimerId)clearTimeout(extinguishTimerId);
    document.getElementById('msg').textContent='You burned! Game over.';
    document.getElementById('rb').style.display='block';
    triggerShake();
    spawnParticles(nx*T+T/2,ny*T+T/2,'#ef4444',30);
    }
  }else if(doorOpen&&nx===DX&&ny===DY){
    levelComplete=true;levelCompleteTime=performance.now();
    if(fireTimerId)clearTimeout(fireTimerId);if(extinguishTimerId)clearTimeout(extinguishTimerId);
    const bonus=50*level;score+=bonus;
    document.getElementById('msg').textContent=`Level ${level} complete! +${bonus} bonus`;
    updHUD();popHudCard('sc');
    triggerConfetti();
    setTimeout(()=>{level++;initLevel();},2000);
  }
}

/* ══════════════════════ Drawing ══════════════════════ */

function drawFloor(x,y){
  const bx=x*T,by=y*T;
  /* checkerboard pixel-art floor */
  ctx.fillStyle=(x+y)%2===0?'#111827':'#0f1623';
  ctx.fillRect(bx,by,T,T);
  /* subtle corner dots */
  ctx.fillStyle='rgba(148,163,184,0.06)';
  const d=Math.max(1,T/20|0);
  ctx.fillRect(bx,by,d,d);
  ctx.fillRect(bx+T-d,by+T-d,d,d);
}

function drawWall(x,y){
  const bx=x*T,by=y*T;
  /* pixel-art brick wall */
  ctx.fillStyle='#1a2236';ctx.fillRect(bx,by,T,T);
  const bh=Math.max(2,T/4|0),mortar=Math.max(1,T/16|0);
  ctx.fillStyle='#0f1520';
  /* horizontal mortar lines */
  for(let r=0;r<4;r++){
    ctx.fillRect(bx,by+r*bh,T,mortar);
  }
  ctx.fillRect(bx,by+T-mortar,T,mortar);
  /* vertical mortar – offset every other row */
  const bw=T/2;
  for(let r=0;r<4;r++){
    const off=r%2===0?0:bw/2;
    for(let c=-1;c<3;c++){
      const mx=bx+off+c*bw;
      if(mx>=bx&&mx<bx+T) ctx.fillRect(mx,by+r*bh,mortar,bh);
    }
  }
  /* top highlight */
  ctx.fillStyle='rgba(148,163,184,0.07)';ctx.fillRect(bx,by,T,mortar);
  /* bottom shadow */
  ctx.fillStyle='rgba(0,0,0,0.3)';ctx.fillRect(bx,by+T-mortar,T,mortar);
}

function drawGem(x,y,t,type){
  const isDoomed=nextBurn&&nextBurn.x===x&&nextBurn.y===y;
  const cx=x*T+T/2,cy=y*T+T/2,hs=T*0.28;
  const special=type!==GEM;
  const pulse=special?(0.94+0.06*Math.sin(t*0.006)):1;
  const s=hs*pulse;

  /* pixel-art diamond: 4-point shape */
  ctx.save();
  ctx.translate(cx,cy);

  if(isDoomed){
    const elapsed=t-burnStartTime;
    const w=0.5+0.5*Math.sin(elapsed*(0.007+0.004*(elapsed/baseFireMs))*2*Math.PI/1000);
    ctx.shadowColor=`rgba(255,${0|100*(1-w)},0,0.6)`;ctx.shadowBlur=T*0.3;
    ctx.fillStyle=`rgb(255,${0|120*(1-w)},${0|30*(1-w)})`;
  }else{
    let cMain,cLight,cDark,glow;
    switch(type){
      case ICE_GEM:cMain='#67e8f9';cLight='#a5f3fc';cDark='#22b8d6';glow='rgba(103,232,249,0.5)';break;
      case TIME_GEM:cMain='#fbbf24';cLight='#fde68a';cDark='#d49a0c';glow='rgba(251,191,36,0.5)';break;
      case BOMB_GEM:cMain='#f87171';cLight='#fca5a5';cDark='#d33';glow='rgba(248,113,113,0.5)';break;
      default:cMain='#60a5fa';cLight='#93c5fd';cDark='#3b82f6';glow='rgba(96,165,250,0.35)';
    }
    ctx.shadowColor=glow;ctx.shadowBlur=T*(special?0.4:0.25);
    /* top-left facet (light) */
    ctx.fillStyle=cLight;
    ctx.beginPath();ctx.moveTo(0,-s);ctx.lineTo(-s,0);ctx.lineTo(0,0);ctx.closePath();ctx.fill();
    /* top-right facet (main) */
    ctx.fillStyle=cMain;
    ctx.beginPath();ctx.moveTo(0,-s);ctx.lineTo(s,0);ctx.lineTo(0,0);ctx.closePath();ctx.fill();
    /* bottom-left facet (main) */
    ctx.beginPath();ctx.moveTo(-s,0);ctx.lineTo(0,s);ctx.lineTo(0,0);ctx.closePath();ctx.fill();
    /* bottom-right facet (dark) */
    ctx.fillStyle=cDark;
    ctx.beginPath();ctx.moveTo(s,0);ctx.lineTo(0,s);ctx.lineTo(0,0);ctx.closePath();ctx.fill();
    ctx.shadowBlur=0;
    /* pixel highlight */
    const p=Math.max(1,T/16|0);
    ctx.fillStyle='rgba(255,255,255,0.6)';
    ctx.fillRect(-p*2,-s+p,p,p);
  }

  if(isDoomed){
    /* doomed: simple flashing diamond */
    ctx.beginPath();ctx.moveTo(0,-s);ctx.lineTo(s,0);ctx.lineTo(0,s);ctx.lineTo(-s,0);ctx.closePath();ctx.fill();
    ctx.shadowBlur=0;
  }
  ctx.restore();

  /* Emoji icon for special gems */
  if(special&&!isDoomed){
    ctx.save();
    ctx.font=`${Math.max(8,T*0.26)}px sans-serif`;
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(type===ICE_GEM?'❄️':type===TIME_GEM?'⏳':'💥',cx,cy);
    ctx.restore();
  }

  /* Doomed fire indicator above gem */
  if(isDoomed){
    const pct=Math.min(1,(t-burnStartTime)/baseFireMs);
    const ip=Math.max(1,T/12|0);
    ctx.fillStyle=`rgba(255,80,0,${pct*0.8})`;
    ctx.fillRect(cx-ip,cy-T*0.38-pct*T*0.08,ip*2,ip*2);
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
  const m=Math.max(1,T/16|0); /* pixel unit */
  ctx.save();
  ctx.shadowColor='rgba(52,211,153,0.3)';ctx.shadowBlur=T*0.3;
  /* frame */
  ctx.fillStyle='#064e3b';ctx.fillRect(bx,by,T,T);
  ctx.shadowBlur=0;ctx.restore();
  /* door panel */
  ctx.fillStyle=`rgb(12,${0|110+30*p},65)`;
  ctx.fillRect(bx+m*2,by+m*2,T-m*4,T-m*2);
  /* inner panel */
  ctx.fillStyle=`rgb(20,${0|150+40*p},90)`;
  ctx.fillRect(bx+m*3,by+m*3,T-m*6,T-m*4);
  /* pixel knob */
  ctx.fillStyle='#fbbf24';
  ctx.fillRect(bx+T-m*5,by+T/2-m,m*2,m*2);
  /* border */
  ctx.strokeStyle=`rgba(52,211,153,${0.3+0.2*p})`;ctx.lineWidth=m;
  ctx.strokeRect(bx+m/2,by+m/2,T-m,T-m);
}

function drawPlayer(t){
  const cx=px*T+T/2,cy=py*T+T/2;
  const u=T/16; /* unit for proportional drawing */
  const dir=facingDir||1; /* 1=right, -1=left */
  const idle=t-lastMoveTime>300; /* idle after 300ms */

  /* idle animation: gentle breathing bob */
  const breathe=idle?Math.sin(t*0.003)*u*0.6:0;
  const headTilt=idle?Math.sin(t*0.002)*0.04:0;

  ctx.save();
  ctx.translate(cx,cy+breathe);
  ctx.scale(dir,1); /* flip horizontally for direction */

  const lw=Math.max(1,u*0.5);
  ctx.lineCap='round';ctx.lineJoin='round';

  /* ── Shadow on ground ── */
  ctx.fillStyle='rgba(0,0,0,0.2)';
  ctx.beginPath();ctx.ellipse(0,u*7,u*3.5,u*0.8,0,0,Math.PI*2);ctx.fill();

  /* ── Legs ── */
  const legKick=idle?0:Math.sin(t*0.02)*u*0.8;
  ctx.strokeStyle='#5b4a3f';ctx.lineWidth=Math.max(2,u*1.2);
  /* left leg */
  ctx.beginPath();ctx.moveTo(-u*1.2,u*3.5);ctx.lineTo(-u*1.5,u*5.5+legKick);ctx.lineTo(-u*1.8,u*6.8);ctx.stroke();
  /* right leg */
  ctx.beginPath();ctx.moveTo(u*1.2,u*3.5);ctx.lineTo(u*1.5,u*5.5-legKick);ctx.lineTo(u*1.8,u*6.8);ctx.stroke();
  /* boots */
  ctx.fillStyle='#44403c';
  ctx.fillRect(-u*2.6,u*6.3+legKick,u*1.8,u*1);
  ctx.fillRect(u*0.8,u*6.3-legKick,u*1.8,u*1);

  /* ── Body / jacket ── */
  ctx.fillStyle='#92400e';
  ctx.beginPath();
  ctx.moveTo(-u*2.5,u*0.5);
  ctx.lineTo(u*2.5,u*0.5);
  ctx.lineTo(u*2.2,u*3.8);
  ctx.lineTo(-u*2.2,u*3.8);
  ctx.closePath();ctx.fill();
  ctx.strokeStyle='#78350f';ctx.lineWidth=lw;ctx.stroke();
  /* jacket center line */
  ctx.strokeStyle='#78350f';ctx.lineWidth=lw*0.7;
  ctx.beginPath();ctx.moveTo(0,u*0.8);ctx.lineTo(0,u*3.5);ctx.stroke();
  /* belt */
  ctx.fillStyle='#451a03';
  ctx.fillRect(-u*2.3,u*2.8,u*4.6,u*0.9);
  ctx.fillStyle='#fbbf24';
  ctx.fillRect(-u*0.5,u*2.85,u*1,u*0.7);

  /* ── Arms ── */
  const armSwing=idle?Math.sin(t*0.0025)*u*0.4:Math.sin(t*0.02)*u;
  ctx.strokeStyle='#92400e';ctx.lineWidth=Math.max(2,u*1.1);
  /* back arm */
  ctx.beginPath();ctx.moveTo(-u*2.3,u*1);ctx.lineTo(-u*3.5,u*2.5+armSwing);ctx.lineTo(-u*3.2,u*3.5+armSwing);ctx.stroke();
  /* front arm (holding whip side) */
  ctx.beginPath();ctx.moveTo(u*2.3,u*1);ctx.lineTo(u*3.5,u*2.2-armSwing);ctx.lineTo(u*3.8,u*3.2-armSwing);ctx.stroke();
  /* hands (skin) */
  ctx.fillStyle='#deb887';
  ctx.beginPath();ctx.arc(-u*3.2,u*3.5+armSwing,u*0.6,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.arc(u*3.8,u*3.2-armSwing,u*0.6,0,Math.PI*2);ctx.fill();

  /* ── Whip (coiled at side) ── */
  ctx.strokeStyle='#5b4a3f';ctx.lineWidth=Math.max(1,u*0.4);
  ctx.beginPath();
  ctx.moveTo(u*3.8,u*3.2-armSwing);
  ctx.quadraticCurveTo(u*4.5,u*4-armSwing,u*3.5,u*4.5);
  ctx.quadraticCurveTo(u*2.8,u*5,u*3.2,u*3.8);
  ctx.stroke();

  /* ── Head ── */
  ctx.save();
  ctx.rotate(headTilt);
  /* neck */
  ctx.fillStyle='#deb887';
  ctx.fillRect(-u*0.7,u*-0.8,u*1.4,u*1.5);
  /* head shape */
  ctx.fillStyle='#deb887';
  ctx.beginPath();ctx.ellipse(0,-u*2.5,u*2.3,u*2.2,0,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#c69c6d';ctx.lineWidth=lw*0.6;ctx.stroke();

  /* ── Fedora hat ── */
  ctx.fillStyle='#5b4a3f';
  /* brim */
  ctx.beginPath();
  ctx.ellipse(0,-u*4.2,u*3.8,u*0.9,0,0,Math.PI*2);
  ctx.fill();
  /* crown */
  ctx.beginPath();
  ctx.moveTo(-u*2.2,-u*4.2);
  ctx.quadraticCurveTo(-u*2.2,-u*7,0,-u*6.8);
  ctx.quadraticCurveTo(u*2.2,-u*7,u*2.2,-u*4.2);
  ctx.closePath();ctx.fill();
  /* hat band */
  ctx.fillStyle='#92400e';
  ctx.fillRect(-u*2.1,-u*4.8,u*4.2,u*0.7);
  /* hat highlight */
  ctx.fillStyle='rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(-u*1.5,-u*4.8);
  ctx.quadraticCurveTo(0,-u*6.5,u*1.5,-u*4.8);
  ctx.closePath();ctx.fill();

  /* ── Face ── */
  /* eye */
  const eyeX=u*0.8;
  const eyeY=-u*2.5;
  const blinkCycle=t%4000;
  const blinking=blinkCycle>3850&&blinkCycle<3950;
  ctx.fillStyle='#fff';
  ctx.beginPath();ctx.ellipse(eyeX,eyeY,u*0.9,blinking?u*0.15:u*0.85,0,0,Math.PI*2);ctx.fill();
  if(!blinking){
    ctx.fillStyle='#1c1917';
    ctx.beginPath();ctx.arc(eyeX+u*0.15,eyeY+u*0.05,u*0.45,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.9)';
    ctx.beginPath();ctx.arc(eyeX+u*0.35,eyeY-u*0.2,u*0.18,0,Math.PI*2);ctx.fill();
  }
  /* second eye (further, smaller — 3/4 view) */
  ctx.fillStyle='#fff';
  ctx.beginPath();ctx.ellipse(-u*0.8,eyeY,u*0.55,blinking?u*0.1:u*0.65,0,0,Math.PI*2);ctx.fill();
  if(!blinking){
    ctx.fillStyle='#1c1917';
    ctx.beginPath();ctx.arc(-u*0.65,eyeY+u*0.05,u*0.3,0,Math.PI*2);ctx.fill();
  }
  /* eyebrow */
  ctx.strokeStyle='#5b4a3f';ctx.lineWidth=Math.max(1,u*0.5);
  ctx.beginPath();ctx.moveTo(eyeX-u*0.8,eyeY-u*1.1);ctx.lineTo(eyeX+u*1,eyeY-u*1.3);ctx.stroke();
  /* nose */
  ctx.strokeStyle='#c69c6d';ctx.lineWidth=Math.max(1,u*0.4);
  ctx.beginPath();ctx.moveTo(u*0.6,-u*2);ctx.lineTo(u*1.2,-u*1.3);ctx.lineTo(u*0.5,-u*1.2);ctx.stroke();
  /* mouth / smirk */
  ctx.strokeStyle='#8b5e3c';ctx.lineWidth=Math.max(1,u*0.45);
  ctx.beginPath();ctx.moveTo(-u*0.2,-u*0.6);ctx.quadraticCurveTo(u*0.8,-u*0.3,u*1.2,-u*0.7);ctx.stroke();
  /* stubble dots */
  ctx.fillStyle='rgba(91,74,63,0.3)';
  for(let i=0;i<5;i++){
    ctx.beginPath();
    ctx.arc(u*(-0.2+Math.sin(i*2.3)*0.8),-u*(0.1+Math.cos(i*1.7)*0.3),u*0.15,0,Math.PI*2);
    ctx.fill();
  }

  ctx.restore(); /* head tilt */
  ctx.restore(); /* main transform */
}

/* ── Effects overlay (active powerups) ── */
function drawEffects(t){
  let items=[];
  if(fireFrozen&&t<freezeEndTime)items.push({icon:'❄️',sec:((freezeEndTime-t)/1000).toFixed(1),color:'#67e8f9'});
  if(fireSlowed&&t<slowEndTime)items.push({icon:'⏳',sec:((slowEndTime-t)/1000).toFixed(1),color:'#fbbf24'});
  if(!items.length)return;
  ctx.save();
  const fs=Math.max(11,T*0.32);
  ctx.font=`600 ${fs}px 'Press Start 2P',monospace`;
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
    ctx.font=`700 ${Math.max(12,T*0.35)}px 'Press Start 2P',monospace`;
    ctx.textAlign='center';
    ctx.shadowColor=p.color;ctx.shadowBlur=8;
    ctx.fillStyle=p.color;
    ctx.fillText(p.text,p.x,p.y-yOff);
    ctx.restore();
  }
}

/* ── Main loop ── */
function loop(t){
  try{
    ctx.clearRect(0,0,canvas.width,canvas.height);
    for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
      drawFloor(x,y);
      const tile=grid[y][x];
      if(tile===WALL)drawWall(x,y);
      else if(isGem(tile))drawGem(x,y,t,tile);
      else if(tile===FIRE)drawFire(x,y,t);
      if(doorOpen&&x===DX&&y===DY)drawDoor(t);
    }
    drawPlayer(t);
    drawEffects(t);
    drawPopups(t);
    updateAndDrawParticles();

    if(dead){
      ctx.fillStyle='rgba(8,9,15,0.75)';ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.save();
      const fSize=Math.max(16,T*.5);
      ctx.font=`700 ${fSize}px 'Press Start 2P',monospace`;
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.shadowColor='rgba(239,68,68,0.6)';ctx.shadowBlur=20;ctx.fillStyle='#ef4444';
      ctx.fillText('You burned!',canvas.width/2,canvas.height/2-fSize*0.3);
      ctx.shadowBlur=0;
      ctx.font=`600 ${Math.max(12,T*.32)}px 'Press Start 2P',monospace`;
      ctx.fillStyle='#fbbf24';
      ctx.fillText(`Score: ${score}  \u2022  Level ${level}`,canvas.width/2,canvas.height/2+fSize*0.6);
      ctx.font=`500 ${Math.max(11,T*.25)}px 'Press Start 2P',monospace`;
      ctx.fillStyle='rgba(200,202,208,0.6)';
      ctx.fillText('Press Enter or tap New Game',canvas.width/2,canvas.height/2+fSize*1.3);
      ctx.restore();
    }else if(levelComplete){
      const elapsed=t-levelCompleteTime;
      const alpha=Math.min(0.7,elapsed/500);
      ctx.fillStyle=`rgba(8,9,15,${alpha})`;ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.save();
      const fSize=Math.max(16,T*.45);
      ctx.font=`700 ${fSize}px 'Press Start 2P',monospace`;
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.shadowColor='rgba(52,211,153,0.6)';ctx.shadowBlur=20;ctx.fillStyle='#34d399';
      ctx.fillText(`Level ${level} Complete!`,canvas.width/2,canvas.height/2);
      ctx.shadowBlur=0;
      ctx.restore();
    }
  }catch(e){
    console.error('loop error:',e);
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
/* ── Nipplejs joystick (touch devices) ── */
(function(){
  const zone=document.getElementById('joystick-zone');
  const isTouchDevice='ontouchstart' in window||navigator.maxTouchPoints>0;
  if(!isTouchDevice||typeof nipplejs==='undefined'){return;}
  zone.style.display='block';
  /* build arrow overlay */
  const arrows=document.createElement('div');
  arrows.className='joy-arrows';
  ['up','down','left','right'].forEach(d=>{
    const a=document.createElement('div');
    a.className='joy-arrow a-'+d;
    a.dataset.dir=d;
    arrows.appendChild(a);
  });
  zone.appendChild(arrows);
  const arrowEls=Object.fromEntries(
    [...arrows.children].map(a=>[a.dataset.dir,a])
  );
  /* nipplejs – invisible, just for touch handling */
  const mgr=nipplejs.create({
    zone:zone,
    mode:'static',
    position:{left:'50%',top:'50%'},
    color:'transparent',
    size:130,
    restOpacity:0,
    fadeTime:0
  });
  let joyDir=null,joyInterval=null,curDelay=0,activeArrow=null;
  const dirMap={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]};
  function setActiveArrow(dir){
    if(activeArrow===dir) return;
    if(activeArrow) arrowEls[activeArrow].classList.remove('active');
    activeArrow=dir;
    if(dir) arrowEls[dir].classList.add('active');
  }
  function delayFromForce(f){
    if(f<0.35) return 180;
    if(f<0.65) return 95;
    return 55;
  }
  function startRepeat(dx,dy,delay){
    joyDir=[dx,dy];
    curDelay=delay;
    if(joyInterval) clearInterval(joyInterval);
    tryMove(dx,dy);
    joyInterval=setInterval(()=>{
      if(joyDir)tryMove(joyDir[0],joyDir[1]);
    },delay);
  }
  function stopRepeat(){
    joyDir=null;curDelay=0;
    if(joyInterval){clearInterval(joyInterval);joyInterval=null;}
    setActiveArrow(null);
  }
  mgr.on('move',function(evt,data){
    if(!data.direction) return;
    const dir=data.direction.angle;
    const d=dirMap[dir];
    if(!d) return;
    setActiveArrow(dir);
    const delay=delayFromForce(data.force);
    const dirChanged=!joyDir||d[0]!==joyDir[0]||d[1]!==joyDir[1];
    const speedChanged=Math.abs(delay-curDelay)>15;
    if(dirChanged||speedChanged){
      startRepeat(d[0],d[1],delay);
    }
  });
  mgr.on('end',function(){stopRepeat();});
})();
/* ── Swipe fallback on canvas ── */
let ts=null;canvas.addEventListener('touchstart',e=>{ts={x:e.touches[0].clientX,y:e.touches[0].clientY};e.preventDefault();},{passive:false});canvas.addEventListener('touchend',e=>{if(!ts)return;const dx=e.changedTouches[0].clientX-ts.x,dy=e.changedTouches[0].clientY-ts.y;if(Math.max(Math.abs(dx),Math.abs(dy))>18)Math.abs(dx)>Math.abs(dy)?tryMove(dx>0?1:-1,0):tryMove(0,dy>0?1:-1);ts=null;e.preventDefault();},{passive:false});
let resizeTimer=null;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(dead||levelComplete)return;T=calcTile();canvas.width=COLS*T;canvas.height=ROWS*T;},100);});

initGame();
