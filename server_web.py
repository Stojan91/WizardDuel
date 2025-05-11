#!/usr/bin/env python3
import os, random, asyncio
from aiohttp import web, WSMsgType

HOST, PORT    = '0.0.0.0', 8080
WIDTH, HEIGHT = 800, 600
BOAT_SIZE     = 64
MIN_Y         = HEIGHT // 2 + 20          # łodzie i ryby w dolnej połowie
MAX_Y         = HEIGHT - BOAT_SIZE
FPS           = 60
CHAT_DUR      = FPS * 5

rooms = {}                                  # nazwa → Room()


class Room:
    def __init__(self):
        self.players, self.fish, self.sockets = {}, [], set()
        self.respawn_fish()

    def respawn_fish(self):
        self.fish = []
        for _ in range(5):
            size = random.choice([64, 96])
            self.fish.append({
                'x': random.randrange(0, WIDTH - size),
                'y': random.randrange(MIN_Y, MAX_Y - size),
                'size': size,
                'speed': random.choice([2, 3, 4]),
                'dir': random.choice([-1, 1])
            })

    def update(self):
        for f in self.fish:
            f['x'] += f['speed'] * f['dir']
            if f['x'] < 0 or f['x'] > WIDTH - f['size']:
                f['dir'] *= -1
        for p in self.players.values():
            if 'chat' in p:
                p['chat']['timer'] -= 1
                if p['chat']['timer'] <= 0:
                    del p['chat']

    def dump(self):
        return {'action': 'state', 'fish': self.fish, 'players': self.players}


async def ws_handler(request):
    ws = web.WebSocketResponse(); await ws.prepare(request)

    hello = await ws.receive_json()
    if hello.get('action') != 'join':
        await ws.close(); return ws

    room_name = hello['room']; player = hello['player_name']
    room = rooms.setdefault(room_name, Room())
    room.players[player] = {'x': WIDTH//2-BOAT_SIZE//2, 'y': MIN_Y, 'score': 0}
    room.sockets.add(ws)
    await ws.send_json(room.dump())

    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT: continue
            data = msg.json(); act = data.get('action')

            if act == 'move':
                px = max(0, min(WIDTH-BOAT_SIZE, data.get('x', 0)))
                py = max(MIN_Y, min(MAX_Y,      data.get('y', MIN_Y)))
                room.players[player]['x'], room.players[player]['y'] = px, py

            elif act == 'catch':
                b = room.players[player]
                caught = [i for i,f in enumerate(room.fish)
                          if (f['x'] < b['x']+BOAT_SIZE and f['x']+f['size'] > b['x'] and
                              f['y'] < b['y']+BOAT_SIZE and f['y']+f['size'] > b['y'])]
                for i in reversed(caught): room.fish.pop(i); room.players[player]['score'] += 1
                if not room.fish: room.respawn_fish()

            elif act == 'chat':
                txt = data.get('text','').strip()
                if txt: room.players[player]['chat'] = {'text': txt, 'timer': CHAT_DUR}

            state = room.dump()
            for cli in set(room.sockets): await cli.send_json(state)
    finally:
        room.sockets.discard(ws); room.players.pop(player, None)
        if not room.players: rooms.pop(room_name, None)   # <-- usuń pusty pokój
    return ws


async def tick(app):
    while True:
        await asyncio.sleep(1/FPS)
        for r in rooms.values():
            r.update()
            st = r.dump()
            for s in set(r.sockets):
                await s.send_json(st)


async def start(app): app['ticker'] = asyncio.create_task(tick(app))
async def stop(app):  app['ticker'].cancel(); await app['ticker']


def create_app():
    app = web.Application()
    wd = os.path.join(os.path.dirname(__file__), 'web')
    app.router.add_static('/assets', path=os.path.join(wd,'assets'), show_index=False)
    app.router.add_static('/',        path=wd,            show_index=True)
    app.router.add_get('/ws', ws_handler)
    app.router.add_get('/rooms', lambda r: web.json_response({'rooms': list(rooms)}))
    app.on_startup.append(start); app.on_cleanup.append(stop)
    return app


if __name__ == '__main__':
    print(f"Serving on http://{HOST}:{PORT}")
    web.run_app(create_app(), host=HOST, port=PORT)
