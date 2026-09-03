# Live Shop

Working prototype: multi-category web commerce, live shopping, and a voice-AI assistant. **Current delivery: Phase 5 — Voice AI shopping assistant.**

Cart state is in-memory on the API process. Restarting the API clears the cart. In production this would use persistent customer/cart/order infrastructure.

## Prerequisites

- Node.js **20.19+** (`.nvmrc`)
- pnpm 9 (install script enables it via corepack if needed)
- **Chrome or Edge** for Voice AI (Web Speech API in local mode)
- Microphone permission in the browser

## Run

```bash
./scripts/install.sh
./scripts/start.sh
./scripts/status.sh
./scripts/stop.sh
```

Aliases: `pnpm install:app`, `pnpm start:app`, `pnpm stop:app`, `pnpm status:app`.

| Process | URL |
| --- | --- |
| Storefront | http://localhost:3000 |
| API health | http://localhost:3001/health |
| AI status | http://localhost:3001/api/ai/status |

Both bind `0.0.0.0`. Open from Windows with `localhost` (do not use a WSL IP). Copy `.env.example` to `.env` only if you need to change ports.

Logs: `logs/api.log`, `logs/web.log`.

## Phase 5 — Voice AI quick start (local mode)

This works **without ngrok** using browser speech + backend commerce tools.

### 1. Install and start

```bash
cd /opt/gb/live-shop   # or your clone path in WSL
./scripts/install.sh
./scripts/stop.sh      # if already running
./scripts/start.sh
```

### 2. Verify backend

```bash
./scripts/test-phase5.sh
```

All lines should show `PASS:`.

### 3. Storefront demo (Acceptance A)

1. Open http://localhost:3000 in **Chrome or Edge**.
2. Click **Ask AI** (bottom-right), allow microphone.
3. Wait for **Listening** state.
4. Say each phrase clearly (pause between turns):

| Step | Say this | Expected |
| --- | --- | --- |
| 1 | “I need a good pair of noise cancelling headphones.” | Recommends Sony / similar from catalogue |
| 2 | “How much is the Sony one?” | Price around ₹26,990 |
| 3 | “Can you deliver to 201014?” | Serviceable / delivery OK |
| 4 | “What payment options do I have?” | UPI, card, COD, etc. |
| 5 | “Add the Sony headphones to my cart.” | Cart icon count increases |

5. Open **Cart** in the header to confirm the Sony item is there.
6. Click **Stop** on the assistant panel.

### 4. Live shopping demo (Acceptance B)

1. In one tab: http://localhost:3000/host → start/go live on `live-tech-tuesday` (or any LIVE session).
2. In another tab: http://localhost:3000/live/live-tech-tuesday
3. Confirm seller video/audio plays.
4. Click **Ask AI** — seller audio should duck (get quieter).
5. Ask about the featured product, compare with another TV/headphones, add to cart.
6. Confirm cart updates; click **Stop** — seller audio returns.

### 5. Optional — full Agora cloud voice

Local mode is enough for the assignment tool/cart path. For real Agora STT/TTS/agent audio:

1. Install [ngrok](https://ngrok.com/) or similar.
2. Expose the API: `ngrok http 3001`
3. Copy the **HTTPS** URL into `.env`:
   ```env
   AI_PUBLIC_BASE_URL=https://YOUR-ID.ngrok-free.app
   ```
4. Restart: `./scripts/stop.sh && ./scripts/start.sh`
5. Check http://localhost:3001/api/ai/status → `"mode":"agora"`
6. Repeat the voice demo; audio goes through Agora private RTC channel `ai-shopper-ai-...`

Requires **Conversational AI** enabled on your Agora project in Console.

## Environment (`.env`)

| Variable | Required | Purpose |
| --- | --- | --- |
| `AGORA_APP_ID` | Yes (live + cloud voice) | Agora project |
| `AGORA_APP_CERTIFICATE` | Yes (server only) | Token + agent start |
| `AI_PUBLIC_BASE_URL` | No | Empty = local voice mode; HTTPS URL = Agora cloud voice |
| `AI_CUSTOM_LLM_API_KEY` | No | Bearer auth for Custom LLM endpoint (default `live-shop-ai-key`) |
| `AGORA_AI_AREA` | No | Conversational AI region (default `AP`) |

Never put `AGORA_APP_CERTIFICATE` in the frontend or commit real secrets.

## Tests

```bash
pnpm test:phase3   # live sessions regression
pnpm test:phase4   # Agora RTC regression
pnpm test:phase5   # Voice AI tools + local session
```

Automated tests do **not** validate microphone/STT/TTS — use the manual steps above.

## Layout

| Path | Role |
| --- | --- |
| `apps/web` | Next.js storefront (TypeScript) |
| `apps/api` | Express API (JavaScript, no compile step) |
| `docs/` | Assignment, architecture, plan, decisions, traceability, status |

Prototype commerce uses JSON seeds and in-memory state. In production those same Express services would call the customer’s catalogue, inventory, pricing, cart, order and payment systems.

## Documentation

`docs/ImplementationPlan.md`, `docs/Architecture.md`, `docs/done.md`, `docs/Decisions.md` (ADR-016–018 for Voice AI).
