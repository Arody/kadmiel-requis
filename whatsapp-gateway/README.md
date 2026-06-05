# Kadmiel WhatsApp Gateway

Servicio Node.js que conecta WhatsApp con **Baileys** y envía las notificaciones de Kadmiel Supply OS (la primera: aviso al crear una requisición).

> **Por qué es un servicio aparte:** la app web es un *static export* de Next.js (sin servidor). Baileys necesita un proceso **siempre encendido** que mantenga el WebSocket con WhatsApp, así que vive aquí y se despliega por separado (VPS + PM2). **No** forma parte del build de Netlify.

## Cómo encaja

```
Frontend (Netlify, estático)        Supabase (Postgres)              Este gateway (VPS, PM2)
  pestaña Ajustes  ──RPC public──►   schema wp_data            ◄──service_role (RPC wp_gw_*)──┐
  · muestra QR/estado                 · auth_state (sesión)                                   │
  · elige destinatarios               · connection (estado/QR)   trigger al crear requisición │
  · guarda config                     · message_outbox (cola) ───────────────────────────────┘
                                                                 el gateway consume la cola y envía
```

El gateway **solo** habla con Supabase (saliente). El navegador nunca habla con el VPS: no hay CORS ni que exponer puertos para la función principal (nginx es solo para `/health` y `/status`).

## Requisitos

- Node.js **≥ 20**
- Una cuenta de WhatsApp para vincular (se escanea un QR una sola vez)
- La **service_role key** del proyecto Supabase (Settings → API → `service_role`)

## Configuración

```bash
cd whatsapp-gateway
cp .env.example .env
# edita .env y pega SUPABASE_SERVICE_ROLE_KEY (y opcionalmente GATEWAY_TOKEN)
npm install        # o: pnpm install
```

Variables (`.env`):

| Variable | Descripción |
| --- | --- |
| `SUPABASE_URL` | URL del proyecto (ya viene la de Kadmiel en el ejemplo). |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secreto.** Permite ejecutar las RPCs `wp_gw_*`. Nunca lo pongas en el frontend. |
| `PORT` | Puerto del HTTP de health/status (default `8787`). |
| `GATEWAY_TOKEN` | Si se define, protege `/status` con `Authorization: Bearer <token>`. |
| `DEFAULT_COUNTRY_CODE` | Lada por defecto para teléfonos de 10 dígitos (default `52`). |
| `SWEEP_INTERVAL_MS` | Cada cuánto barre la cola (default `15000`). |
| `MAX_ATTEMPTS` | Reintentos por mensaje antes de marcarlo `failed` (default `3`). |
| `PRINT_QR_TERMINAL` | Imprime el QR también en la terminal (default `true`). |

## Vincular WhatsApp (primera vez)

```bash
node src/index.js
```

Aparecerá un QR en la terminal (y también en la pestaña **Ajustes** del panel, para super_admin). Escanéalo desde **WhatsApp → Dispositivos vinculados → Vincular dispositivo**. Al conectar, `wp_data.connection.status` pasa a `connected` y la sesión queda guardada en `wp_data.auth_state` (no hay que volver a escanear tras reinicios).

## Producción con PM2

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup    # sigue la instrucción que imprime para arrancar al boot
pm2 logs kadmiel-whatsapp-gateway   # ver el QR / la actividad
```

> Mantén **una sola instancia** (una sesión de WhatsApp). El `ecosystem.config.cjs` ya usa `instances: 1`, `fork`.

## nginx (opcional, solo health/ops)

El envío **no** necesita entrada HTTP. Esto solo expone `/health` y `/status` para monitoreo:

```nginx
server {
  server_name wa-gateway.tu-dominio.com;

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

Luego `certbot --nginx -d wa-gateway.tu-dominio.com` para HTTPS. Protege `/status` con `GATEWAY_TOKEN`.

## Comprobaciones

- `GET /health` → `{ "ok": true }`
- `GET /status` (con `Authorization: Bearer $GATEWAY_TOKEN`) → estado de la conexión
- Logs: `pm2 logs` muestra `mensaje enviado` por cada notificación entregada.

## Notas

- La versión de Baileys está fijada (`6.7.23`). Si WhatsApp deja de conectar por cambios de protocolo, prueba `npm install @whiskeysockets/baileys@latest`.
- Si cambias de número o quieres re-vincular: botón **Desvincular** en el panel (encola `command='logout'`), o `pm2 restart` tras limpiar `wp_data.auth_state`.
