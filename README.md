# Velocity Music

A premium, self-hosted music streaming player inspired by Spotify, YouTube Music and Apple Music. It streams full-quality audio from YouTube Music via yt-dlp, with a fully responsive React frontend and a Node.js/Express backend.

---

## Features

- **Full audio streaming** via yt-dlp (Opus ~160 kbps by default, configurable)
- **YouTube Music catalog** — search songs, albums and artists with real artwork
- **Artist & album pages** with tracklists pulled from the YouTube Music API
- **Synchronized lyrics** (LRC format, sourced from lrclib.net + YouTube Music native)
- **Offline downloads** — saves tracks to IndexedDB for playback without internet
- **User accounts** — JWT authentication, personal library (playlists, favorites, history)
- **Saved albums** — bookmark full albums to your library
- **Smart radio** — autoplay related tracks when the queue ends (like Spotify)
- **Personalized feed** — home mixes based on your listening history, likes and downloads
- **Media Session API** — control playback from lock screen and notification shade
- **Stream quality selector** — High (Opus ~160 kbps), Medium (AAC ~128 kbps), Low
- **Adaptive cover colors** — player background adapts to the dominant color of the album art
- **5 color themes** — Emerald, Violet, Ocean, Solar, Rose
- **Mobile-first** — full-screen player on Android/iOS, desktop sidebar layout on larger screens
- **PostgreSQL support** — optional, for multi-user production deployment (default: JSON file)

---

## Architecture

```
velocity-music/
├── server.js              # Entry point — bootstraps the Express server
├── src/
│   ├── app.js             # Express app factory (routes, middleware wiring)
│   ├── extractors/
│   │   ├── ytmusic.js     # YouTube Music catalog (search, artist, album, lyrics, radio)
│   │   └── ytdlp.js       # yt-dlp wrapper for full-quality stream resolution
│   ├── services/
│   │   ├── audioResolver.js   # Stream URL resolution with cache + fallback
│   │   ├── streamProxy.js     # HTTP Range-aware proxy for audio delivery
│   │   ├── streamCache.js     # In-memory LRU cache for resolved stream URLs
│   │   ├── authService.js     # JWT auth (register, login, token verification)
│   │   ├── playlistService.js
│   │   ├── favoritesService.js
│   │   └── historyService.js
│   ├── repositories/
│   │   ├── jsondb.js      # Async JSON file persistence (default, no DB required)
│   │   ├── postgres.js    # PostgreSQL repositories (USE_POSTGRES=1)
│   │   └── memory.js      # In-memory repositories (testing)
│   ├── middleware/
│   │   └── requireAuth.js # JWT middleware with user-existence validation
│   ├── lib/
│   │   └── normalize.js   # Text normalization utilities
│   └── db/
│       ├── pool.js        # PostgreSQL connection pool
│       ├── init.js        # Schema migration runner
│       └── schema.sql     # Database schema
├── frontend/
│   ├── src/
│   │   ├── App.jsx        # Main React application (single-file component)
│   │   ├── api.js         # Backend API client (fetch wrapper)
│   │   ├── offline.js     # IndexedDB offline storage
│   │   └── main.jsx       # React entry point
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── test/                  # Node built-in test runner + fast-check (property-based)
├── .env.example           # Environment variable reference
└── package.json
```

---

## Prerequisites

- **Node.js** ≥ 18
- **yt-dlp** — downloaded automatically on first run. Can also be installed manually:
  ```bash
  # Windows
  winget install yt-dlp.yt-dlp

  # macOS
  brew install yt-dlp

  # Linux
  python3 -m pip install -U yt-dlp
  ```

---

## Getting Started

### 1. Clone and install

```bash
git clone <repo-url>
cd velocity-music
npm install
cd frontend && npm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and set at minimum:
#   JWT_SECRET=<a long random string>
```

Generate a secure secret:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 3. Run

**Backend** (port 3000):
```bash
npm start
```

**Frontend dev server** (port 5173, with hot reload):
```bash
cd frontend
npm run dev
```

Then open: [http://localhost:5173](http://localhost:5173)

For access from your phone on the same Wi-Fi, use your machine's local IP:
```
http://<your-local-ip>:5173
```

---

## Building for Production

Build the frontend into `public/` (served by Express as static files):

```bash
cd frontend
npm run build
```

Then run only the backend:
```bash
npm start
# Serves the full app at http://localhost:3000
```

---

## Environment Variables

See [`.env.example`](.env.example) for the full list. Key variables:

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | **Yes (prod)** | Secret key for signing JWT tokens |
| `PORT` | No | Server port (default: 3000) |
| `USE_POSTGRES` | No | Set to `1` to use PostgreSQL instead of JSON storage |
| `DATABASE_URL` | If Postgres | PostgreSQL connection string |
| `ALLOWED_ORIGIN` | No | CORS allowed origin for production (e.g. your Vercel URL) |

---

## Running Tests

```bash
npm test
```

Uses Node's built-in test runner with property-based tests via [fast-check](https://fast-check.dev/).

---

## Deployment

### Render (backend) + Vercel (frontend)

**Backend on Render:**
1. Connect your repo
2. Set build command: `npm install`
3. Set start command: `npm start`
4. Add environment variables: `JWT_SECRET`, `PORT`, `ALLOWED_ORIGIN`, and optionally `DATABASE_URL` + `USE_POSTGRES=1`
5. Set health check path: `/api/status`

**Frontend on Vercel:**
1. Set root directory to `frontend/`
2. Framework preset: Vite
3. Update `frontend/vite.config.js` to point the API proxy to your Render backend URL in production

---

## License

Private — all rights reserved.
