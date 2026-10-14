# Servidor de salas

Cloudflare Worker con un Durable Object por partida. Relé de mensajes entre jugadores, guarda el último estado y elige anfitrión entre los conectados. Se despliega con `npx wrangler deploy` (plan Free).

Rutas: `GET /new` devuelve un código libre; `GET /r/CODIGO/info` estado de la sala; `wss://…/r/CODIGO` WebSocket de la partida.
