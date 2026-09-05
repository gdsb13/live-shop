# Live Shop

Working prototype: multi-category web commerce, live shopping, and a voice-AI assistant. **Current delivery: Phase 5 — Voice AI shopping assistant.**

Cart state is in-memory on the API process. Restarting the API clears the cart. In production this would use persistent customer/cart/order infrastructure.

## Prerequisites

- Node.js **20.19+** (`.nvmrc`)
- pnpm 9 (install script enables it via corepack if needed)
- **Chrome or Edge** for Voice AI (microphone + Agora WebRTC)
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

## Phase 5 — Voice AI quick start (Agora managed LLM + MCP)

Voice AI requires **Agora Conversational AI**, a public HTTPS MCP endpoint (ngrok), and **no external OpenAI API key** for the default managed LLM path.

### 1. Install and start

```bash
cd /opt/gb/live-shop   # or your clone path in WSL
./scripts/install.sh
./scripts/stop.sh      # if already running
```

### 2. Configure `.env`

```env
AGORA_APP_ID=your-app-id
AGORA_APP_CERTIFICATE=your-certificate
AI_PUBLIC_BASE_URL=https://YOUR-ID.ngrok-free.app
OPENAI_MODEL=gpt-4o-mini
AGORA_AI_AREA=AP
```

MCP endpoint defaults to `{AI_PUBLIC_BASE_URL}/mcp`. Override with `MCP_ENDPOINT` if needed.

### 3. Expose the API (required)

In a separate terminal:

```bash
ngrok http 3001
```

Copy the **HTTPS** URL into `AI_PUBLIC_BASE_URL`, then:

```bash
./scripts/start.sh
```

### 4. Verify backend

```bash
./scripts/test-phase5.sh
```

All lines should show `PASS:`.

### 5. Storefront voice demo

1. Open http://localhost:3000 in **Chrome or Edge**.
2. Click **Ask AI** (bottom-right), allow microphone.
3. Wait for **Listening** state.
4. Say each phrase clearly (pause between turns):

| Step | Say this | Expected |
| --- | --- | --- |
| 1 | “Help me find noise cancelling headphones.” | Recommends Sony from catalogue |
| 2 | “How much is the Sony one?” | Price around ₹26,990 |
| 3 | “Can you deliver it to 201014?” | Serviceable / delivery OK |
| 4 | “Add it to my cart.” | Cart icon count increases |

5. Open **Cart** in the header to confirm the Sony item is there.
6. Click **Stop** on the assistant panel.

### 6. Live shopping demo

1. In one tab: http://localhost:3000/host → start/go live on `live-tech-tuesday` (or any LIVE session).
2. In another tab: http://localhost:3000/live/live-tech-tuesday
3. Confirm seller video/audio plays.
4. Click **Ask AI** — seller audio should duck (get quieter).
5. Ask about the featured product, compare with another TV/headphones, add to cart.
6. Confirm cart updates; click **Stop** — seller audio returns.

Requires **Conversational AI** enabled on your Agora project in Console.

## Environment (`.env`)

| Variable | Required | Purpose |
| --- | --- | --- |
| `AGORA_APP_ID` | Yes | Agora project |
| `AGORA_APP_CERTIFICATE` | Yes (server only) | Token + agent start |
| `AI_PUBLIC_BASE_URL` | Yes | Public HTTPS base URL; MCP served at `/mcp` |
| `MCP_ENDPOINT` | No | Optional override (default `{AI_PUBLIC_BASE_URL}/mcp`) |
| `OPENAI_MODEL` | No | Agora managed OpenAI model (default `gpt-4o-mini`) |
| `AGORA_AI_AREA` | No | Conversational AI region (default `AP`) |

Never put `AGORA_APP_CERTIFICATE` in the frontend or commit real secrets.

## Tests

```bash
pnpm test:phase3   # live sessions regression
pnpm test:phase4   # Agora RTC regression
pnpm test:phase5   # Voice AI commerce tools + MCP protocol tests
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
