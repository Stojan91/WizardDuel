/* === RYBY – MAIN.JS  (bardzo płynny, powolny ruch) =========== */
const BOAT = 64, NET_T = 15;
let socket = null, ctx, canvas;
let me = null, state = { fish: [], players: {} };
const nets = [];

/* docelowa pozycja kursora / palca */
let targetX = 0, targetY = 0;
/* współczynnik: ile % drogi pokonujemy w jednej klatce (0 – 1) */
const SPEED = 0.05;

/* ---- SPRITES ------------------------------------------------- */
const IMG = {};
['boat_st_peter.gif', 'fish', 'lake_background', 'net'].forEach(name => {
  const img = new Image();
  img.src = name.endsWith('.gif') ? `assets/${name}` : `assets/${name}.png`;
  IMG[name.replace(/\.(gif|png)$/, '')] = img;         // klucz bez rozszerzenia
});

const $ = sel => document.querySelector(sel);

/* ============================================================= */
window.addEventListener('load', () => {
  /* DOM ------------------------------------------------------- */
  const lobby = $('#lobby'), lobbyBtn = $('#lobby-btn');
  const roomIn = $('#room-input'), nameIn = $('#name-input'), join = $('#join-btn');
  const roomsUL = $('#rooms-list');
  const chatBox = $('#chat-container'), chatHdr = $('#chat-header'),
        chatBtn = $('#chat-btn'), toggleChat = $('#toggle-chat'),
        chatLog = $('#chat-log'), chatCtl = $('#chat-controls'),
        chatInp = $('#chat-input'), sendBtn = $('#send-chat');
  const scoreE = $('#score'), scoresBtn = $('#scores-btn'),
        scoresM = $('#scores-modal'), closeScores = $('#scores-close'), scoresL = $('#scores-list');
  canvas = $('#game'); ctx = canvas.getContext('2d');

  /* === CHAT ================================================== */
  const isMobile = () => window.matchMedia('(max-width:640px)').matches;
  const setIcon  = open => (toggleChat.textContent = open ? '⬇' : '⬆');
  const openChat = () => {
    if (isMobile()) { chatBox.classList.add('show'); chatBox.classList.remove('collapsed'); }
    else            { chatBox.classList.remove('hidden'); }
    setIcon(true);
  };
  const collapseChat = () => {
    if (isMobile()) { chatBox.classList.remove('show'); chatBox.classList.add('collapsed'); }
    else            { chatBox.classList.add('hidden'); }
    setIcon(false);
  };
  collapseChat();                        // start: zwinięty/ukryty
  chatHdr.onclick = chatBtn.onclick = () => {
    const open = isMobile() ? chatBox.classList.contains('show')
                            : !chatBox.classList.contains('hidden');
    open ? collapseChat() : openChat();
  };
  const addChat = (n, t) => {
    const ts = new Date().toLocaleTimeString();
    chatLog.insertAdjacentHTML('beforeend', `<div><strong>${n} (${ts})</strong>: ${t}</div>`);
    chatLog.scrollTop = chatLog.scrollHeight;
  };

  /* === LISTA POKOJÓW ========================================= */
  async function loadRooms() {
    try {
      const { rooms } = await (await fetch('/rooms')).json();
      roomsUL.innerHTML = rooms.map(n => `<li>${n}</li>`).join('');
    } catch { /* ignore */ }
  }
  setInterval(loadRooms, 5000); loadRooms();

  /* === WEBSOCKET ============================================= */
  join.onclick = () => {
    const room = roomIn.value.trim(), player = nameIn.value.trim();
    if (!room || !player) return alert('Podaj pokój i nick');
    me = player;
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);

    socket.onopen = () => {
      socket.send(JSON.stringify({ action: 'join', room, player_name: player }));
      lobby.dataset.open = 'false';
      openChat();
      chatCtl.style.display = 'flex';
      loadRooms();
    };
    socket.onerror = () => { alert('Błąd połączenia'); lobby.dataset.open = 'true'; };
    socket.onclose = () => { alert('Rozłączono'); lobby.dataset.open = 'true'; collapseChat(); loadRooms(); };

    socket.onmessage = ev => {
      const st = JSON.parse(ev.data);
      Object.entries(st.players).forEach(([n, p]) => {
        if (p.chat && p.chat.text !== state.players[n]?.chat?.text) addChat(n, p.chat.text);
      });
      state = st;
      scoreE.textContent = `Punkty: ${st.players[me]?.score || 0}`;
    };
  };

  lobbyBtn.onclick = () => { socket?.close(); lobby.dataset.open = 'true'; collapseChat(); loadRooms(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') lobbyBtn.onclick(); });

  /* === RUCH: ustawianie celu ================================= */
  const setTarget = (x, y) => {
    const r = canvas.getBoundingClientRect();
    targetX = x - r.left;
    targetY = y - r.top;
  };
  canvas.onmousemove   = e => setTarget(e.clientX, e.clientY);
  canvas.ontouchmove   = e => { e.preventDefault(); const t = e.touches[0]; setTarget(t.clientX, t.clientY); };

  /* === ŁAPANIE RYB =========================================== */
  const tryCatch = () => {
    const p = state.players[me]; if (!p) return;
    state.fish.forEach(f => {
      if (f.x < p.x + BOAT && f.x + f.size > p.x && f.y < p.y + BOAT && f.y + f.size > p.y)
        nets.push({ x: f.x + f.size / 2, y: f.y + f.size / 2, size: f.size, t: NET_T });
    });
    socket?.readyState === 1 && socket.send(JSON.stringify({ action: 'catch' }));
  };
  canvas.onclick      = tryCatch;
  canvas.ontouchstart = e => { e.preventDefault(); tryCatch(); };

  /* === CHAT: wysyłanie ======================================= */
  const sendChat = () => {
    const txt = chatInp.value.trim();
    if (!txt) return;
    socket?.send(JSON.stringify({ action: 'chat', text: txt }));
    chatInp.value = '';
  };
  sendBtn.onclick = sendChat;
  chatInp.onkeydown = e => { if (e.key === 'Enter') sendChat(); };

  /* === RANKING =============================================== */
  scoresBtn.onclick = () => {
    scoresL.innerHTML = Object.entries(state.players)
      .map(([n, p]) => ({ n, s: p.score }))
      .sort((a, b) => b.s - a.s)
      .map(u => `<li>${u.n}: ${u.s}</li>`).join('');
    scoresM.classList.add('show');
  };
  closeScores.onclick = () => scoresM.classList.remove('show');

  /* === PĘTLA RENDER + LERP =================================== */
  function render() {
    const p = state.players[me];
    if (p) {
      const dx = targetX - p.x, dy = targetY - p.y;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        p.x += dx * SPEED;
        p.y += dy * SPEED;
        socket?.readyState === 1 &&
          socket.send(JSON.stringify({ action: 'move', x: Math.round(p.x), y: Math.round(p.y) }));
      }
    }
    draw(state);
    requestAnimationFrame(render);
  }
  render();
});

