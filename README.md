# CucCut

CucCut is a mobile-first web editor for videos and photos, with features similar to CapCut. It runs as a PWA, and everything except subtitles is processed on the user's device.

- `web/`: the app (Vite + React + TS). Preview uses `<video>` + Canvas 2D. Export goes through [mediabunny](https://mediabunny.dev) (WebCodecs) to MP4.
- `server/index.mjs`: the AI proxy for subtitles (Groq Whisper). It has no dependencies, a monthly spend cap and a per-IP daily limit.
- `deploy/`: `install.sh` (run once as root), `deploy.sh` (routine deploys), the nginx config and the systemd unit.

## Dev
```bash
export PATH=~/sdk/node/bin:$PATH
cd web && npm i && npx vite --port 5190          # app
cd server && GROQ_API_KEY=... ALLOWED_ORIGINS=http://127.0.0.1:5190 node index.mjs   # AI proxy (port 7820, proxied at /api)
```

## Deploy
```bash
bash deploy/deploy.sh                                    # build + publish (no sudo after first install)
sudo GROQ_API_KEY=gsk_... bash deploy/install.sh         # first time only
```
