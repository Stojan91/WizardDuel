/* =======================================================================
 * Wizard Duel – klient
 * • fantasy corridors w kolorze + maska czarnych ścian
 * • unikalny, wymagany nick
 * • drag&amp;move + dblclick/tap → fireball
 * • czat + HUD (nick, HP, dymki)
 * • heartbeat co 30 s, AFK‐kick po 60 s
 * ===================================================================== */

const cvs       = document.getElementById("game");
cvs.setAttribute("tabindex","-1");
const ctx       = cvs.getContext("2d");
const W = cvs.width, H = cvs.height;

const STEP      = 4,
      BALL_SPEED = 10,
      FIREBALL_R = 8;

const BUBBLE_MS = 4000,
      MAX_HP    = 5;

const NAME_OFF  = 36,
      HP_OFF    = 24;

// obrazy
const imgMap    = new Image(); imgMap.src    = "assets/mapa.png";
const imgFx     = new Image(); imgFx.src     = "assets/mapa_fantasy.png";
const imgYou    = new Image(); imgYou.src    = "assets/wizard_white.png";
const imgOther  = new Image(); imgOther.src  = "assets/wizard_black.png";
const imgBall   = new Image(); imgBall.src   = "assets/fireball.png";

const IMAGES    = [imgMap,imgFx,imgYou,imgOther,imgBall];

/* ― DOM ― */
const log   = document.getElementById("log");
const form  = document.getElementById("msgBar");
const txt   = document.getElementById("msg");
const modal = document.getElementById("modal");
const nickI = document.getElementById("nick");
document.getElementById("go").onclick = join;

/* podczas wpisywania – canvas nie przechwytuje klików */
[nickI, txt].forEach(i=>{
  i.addEventListener("focus", () => cvs.style.pointerEvents="none");
  i.addEventListener("blur",  () => cvs.style.pointerEvents="auto");
});

/* ― stan gry ― */
let ws     = null,
    you    = null,
    nick   = null,
    state  = { players: {}, fireballs: [] };

/* ― czat ― */
form.addEventListener("submit", e=>{
  e.preventDefault();
  const m = txt.value.trim();
  if(m && ws) ws.send(JSON.stringify({ chat: m }));
  txt.value = "";
});
function addLog(who, text){
  const d = document.createElement("div");
  d.textContent = `${who}: ${text}`;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}

/* ― pomocnicze ― */
function canvasXY(ev){
  const r = cvs.getBoundingClientRect();
  return {
    x: Math.round((ev.clientX - r.left) * W / r.width),
    y: Math.round((ev.clientY - r.top)  * H / r.height)
  };
}
function dirTo(px, py){
  if(!you || !state.players[you]) return { dx:0, dy:-1 };
  const p = state.players[you];
  const dx = px - p.x, dy = py - p.y;
  const len = Math.hypot(dx,dy)||1;
  return { dx: dx/len, dy: dy/len };
}

/* ― sterowanie ― */
let dest=null, dragging=false, lastTap=0;

cvs.addEventListener("mousedown", e => { dragging=true; dest=canvasXY(e); });
cvs.addEventListener("mousemove", e => { if(dragging) dest=canvasXY(e); });
window.addEventListener("mouseup",    () => dragging=false);

cvs.addEventListener("touchstart", e => {
  const now = Date.now();
  if(now - lastTap < 300) shoot();
  lastTap = now;
  dragging=true; dest=canvasXY(e.touches[0]);
},{passive:false});
cvs.addEventListener("touchmove",  e => { if(dragging) dest=canvasXY(e.touches[0]); }, {passive:false});
window.addEventListener("touchend", () => dragging=false);

cvs.addEventListener("dblclick", shoot);
function shoot(){
  if(!you || !state.players[you]) return;
  const tgt = dest || { x: W/2, y: 0 };
  ws.send(JSON.stringify({ shoot: dirTo(tgt.x, tgt.y) }));
}

/* ― WebSocket + join ― */
let pingTimer = null;

