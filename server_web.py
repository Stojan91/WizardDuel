#!/usr/bin/env python3
# coding: utf-8
"""
Wizard Duel – serwer HTTP + WebSocket
• 6 px hit-box → węższe korytarze
• wymagany, unikalny nick
• AFK-kick after 60 s + ping support
• ignorowanie query-string (?fbclid…)
• HTTP router → zawsze index.html (żadnej strony ngrok)
"""
import asyncio, json, pathlib, random, time, websockets, mimetypes
from http import HTTPStatus
from urllib.parse import urlsplit
from PIL import Image
import numpy as np

ROOT        = pathlib.Path(__file__).parent
PORT        = int(os.getenv("PORT", 8080))  # Railway tu ustawia port
TICK       = 1/30
AFK_LIMIT  = 60
PLAYER_R   = 6
FIREBALL_R = 8
BALL_SPEED = 10
MAX_HP     = 5

# ── mapa + kolizje ─────────────────────────────────────────────────────────
MAP_IMG  = (Image.open(ROOT/"assets/mapa.png")
              .convert("L")
              .resize((800,600),Image.NEAREST))
PASSABLE = np.array(MAP_IMG) > 128

def passable(x:int,y:int,r:int=PLAYER_R)->bool:
    for dx,dy in [(0,0),(r,0),(-r,0),(0,r),(0,-r),(r,r),(-r,r),(r,-r),(-r,-r)]:
        ix,iy = int(x+dx), int(y+dy)
        if ix<0 or iy<0 or ix>=800 or iy>=600 or not PASSABLE[iy,ix]:
            return False
    return True

def random_xy():
    while True:
        x=random.randint(PLAYER_R,800-PLAYER_R)
        y=random.randint(PLAYER_R,600-PLAYER_R)
        if passable(x,y): return x,y

# ── stan gry ───────────────────────────────────────────────────────────────
players   = {}    # pid → Player
fireballs = []    # list of dict
clients   = {}    # ws → pid
nick_set  = set() # wszystkie nazwy

class Player:
    def __init__(self,pid,nick):
        self.id          = pid
        self.nick        = nick
        self.x,self.y    = random_xy()
        self.hp          = MAX_HP
        self.say         = None
        self.last_active = time.time()
    def as_dict(self):
        return {"x":self.x,"y":self.y,"hp":self.hp,
                "nick":self.nick,"say":self.say}
    def touch(self):
        self.last_active = time.time()

# ── WebSocket handler ─────────────────────────────────────────────────────
async def ws_handler(ws):
    pid = str(id(ws))
    try:
        hello = json.loads(await asyncio.wait_for(ws.recv(),10))
    except:
        await ws.close(); return

    nick = str(hello.get("nick","")).strip()
    if not nick:
        await ws.send(json.dumps({"error":"empty-nick"}))
        await ws.close(); return
    if nick in nick_set:
        await ws.send(json.dumps({"error":"nick-taken"}))
        await ws.close(); return

    p = Player(pid,nick)
    players[pid] = p
    clients[ws]  = pid
    nick_set.add(nick)

    await ws.send(json.dumps({"you":pid}))
    await broadcast()

    try:
        async for raw in ws:
            data = json.loads(raw)
            if "ping" in data:
                p.touch(); continue
            p.touch()

            if "x" in data and "y" in data:
                nx,ny = data["x"],data["y"]
                if passable(nx,ny): p.x,p.y = nx,ny

            if "shoot" in data:
                d = data["shoot"]
                dx,dy = float(d.get("dx",0)), float(d.get("dy",-1))
                n = (dx*dx+dy*dy)**0.5 or 1
                fireballs.append({
                    "x":p.x,"y":p.y,
                    "vx":BALL_SPEED*dx/n,"vy":BALL_SPEED*dy/n,
                    "owner":pid
                })

            if "chat" in data:
                txt = str(data["chat"])[:100]
                p.say = {"text":txt,"time":time.time()*1000}
                await chat_broadcast(p.nick,txt)
                await broadcast()

    except websockets.ConnectionClosed:
        pass
    finally:
        # cleanup
        _=players.pop(pid,None)
        nick_set.discard(nick)
        for w,uid in list(clients.items()):
            if uid==pid: clients.pop(w,None)

async def chat_broadcast(nick,text):
    msg = json.dumps({"chat":{"nick":nick,"text":text}})
    await asyncio.gather(*(w.send(msg) for w in clients))

async def broadcast():
    snap = json.dumps({
        "players": {pid:p.as_dict() for pid,p in players.items()},
        "fireballs": fireballs
    })
    await asyncio.gather(*(w.send(snap) for w in clients))

async def game_tick():
    while True:
        now = time.time()
        for pid,p in list(players.items()):
            if now - p.last_active > AFK_LIMIT:
                await kick(pid,"AFK")
        for fb in fireballs[:]:
            fb["x"] += fb["vx"]; fb["y"] += fb["vy"]
            out = (fb["x"]<-FIREBALL_R or fb["x"]>800+FIREBALL_R or
                   fb["y"]<-FIREBALL_R or fb["y"]>600+FIREBALL_R)
            if out or not passable(fb["x"],fb["y"],FIREBALL_R):
                fireballs.remove(fb); continue
            for p in list(players.values()):
                if p.id==fb["owner"]: continue
                if (fb["x"]-p.x)**2+(fb["y"]-p.y)**2 <= (PLAYER_R+FIREBALL_R)**2:
                    p.hp-=1; fireballs.remove(fb); p.touch()
                    if p.hp<=0: await kick(p.id,"DEAD")
                    break
        await broadcast()
        await asyncio.sleep(TICK)

async def kick(pid,reason=""):
    ws_list = [w for w,uid in clients.items() if uid==pid]
    if ws_list:
        try: await ws_list[0].send(json.dumps({"kick":reason}))
        finally: await ws_list[0].close()

# ── statyczne + router ───────────────────────────────────────────────────
mimetypes.add_type("application/javascript",".js")
mimetypes.add_type("text/css",".css")
async def serve_static(url_path:str):
    path = urlsplit(url_path).path or "/index.html"
    if path.endswith("/"): path+="index.html"
    fp = (ROOT/path.lstrip("/")).resolve()
    if not fp.exists() or ROOT not in fp.parents:
        fp = ROOT/"index.html"
    mime,_ = mimetypes.guess_type(fp.name)
    mime = (mime or "application/octet-stream")
    if mime.startswith("text/"): mime+="; charset=utf-8"
    body = fp.read_bytes()
    return (HTTPStatus.OK,
            [("Content-Type",mime),("Content-Length",str(len(body)))],
            body)

async def http_router(path,_):
    if path=="/ws": return
    return await serve_static(path)

async def main():
    async with websockets.serve(ws_handler,"0.0.0.0",PORT,
                                process_request=http_router,
                                ping_interval=None):
        print(f"→ http://localhost:{PORT}")
        asyncio.create_task(game_tick())
        await asyncio.Future()

if __name__=="__main__":
    try: asyncio.run(main())
    except KeyboardInterrupt: print("Server stopped.")
