# Hosting gratis para siempre: Cloudflare Pages + alwaysdata

Esta guía separa la app en dos piezas para que no dependa de los 5 GB de Render:

| Pieza | Qué sirve | Servicio | Coste | Tarjeta |
| --- | --- | --- | --- | --- |
| Frontend | HTML, JS, CSS, imágenes | **Cloudflare Pages** | 0 € | No |
| Tiempo real | Socket.io / WebSocket | **alwaysdata Free** | 0 € “for life” | No |

El frontend es un export estático (`out/`), así que Cloudflare lo sirve desde su CDN sin consumir ancho de banda del servidor. alwaysdata solo ejecuta el proceso pequeño de Socket.io: no compila Next.js, no sirve páginas y cabe de sobra en los 256 MB del plan gratuito.

> Los planes gratuitos pueden cambiar con el tiempo. alwaysdata anuncia su plan Free como “for life” y Cloudflare Pages no pide tarjeta. Aun así, conviene revisar las condiciones antes de dar por hecho un “para siempre” absoluto.

---

## 1. Servidor de tiempo real en alwaysdata

### 1.1 Crear la cuenta

1. Entra en <https://www.alwaysdata.com/en/register/>.
2. Elige el plan **Free** (0 €/mes, 1 GB SSD, 256 MB RAM, 0,25 CPU).
3. No hace falta tarjeta. alwaysdata te da una cuenta y un subdominio `TU_CUENTA.alwaysdata.net`.

### 1.2 Subir el servidor

El servidor standalone son solo cuatro archivos:

- `server/socket.ts`
- `server/realtime.ts`
- `server/package.json`
- `server/package-lock.json`

No subas `server/index.ts`: ese es el servidor de Render y necesita Next.js.

Desde tu máquina, con la cuenta y el host SSH que muestra el panel de alwaysdata:

```bash
ssh TU_CUENTA@ssh-TU_CUENTA.alwaysdata.net
mkdir -p ~/www/whiteboardmod-socket
exit
```

Y desde la carpeta del repo:

```bash
scp server/socket.ts server/realtime.ts server/package.json server/package-lock.json \
  TU_CUENTA@ssh-TU_CUENTA.alwaysdata.net:~/www/whiteboardmod-socket/
```

Instala las dependencias en el servidor:

```bash
ssh TU_CUENTA@ssh-TU_CUENTA.alwaysdata.net
cd ~/www/whiteboardmod-socket
npm ci --omit=dev
```

`npm ci` instala únicamente `socket.io`; ocupa muy pocos megas.

### 1.3 Crear el sitio Node.js

En el panel de alwaysdata:

1. **Web → Sites → Add a site**.
2. Tipo: **Node.js**.
3. Dirección: `TU_CUENTA.alwaysdata.net` (o un subdominio libre).
4. Versión de Node.js: **24** (Node 24 ejecuta `socket.ts` directamente, sin compilar).
5. Directorio de trabajo: `~/www/whiteboardmod-socket`.
6. Comando: `node socket.ts`.
7. Si el panel tiene **Idle time** o apagado por inactividad, ponlo en **0** para que el proceso no se duerma y el WebSocket siga vivo.
8. Si el sitio se sirve bajo una ruta (por ejemplo `.../socket`) y el panel ofrece **Trim path** o “quitar el prefijo”, actívalo. Así Socket.io usa `/socket.io` en la raíz.

Guarda y espera a que arranque. Comprueba:

```text
https://TU_CUENTA.alwaysdata.net/health
```

Debe responder:

```json
{"ok":true,"service":"whiteboardmod-realtime"}
```

Si el sitio está bajo una ruta y no activaste “Trim path”, el health estará en `https://TU_CUENTA.alwaysdata.net/socket/health` y habrá que configurar `SOCKET_PATH` (ver más abajo).

### 1.4 Variables opcionales del servidor

Se configuran en el panel del sitio (o por SSH, según alwaysdata):

| Variable | Para qué | Ejemplo |
| --- | --- | --- |
| `CLIENT_ORIGIN` | Restringir CORS a tu dominio de Pages | `https://mi-pizarra.pages.dev` |
| `SOCKET_PATH` | Cambiar la ruta de Socket.io si no usas “Trim path” | `/socket/socket.io` |
| `PORT` / `IP` | alwaysdata los inyecta; el código ya los usa | — |

Si no pones `CLIENT_ORIGIN`, el servidor acepta cualquier origen (`*`), igual que Render. Para producción es recomendable restringirlo cuando ya tengas la URL de Cloudflare.

---

## 2. Frontend en Cloudflare Pages

### 2.1 Conectar el repositorio

1. Entra en <https://dash.cloudflare.com/> y crea una cuenta gratuita (no pide tarjeta).
2. **Workers & Pages → Create → Pages → Connect to Git**.
3. Autoriza GitHub y elige el repo `YOKUBOWOODtest/ESPfox`.
4. Rama de producción: `main`.

### 2.2 Configuración del build

| Campo | Valor |
| --- | --- |
| Framework preset | None (o “Next.js (Static HTML Export)” si aparece) |
| Build command | `npm run build` |
| Build output directory | `out` |
| Node version | 24 (`NODE_VERSION=24`) |

Variables de entorno:

| Variable | Valor |
| --- | --- |
| `STATIC_EXPORT` | `true` |
| `NEXT_PUBLIC_SOCKET_URL` | `https://TU_CUENTA.alwaysdata.net` |
| `NEXT_PUBLIC_SOCKET_PATH` | `/socket.io` (opcional; solo si cambiaste la ruta) |
| `NEXT_TELEMETRY_DISABLED` | `1` |
| `NODE_VERSION` | `24` |

Puntos importantes:

