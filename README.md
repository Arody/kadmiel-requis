# Kadmiel Supply OS

Sistema de abastecimiento de Kadmiel. Tiene **dos procesos** + **Supabase** (Postgres gestionado):

```
┌──────────────────────────┐      ┌──────────────────────┐      ┌──────────────────────────────┐
│ Frontend (Next, ESTÁTICO) │      │ Supabase (Postgres)  │      │ whatsapp-gateway (Node/Baileys)│
│  puerto 3015              │─RPC─►│  schema public/wp_data│◄─SR─│  puerto 3016 (health/status)   │
│  carpeta out/ servida     │      │  trigger requisición  │      │  mantiene la sesión de WhatsApp│
│  como archivos estáticos  │      │  encola en outbox ────┼─────►│  consume la cola y envía       │
└──────────────────────────┘      └──────────────────────┘      └──────────────────────────────┘
```

> **Importante:** el frontend es un **static export** (`next.config.ts` → `output: "export"`). En el VPS **no** se corre con `next start`; se **construye** (`pnpm build` → carpeta `out/`) y se **sirve como archivos estáticos**. Baileys vive en `whatsapp-gateway/` porque necesita un proceso siempre encendido.

---

## Requisitos en el VPS

- **Node.js ≥ 20** y **pnpm** (`npm i -g pnpm`)
- **PM2** (`npm i -g pm2`)
- **nginx** (reverse proxy + HTTPS)
- La **service_role key** de Supabase (Settings → API → `service_role`)

---

## Variables de entorno

**Frontend** — archivo `.env.local` en la raíz (se lee al **construir**, los valores quedan dentro del bundle):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://fhkfqhmttzeaqifuerqf.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<anon / publishable key>   # llave PÚBLICA, no la service_role
```

**Gateway** — archivo `whatsapp-gateway/.env`:

```bash
SUPABASE_URL=https://fhkfqhmttzeaqifuerqf.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role secret>   # ⚠️ SECRETO: solo aquí, nunca en el front ni en git
PORT=3016
GATEWAY_TOKEN=<token largo para proteger /status>
DEFAULT_COUNTRY_CODE=52
```

> ⚠️ **Seguridad:** la `service_role` salta el RLS (acceso total). Va **solo** en `whatsapp-gateway/.env` (que está en `.gitignore`). **No** la dejes en `.env.example` ni la subas a git.

---

## Despliegue en el VPS

Suponiendo que clonas en `~/apps/kadmiel-requis` (ajusta la ruta a la tuya):

```bash
git clone <repo> ~/apps/kadmiel-requis
cd ~/apps/kadmiel-requis
```

### 1) Frontend estático — puerto **3015**

```bash
cd ~/apps/kadmiel-requis
# crea .env.local con las llaves PÚBLICAS (ver arriba)
pnpm install
pnpm build                     # genera la carpeta out/

# sirve out/ en el puerto 3015 con el servidor estático de PM2
pm2 serve ~/apps/kadmiel-requis/out 3015 --spa --name kadmiel-front
```

`--spa` hace fallback a `index.html` (igual que el `_redirects`/`netlify.toml`).

> Alternativa sin proceso 3015: que **nginx sirva `out/` directo** (más eficiente). Ver nota al final del bloque de nginx.

### 2) Gateway WhatsApp — puerto **3016**

```bash
cd ~/apps/kadmiel-requis/whatsapp-gateway
cp .env.example .env           # edita: pega SUPABASE_SERVICE_ROLE_KEY y deja PORT=3016
npm install                    # usa npm aquí (carpeta independiente del workspace pnpm)
pm2 start ecosystem.config.cjs # arranca como "kadmiel-whatsapp-gateway"
pm2 logs kadmiel-whatsapp-gateway   # aquí sale el QR la primera vez
```

### 3) Persistir en PM2 y arranque automático

```bash
pm2 save
pm2 startup        # ejecuta la línea que imprime (registra PM2 en systemd)
pm2 ls             # debes ver: kadmiel-front (3015) y kadmiel-whatsapp-gateway (3016)
```

### 4) nginx + HTTPS

```nginx
# ---- Frontend (app) ----
server {
  listen 80;
  server_name app.tudominio.com;

  location / {
    proxy_pass http://127.0.0.1:3015;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

# ---- Gateway (solo health/status; opcional) ----
server {
  listen 80;
  server_name wa.tudominio.com;

  location / {
    proxy_pass http://127.0.0.1:3016;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d app.tudominio.com -d wa.tudominio.com   # HTTPS
```

- **Firewall:** abre solo `80/443` (y `22`). Los puertos **3015 y 3016 quedan internos** (solo nginx los usa). `sudo ufw allow 'Nginx Full'`.
- El **envío de WhatsApp no necesita entrada HTTP**: el gateway solo hace conexiones salientes a Supabase. El puerto 3016 es únicamente para `/health` y `/status`.

> **Alternativa (nginx sirve el estático directo, sin pm2 serve):** en el server block del front, en vez de `proxy_pass`, usa:
> ```nginx
> root /home/USUARIO/apps/kadmiel-requis/out;
> location / { try_files $uri $uri.html $uri/ /index.html; }
> ```
> En ese caso no necesitas `pm2 serve` ni el puerto 3015.

---

## Vincular WhatsApp y activar notificaciones

1. Con el gateway corriendo, abre `pm2 logs kadmiel-whatsapp-gateway` y **escanea el QR** desde WhatsApp → **Dispositivos vinculados → Vincular un dispositivo** (también aparece en la pestaña **Ajustes** del panel). Al conectar, la sesión queda guardada en `wp_data.auth_state` (no se vuelve a pedir tras reinicios).
2. Entra al panel como **super_admin** → pestaña **Ajustes** → activa **"nueva requisición"**, elige destinatarios y **Guardar**.
3. Crea una requisición → en segundos llega el WhatsApp (`pm2 logs` muestra `mensaje enviado`).

---

## Actualizar (deploy de cambios)

```bash
cd ~/apps/kadmiel-requis
git pull

# Frontend
pnpm install && pnpm build
pm2 restart kadmiel-front

# Gateway (si cambió)
cd whatsapp-gateway && npm install
pm2 restart kadmiel-whatsapp-gateway
```

---

## Operación / problemas comunes

- **No aparece el QR:** revisa `pm2 logs kadmiel-whatsapp-gateway`. Suele ser `SUPABASE_SERVICE_ROLE_KEY` faltante/incorrecta.
- **Re-vincular otro número:** botón **Desvincular** en Ajustes (o `pm2 restart` tras vaciar `wp_data.auth_state`).
- **Una sola instancia del gateway:** dev y prod comparten la sesión en `wp_data`; no corras dos a la vez.
- **Comprobación rápida:** `curl http://127.0.0.1:3016/health` → `{"ok":true}`.

---

## Desarrollo local

```bash
pnpm install
pnpm dev                              # http://localhost:3000

cd whatsapp-gateway
npm install && npm run dev            # QR en la terminal
```

Ambos apuntan al Supabase real; no hay base de datos local. Detalle del gateway en [`whatsapp-gateway/README.md`](whatsapp-gateway/README.md).
