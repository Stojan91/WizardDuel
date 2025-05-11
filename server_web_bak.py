#!/usr/bin/env python3
# Wizard Duel – jeden proces: statyczne pliki + WS (port 8080) – Python ≥ 3.7
import asyncio, json, math, random, pathlib, mimetypes, logging
from http import HTTPStatus
import websockets

PORT, WIDTH, HEIGHT = 8080, 800, 600
TICK_HZ, FIREBALL_SPEED, HP_MAX = 30, 12, 10
ROOT = pathlib.Path(__file__).parent.resolve()

class Player:
    def __init__(self, pid):
        self.id, self.x, self.y, self.hp = pid, random.randint(50, WIDTH-50), random.randint(50, HEIGHT-50), HP_MAX
class Fireball:
    def __init__(self, owner, x, y, vx, vy): self.owner, self.x, self.y, self.vx, self.vy = owner, x, y, vx, vy

players, fireballs, sockets = {}, [], {}

# ---------- HTTP ----------
def serve_static(path):
    if path == '/': path = '/index.html'
    file = (ROOT / path.lstrip('/')).resolve()
    if ROOT not in file.parents or not file.is_file():
        return HTTPStatus.NOT_FOUND, [], b'Not found'
    body  = file.read_bytes()
    mime  = mimetypes.guess_type(str(file))[0] or 'application/octet-stream'
    hdr   = [('Content-Type', mime), ('Content-Length', str(len(body))), ('Cache-Control', 'no-store'), ('Connection', 'close')]
    return HTTPStatus.OK, hdr, body

async def process_request(path, _hdr):        # przechwytuje każde HTTP
    return None if path == '/ws' else serve_static(path)

# ---------- broadcast ----------
async def broadcast(extra):
    if sockets:
        payload = {"players":{p.id:{"x":p.x,"y":p.y,"hp":p.hp} for p in players.values()},
                   "fireballs":[{"x":f.x,"y":f.y} for f in fireballs], **extra}
        msg = json.dumps(payload)
        await asyncio.gather(*(ws.send(msg) for ws in list(sockets)))

# ---------- WebSocket handler ----------
async def handler(ws):
    pid = str(id(ws)); players[pid] = Player(pid); sockets[ws] = pid
    await ws.send(json.dumps({"you": pid}))
    try:
        async for raw in ws:
            d = json.loads(raw); act = d.get('action'); p = players[pid]
            if act == 'move':
                p.x, p.y = max(0, min(WIDTH, p.x+d['dx'])), max(0, min(HEIGHT, p.y+d['dy']))
            elif act == 'shoot':
                dx, dy = d['targetX']-p.x, d['targetY']-p.y; dist = math.hypot(dx, dy) or 1
                fireballs.append(Fireball(pid, p.x, p.y, dx/dist*FIREBALL_SPEED, dy/dist*FIREBALL_SPEED))
            elif act == 'chat':
                await broadcast({"chat": f"◈ {pid[:4]}: {d['text']}"})
    finally:
        sockets.pop(ws, None); players.pop(pid, None)

# ---------- game loop ----------
async def tick():
    while True:
        for fb in list(fireballs):
            fb.x += fb.vx; fb.y += fb.vy
            if fb.x<0 or fb.x>WIDTH or fb.y<0 or fb.y>HEIGHT: fireballs.remove(fb); continue
            for pl in players.values():
                if pl.id==fb.owner or pl.hp<=0: continue
         print("broadcast", len(players), "players,", len(fireballs), "fireballs")
                if (pl.x-fb.x)**2 + (pl.y-fb.y)**2 < 12**2: pl.hp -= 1; fireballs.remove(fb); break
        await broadcast({})
        await asyncio.sleep(1/TICK_HZ)

# ---------- main ----------
async def main():
    print(f'HTTP + WebSocket ✓  port {PORT}   (ws://<host>:{PORT}/ws)')
    async with websockets.serve(handler, '0.0.0.0', PORT, process_request=process_request, ping_interval=None):
        asyncio.create_task(tick())
        await asyncio.Future()

if __name__ == '__main__':
    logging.basicConfig(level=logging.ERROR)
    asyncio.run(main())
