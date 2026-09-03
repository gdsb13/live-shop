# Live Shop

Working prototype: multi-category web commerce, live shopping, and a voice-AI assistant. **Current delivery: Phase 2 — commerce foundation.**

Cart state is in-memory on the API process. Restarting the API clears the cart. In production this would use persistent customer/cart/order infrastructure.

## Prerequisites

- Node.js **20.19+** (`.nvmrc`)
- pnpm 9 (install script enables it via corepack if needed)

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

Both bind `0.0.0.0`. Open from Windows with `localhost` (do not use a WSL IP). Copy `.env.example` to `.env` only if you need to change ports.

Logs: `logs/api.log`, `logs/web.log`.

## Layout

| Path | Role |
| --- | --- |
| `apps/web` | Next.js storefront (TypeScript) |
| `apps/api` | Express API (JavaScript, no compile step) |
| `docs/` | Assignment, architecture, plan, decisions, traceability, status |

Prototype commerce (later phases) uses JSON seeds and in-memory state. In production those same Express services would call the customer’s catalogue, inventory, pricing, cart, order and payment systems.

## Documentation

`docs/ImplementationPlan.md`, `docs/Architecture.md`, `docs/done.md`.
