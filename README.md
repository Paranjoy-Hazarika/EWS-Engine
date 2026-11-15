# EWS Engine: Early Warning Score System

A real-time early warning score (NEWS2-style) and emergency alerting system for hospital wards.
Staff record a patient's vital signs, the system scores them instantly, ranks the ward by risk, and sounds an emergency alarm for the doctors and nurses of that hospital when a patient becomes critical.

**Stack:** React + Vite · Flask · MySQL · Server-Sent Events (live updates) · Docker Compose

---

## Contents
1. [Features](#features)
2. [Roles and permissions](#roles-and-permissions)
3. [How scoring and alerts work](#how-scoring-and-alerts-work)
4. [Project structure](#project-structure)
5. [Database](#database)
6. [Quick start](#quick-start)
7. [Configuration](#configuration)
8. [Open the app on a phone or another device](#open-the-app-on-a-phone-or-another-device)
9. [Demo script](#demo-script)
10. [API overview](#api-overview)
11. [Tests](#tests)
12. [Troubleshooting](#troubleshooting)
13. [Security notes](#security-notes)
14. [Limitations](#limitations)

---

## Features
- **Live ward board:** patients ranked by risk, colour-coded vitals (by points), trend sparklines, summary cards.
- **Automatic scoring:** seven vitals scored from editable rules; total score and risk tier (Low / Medium / High).
- **Alerts:** a *Warning* for a worsening trend and an *Emergency* for a High score, raised once per episode (no duplicates).
- **Emergency alarm:** a red alert panel docked at the top right of every page (it never blocks the screen), a pager-style siren, tab-title flash and optional browser notification. Escalates after 60 s without acknowledgement.
- **Patient charts:** paper-style observation grid, score-over-time graph with risk bands, time windows (15 min to 30 days or a custom range) and smoothing.
- **Multi-hospital:** one installation can serve several hospitals, each with its own wards. Every doctor and nurse belongs to one hospital and sees only its patients, alerts and live updates.
- **Admin tools:** register hospitals and wards, manage staff accounts and hospital assignment, edit scoring rules.
- **Live updates** via Server-Sent Events, with no refreshing or polling.
- **Bedside-monitor simulator** for demonstrations (patients follow random episodes: mostly stable, sometimes mild, rarely deteriorating; only one deteriorates at a time).

## Roles and permissions
| Action | Nurse | Doctor | Admin |
|---|:--:|:--:|:--:|
| View board and charts of own hospital | ✓ | ✓ | – |
| View board and charts of all hospitals (hospital selector) | – | – | ✓ |
| Receive alerts, hear the alarm, acknowledge / review | ✓ | ✓ | – |
| Log vitals, admit patients (own hospital) | ✓ | ✓ | ✓ |
| Edit scoring rules | – | – | ✓ |
| Manage staff and hospital assignment | – | – | ✓ |
| Register hospitals and wards | – | – | ✓ |
| Run the simulator | – | – | ✓ |

The Admin manages the system but does **not** receive alerts or the alarm. Another hospital's patient is answered with *404 Not found*, so its existence is not revealed.

## How scoring and alerts work
- Each reading is scored per vital from the `SCORING_RULE` table. Total **7 or more = High (Emergency alert)**, **5–6 = Medium**, otherwise **Low**.
- Any single vital scoring 3 lifts *Low* to *Medium*.
- A rising score over 3 readings raises a **Warning**.
- Only a *more severe* alert counts as new, so there are no duplicates.
- An Emergency stays active until a doctor or nurse presses **Acknowledge**; **Mark as reviewed** (Alerts page) clears it so it can fire again.
- "Acknowledged by" is taken from the signed-in account and cannot be faked.
- `ESCALATE_AFTER_SECONDS` sets the escalation time (default 60).

## Project structure
```
ews-final/
├── backend/
│   ├── app.py            # Flask API, hospital scoping, SSE stream
│   ├── auth.py           # login, roles, tokens
│   ├── dbutil.py         # transactions and helpers
│   ├── events.py         # live event hub (filtered by hospital and role)
│   ├── simulator.py      # bedside-monitor simulator
│   ├── migrate.py        # upgrades an older database on start
│   ├── requirements.txt
│   ├── .env.example
│   ├── static/           # built frontend (served by Flask)
│   └── tests/            # pytest suite
├── frontend/             # React + Vite source
├── schema.sql            # database tables
├── seed.sql              # demo data and starter accounts
├── Dockerfile
├── docker-compose.yml
└── .env.example          # used by Docker Compose
```

## Database
Six tables. The clinical model has five: `HOSPITAL`, `WARD`, `VITAL_PARAMETER`, `SCORING_RULE`, `PATIENT`. Vital readings and alerts are attributes of `PATIENT` (latest observation, derived score and tier, alert state, and a JSON list of past readings).
The sixth table, `STAFF`, is for sign-in only. Each doctor and nurse has one `hospital_id`; the Admin has none and sees all hospitals.

## Quick start
First start creates three accounts, all with the password in `INITIAL_PASSWORD`: `admin`, `doctor`, `nurse` (the doctor and nurse are placed in the first hospital).
**Sign in as admin, create real accounts, and disable or re-password the demo ones.**

### Option A: Docker (recommended)
Needs Docker (Docker Desktop on Windows, which wants roughly 10 GB of free disk space).
```bash
cp .env.example .env        # then edit DB_PASSWORD, SECRET_KEY (long random), INITIAL_PASSWORD
docker compose up -d --build
```
Open `http://<server-address>/`. Tables are created automatically on first start.
- Update later: `docker compose up -d --build` (data stays in the `db_data` volume)
- Logs: `docker compose logs -f app`
- Backup: `docker compose exec db mysqldump -uroot -p ews_engine > backup.sql`

### Option B: Windows or Linux without Docker
Needs Python 3.10+, Node.js (LTS) and MySQL or MariaDB.

**1. Load the database (once)**
```bash
mysql -u root -p
```
```sql
source schema.sql;
source seed.sql;
exit
```
> PowerShell does not support `<` redirection, so use `source` inside the MySQL prompt. If your path has spaces, use the full path with forward slashes.

**2. Backend (once)**
```powershell
cd backend
python -m venv venv
venv\Scripts\activate            # Linux/Mac: source venv/bin/activate
pip install -r requirements.txt
pip install waitress             # production server for Windows
copy .env.example .env           # Linux/Mac: cp .env.example .env
notepad .env                     # set DB_PASSWORD (and optionally INITIAL_PASSWORD)
```

**3. Build the frontend (once, and again after any frontend change)**
```powershell
cd ..\frontend
npm install
npm run build
cd ..
Remove-Item -Recurse -Force backend\static -ErrorAction SilentlyContinue
Copy-Item -Recurse frontend\dist backend\static
```
Linux/Mac: `rm -rf backend/static && cp -r frontend/dist backend/static`.

**4. Run (every time)**
```powershell
cd backend
venv\Scripts\activate
waitress-serve --threads=8 --port=5000 app:app
```
Linux can use gunicorn instead: `gunicorn -w 1 --threads 8 -b 0.0.0.0:5000 app:app`.
Open `http://localhost:5000`. Keep the window open while using the app.

> **Run exactly one server process** (one worker). Live updates and the simulator live in that process's memory, so several workers would stop alerts reaching every browser.

### Option C: Development mode
```bash
cd backend && python app.py            # API on :5000
cd frontend && npm install && npm run dev   # open http://localhost:5173
```
If you used an earlier version of this project, run `DROP DATABASE ews_engine;` first and load both SQL files again, or just start the app: it adds `STAFF.hospital_id` to an older database automatically.

## Configuration
Set these in `backend/.env` (non-Docker) or the root `.env` (Docker).

| Variable | Purpose |
|---|---|
| `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL connection (`DB_NAME` defaults to `ews_engine`) |
| `SECRET_KEY` | Long random string used to sign login tokens. Set it for any real deployment. |
| `INITIAL_PASSWORD` | Password for the three starter accounts (default `ChangeMe123!`) |
| `ENABLE_SIMULATOR` | `1` for demos, **`0` for real use** so fake readings can never reach a live database |
| `ESCALATE_AFTER_SECONDS` | Time before an unacknowledged Emergency escalates (default 60) |

## Open the app on a phone or another device
1. Start the server (Option A or B) on the laptop.
2. Find the laptop's Wi-Fi address with `ipconfig` (use the IPv4 address under *Wireless LAN adapter Wi-Fi*; ignore virtual adapters).
3. **Windows only, once:** open PowerShell **as Administrator** and allow the port:
   ```powershell
   New-NetFirewallRule -DisplayName "EWS Engine 5000" -Direction Inbound -Protocol TCP -LocalPort 5000 -Action Allow -Profile Any
   ```
4. Connect the phone to the **same Wi-Fi** and open `http://<laptop-ip>:5000` (use `http://`, not `https://`).
5. Sign in as a nurse or doctor and tap **Turn on sound**. Keep the screen on and the tab in front, because browsers pause sound in background tabs.

If the page won't load, the Wi-Fi may block device-to-device traffic (common on campus networks). Turn on the **phone's hotspot**, connect the laptop to it, run `ipconfig` again and use the laptop's new IP.
Desktop notifications need HTTPS; the on-screen alert panel and siren work over plain HTTP.

## Demo script
1. Sign in as `admin`, open **Live monitor**, click **Enable alarm sound**, then **Start simulator**.
2. In another browser or on a phone, sign in as `nurse` and enable sound.
3. At a High score (7+) the alert panel and siren appear for the nurse until **Acknowledge** is pressed. After 60 s unacknowledged, it escalates.
4. Show **Alerts → Mark as reviewed**, then **Patient charts**, then **Hospitals & wards** (Admin) to register a second hospital and show that staff there see only their own patients.
5. Note that the Admin never receives the alarm.

## API overview
| Endpoint | Who | Purpose |
|---|---|---|
| `POST /api/auth/login` | Anyone | Sign in, returns a token |
| `GET /api/dashboard` | Signed in | Patients with score, tier, alert (own hospital; Admin: all or `?hospital_id=`) |
| `POST /api/patients` | Signed in | Admit a patient into a ward of the user's hospital |
| `POST /api/vitals` | Signed in | Save a reading, score it, update the alert |
| `GET /api/patients/<id>/history` | Signed in | Reading history for charts |
| `GET /api/alerts` | Doctor, Nurse | Active alerts of the user's hospital |
| `PATCH /api/patients/<id>/acknowledge` · `/resolve` | Doctor, Nurse | Acknowledge or review an alert |
| `GET /api/stream` | Signed in | Live events (SSE), filtered by hospital and role |
| `GET /api/hospitals` | Signed in | Hospitals with wards |
| `POST/PATCH/DELETE /api/hospitals`, `/api/hospitals/<id>/wards`, `/api/wards/<id>` | Admin | Manage hospitals and wards |
| `PUT /api/scoring-rules/<id>` | Admin | Edit a scoring band |
| `/api/staff` | Admin | Create, disable and re-password staff; assign hospital |
| `POST /api/simulator/start` · `/stop` | Admin | Control the simulator |
| `GET /api/health` | Anyone | Health check (`{"ok":true}`) |

## Tests
```bash
cd backend
python -m pytest -q tests
```
Ten tests cover login rules, scoring tiers, alert de-duplication, trends, acknowledge and review, validation, hospital isolation, Admin receiving no alerts, hospital and ward rules, and live-event scoping.
**Run them on a scratch database:** they insert test patients and use the seeded accounts.

## Troubleshooting
| Symptom | Likely cause and fix |
|---|---|
| `docker` is not recognised | Docker isn't installed or not on PATH. Install Docker Desktop (needs ~10 GB free), or use Option B. |
| `No module named 'app'` | You ran the server from the wrong folder. Run it from `backend`. |
| `{"error":"Not found"}` at `/` | The frontend isn't built into `backend/static`. Redo step 3 of Option B. |
| Login fails or database error | MySQL not running, SQL files not loaded, or wrong `DB_PASSWORD` in `backend/.env`. |
| Phone can't open the page | Check the IP, same Wi-Fi, firewall rule (needs Administrator), and try the phone hotspot. |
| No alarm sound | Click **Enable alarm sound** / **Turn on sound** on that device; keep the tab in front. |
| Admin sees no alerts | By design. Use a doctor or nurse account. |
| Alerts don't reach other browsers | More than one server process is running. Use a single worker. |

## Security notes
- Signed 12-hour tokens, hashed passwords, and lock-out after 5 failed logins.
- Role and hospital checks are enforced on the server, not just hidden in the interface.
- Patient data needs **HTTPS** on any real network. Put a reverse proxy in front, for example Caddy: `your-domain.com { reverse_proxy localhost:8000 }` (and change the compose port mapping to `"8000:8000"`). For live updates, proxies must not buffer `/api/stream` (Caddy is fine as is; nginx needs `proxy_buffering off;`).
- Change the demo passwords, set a strong `SECRET_KEY`, and set `ENABLE_SIMULATOR=0` before real use.

## Limitations
- Academic prototype: it has no live link to bedside monitors.
- Clinical decision support only, not a substitute for clinical judgement.
- Access is scoped per hospital, not yet per ward.
- Alerts are delivered inside the web app only (no SMS or email).
- Runs as a single application instance.