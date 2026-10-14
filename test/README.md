# Pruebas

`partida-online.js`: dos navegadores (Playwright) juegan una partida completa contra el servidor local (`cd server && npx wrangler dev`), con detección de bloqueos. Con `CHAOS=1` corta los sockets de los dos jugadores cada pocos turnos para probar reconexión, relevo de anfitrión y arbitraje del servidor. `ITER=n` limita las iteraciones.