/* === RYSOWANIE =============================================== */
function draw(st) {
  if (IMG.lake_background.complete)
    ctx.drawImage(IMG.lake_background, 0, 0, canvas.width, canvas.height);
  else ctx.clearRect(0, 0, canvas.width, canvas.height);

  /* ryby */
  st.fish.forEach(f => {
    if (IMG.fish.complete) ctx.drawImage(IMG.fish, f.x, f.y, f.size, f.size);
  });

  /* animacja siatek */
  for (let i = nets.length - 1; i >= 0; i--) {
    const n = nets[i]; n.t--;
    if (IMG.net.complete) ctx.drawImage(IMG.net, n.x - n.size / 2, n.y - n.size / 2, n.size, n.size);
    if (n.t <= 0) nets.splice(i, 1);
  }

  /* gracze + dymki */
  ctx.textAlign = 'center';
  ctx.font = '16px sans-serif';
  Object.entries(st.players).forEach(([nick, p]) => {
    if (IMG.boat_st_peter.complete) ctx.drawImage(IMG.boat_st_peter, p.x, p.y, BOAT, BOAT);
    ctx.fillStyle = '#fff';
    ctx.fillText(nick, p.x + BOAT / 2, p.y - 10);

    if (p.chat) {
      const pad = 6, txt = p.chat.text;
      ctx.font = '14px sans-serif';
      const w = ctx.measureText(txt).width, h = 20,
            bx = p.x + BOAT / 2 - w / 2 - pad, by = p.y - h - 22;
      ctx.fillStyle = 'rgba(0,0,0,.7)';
      ctx.fillRect(bx, by, w + pad * 2, h);
      ctx.fillStyle = '#fff';
      ctx.fillText(txt, p.x + BOAT / 2, by + h / 2 + 5);
    }
  });
}