- **No** pongas `NEXT_PUBLIC_STATIC_EXPORT=1`. Esa variable es solo para la demo de GitHub Pages y desactiva el tiempo real.
- `NEXT_PUBLIC_SOCKET_URL` se incrusta en el JavaScript al compilar. Si cambias la URL del servidor, tienes que volver a desplegar Pages.
- `public/_redirects` y `public/_headers` ya están en el repo. Next los copia a `out/`; Cloudflare los usa automáticamente.
- La regla `/board/* → /board/index.html 200` permite que cualquier ID de pizarra funcione sin prerenderizar cada ID.

### 2.3 Desplegar y probar

1. Pulsa **Save and Deploy**.
2. Abre `https://TU_PROYECTO.pages.dev/`.
3. Abre `https://TU_PROYECTO.pages.dev/board/TEST123`. Debe cargar la pizarra y mantener `TEST123` en la URL.
4. Copia el enlace de invitación desde la barra de la sala.
5. Ábrelo en una ventana de incógnito y comprueba que aparecen los dos usuarios.
6. Dibuja en una ventana: debe aparecer en la otra.

Si la pizarra carga pero no aparecen usuarios, mira la consola del navegador: normalmente es que `NEXT_PUBLIC_SOCKET_URL` no se configuró antes del build, o que alwaysdata está sirviendo el socket en otra ruta.

---

## 3. Retirar Render

No borres Render hasta comprobar los dos pasos anteriores.

Cuando todo funcione:

1. Render Dashboard → servicio `pizarra-realtime` → **Settings → Suspend** (o Delete).
2. El repo conserva `Dockerfile`, `render.yaml`, `server/index.ts` y `npm start` por si quieres volver atrás.
3. Render dejará de consumir los 5 GB del workspace. Si el workspace ya estaba al 70 %, suspenderlo evita llegar al 100 % y que te lo bloqueen.

Para volver a Render:

```bash
npm run build
npm start
```

o desplegar el `render.yaml` de siempre.

---

## 4. Probar la arquitectura partida en local

Necesitas dos terminales.

**Terminal 1 — servidor de sockets:**

```powershell
$env:PORT="3001"
npm run start:socket
```

**Terminal 2 — build estático apuntando al socket local:**

```powershell
$env:NEXT_PUBLIC_SOCKET_URL="http://localhost:3001"
npm run build:static
npm run preview:static
```

Abre `http://localhost:3002/board/TEST123`. `preview:static` aplica la misma regla `/board/* → /board/index.html` que Cloudflare.

Pruebas automatizadas contra la versión partida:

```powershell
$env:ORIGIN="http://localhost:3002"
node scripts/board-realtime-check.mjs
node scripts/board-ux-check.mjs
node scripts/board-canvas-check.mjs
node scripts/board-proximity-audio-check.mjs

# El test de audio habla directo con Socket.io, no con el frontend:
$env:ORIGIN="http://localhost:3001"
node scripts/board-audio-check.mjs
```

Resultados esperados: 11/11, 10/10, 84/84, 7/7 y 6/6.

---

## 5. Problemas frecuentes

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| `/board/ABC` da 404 en Pages | `_redirects` no llegó al deployment | Comprueba que `out/_redirects` existe y que Cloudflare lo sirve; vuelve a desplegar |
| La pizarra carga pero no hay usuarios | Socket URL vacía o incorrecta | Revisa `NEXT_PUBLIC_SOCKET_URL` y vuelve a desplegar |
| `WebSocket 404` | Ruta distinta entre cliente y servidor | Activa “Trim path” o iguala `SOCKET_PATH` y `NEXT_PUBLIC_SOCKET_PATH` |
| `connect_error` / CORS | `CLIENT_ORIGIN` no incluye tu dominio | Añade `https://TU_PROYECTO.pages.dev` o quita `CLIENT_ORIGIN` |
| alwaysdata duerme el proceso | Idle time distinto de 0 | Ponlo en 0 y reinicia el sitio |
| Las imágenes grandes no importan | Límite de subida del proxy de alwaysdata | Comprime la imagen; el servidor acepta hasta 24 MB, pero el proxy puede limitar menos |
| El servidor se queda sin memoria | Muchas pizarras en memoria | El servidor borra pizarras vacías tras 24 h; reinicia el sitio si hace falta |

---

## 6. Variables de referencia

### Frontend (Cloudflare Pages)

| Variable | Obligatoria | Valor |
| --- | --- | --- |
| `STATIC_EXPORT` | Sí | `true` |
| `NEXT_PUBLIC_SOCKET_URL` | Sí | `https://TU_CUENTA.alwaysdata.net` |
| `NEXT_PUBLIC_SOCKET_PATH` | No | `/socket.io` por defecto |
| `NEXT_TELEMETRY_DISABLED` | No | `1` |
| `NODE_VERSION` | No | `24` |

### Backend (alwaysdata)

| Variable | Obligatoria | Valor |
| --- | --- | --- |
| `CLIENT_ORIGIN` | No | `https://TU_PROYECTO.pages.dev` |
| `SOCKET_PATH` | No | `/socket.io` por defecto |
| `PORT` / `IP` | alwaysdata | Los inyecta la plataforma |

---

## 7. Enlaces

- Plan Free de alwaysdata: <https://www.alwaysdata.com/en/pricing/>
- Documentación Node.js de alwaysdata: <https://help.alwaysdata.com/en/docs/web-hosting/languages/nodejs/>
- WebSockets en alwaysdata: <https://help.alwaysdata.com/en/blog/2023-03-14-hold-on-to-your-socks-high-speed-data-stream-hosting-with-websockets/>
- Cloudflare Pages: <https://developers.cloudflare.com/pages/>
- Reglas `_redirects`: <https://developers.cloudflare.com/pages/configuration/redirects/>