function join(){
  if(ws) return;

  nick = nickI.value.trim();
  if(!nick){
    alert("Musisz podać nick!"); return;
  }

  // reset klienta
  you   = null;
  state = { players:{}, fireballs:[] };
  dest  = null;

  // przywróć od razu interakcję na canvas
  nickI.blur(); txt.blur();
  cvs.style.pointerEvents="auto";
  cvs.focus();

  const proto = location.protocol==="https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.addEventListener("open", () => {
    // wysyłamy nick + startujemy heartbeat
    ws.send(JSON.stringify({ nick }));
    pingTimer = setInterval(() => {
      if(ws.readyState === WebSocket.OPEN){
        ws.send(JSON.stringify({ ping: 1 }));
      }
    }, 30000);
  });

  ws.addEventListener("message", e => {
    const msg = JSON.parse(e.data);
    if(msg.error){
      alert(
        msg.error === "empty-nick"   ? "Musisz podać nick!" :
        msg.error === "nick-taken"   ? "Ten nick jest już zajęty." :
        "Błąd: "+msg.error
      );
      ws.close(); ws=null;
      clearInterval(pingTimer);
      modal.style.display="flex";
      return;
    }
    // normalne aktualizacje
    if(msg.you)       you            = msg.you;
    if(msg.players)   state.players  = msg.players;
    if(msg.fireballs) state.fireballs= msg.fireballs;
    if(msg.chat)      addLog(msg.chat.nick,msg.chat.text);
    if(msg.kick){
      alert("Wyrzucono: "+msg.kick);
      location.reload();
    }
  });

  ws.addEventListener("close", () => {
    clearInterval(pingTimer);
    if(ws){
      alert("Rozłączono z serwerem");
      location.reload();
    }
    ws = null;
  });

  // ukrycie modala
  modal.style.display="none";
}

/* ― pętla gry ― */
let lastSent = { x:0, y:0 };

function loop(){
  stepMove();
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function stepMove(){
  if(!dest || !you || !state.players[you]) return;
  const p = state.players[you];
  const dx = dest.x - p.x, dy = dest.y - p.y;
  const dist = Math.hypot(dx,dy);
  if(dist < 1) return;
  const step = Math.min(STEP, dist);
  const nx = p.x + dx/dist*step;
  const ny = p.y + dy/dist*step;
  const ix = Math.round(nx), iy = Math.round(ny);
  if(ix!==lastSent.x || iy!==lastSent.y){
    lastSent = { x:ix, y:iy };
    ws.send(JSON.stringify({ x:ix, y:iy }));
  }
}

/* ― render ― */
function draw(){
  // kolorowe korytarze
  if(imgFx.complete) ctx.drawImage(imgFx,0,0,W,H);
  else               ctx.drawImage(imgMap,0,0,W,H);
  // maskowanie czarnych ścian
  ctx.save();
  ctx.globalCompositeOperation="multiply";
  ctx.drawImage(imgMap,0,0,W,H);
  ctx.restore();

  // fireballe
  for(const b of state.fireballs){
    ctx.drawImage(imgBall,
      b.x-FIREBALL_R, b.y-FIREBALL_R,
      FIREBALL_R*2, FIREBALL_R*2
    );
  }

  // gracze + HUD
  const now = Date.now();
  for(const [id,p] of Object.entries(state.players)){
    ctx.drawImage(id===you?imgYou:imgOther, p.x-16,p.y-16,32,32);
    // nick outline
    ctx.font="bold 13px sans-serif"; ctx.textAlign="center";
    ctx.lineWidth=4; ctx.strokeStyle="#000"; ctx.strokeText(p.nick,p.x,p.y-NAME_OFF);
    ctx.fillStyle="#fff"; ctx.fillText(p.nick,p.x,p.y-NAME_OFF);
    // HP bar
    ctx.fillStyle="#000"; ctx.fillRect(p.x-16,p.y-HP_OFF,32,4);
    ctx.fillStyle="#0f0"; ctx.fillRect(p.x-16,p.y-HP_OFF,32*(p.hp/MAX_HP),4);
    // chat bubble
    if(p.say && now-p.say.time < BUBBLE_MS){
      const w = ctx.measureText(p.say.text).width + 12;
      ctx.fillStyle="#fff"; ctx.fillRect(p.x-w/2, p.y-NAME_OFF-20, w, 16);
      ctx.fillStyle="#000"; ctx.fillText(p.say.text, p.x, p.y-NAME_OFF-8);
    }
  }
}
