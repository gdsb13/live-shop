# Voice AI modules (`apps/api/src/services/ai*` + `apps/api/src/mcp/`)

Phase 5 uses **Agora managed Conversational AI + MCP** for private voice shopping.

## Architecture

```
Shopper microphone
  → private Agora RTC channel (ai-{shopperUserId})
  → Agora Conversational AI
      STT: Deepgram nova-3
      LLM: Agora-managed OpenAI (keyless)
      Tools: Agora orchestrates MCP → POST /mcp
      TTS: MiniMax speech_2_6_turbo
  → MCP adapter (thin protocol boundary)
  → validateToolInput → aiToolService → commerce services
  → result back to managed LLM → TTS → shopper
```

Public live RTC (`live-{sessionId}`) is unchanged from Phase 4.

## Responsibility boundary

| Owner | Responsibility |
|-------|----------------|
| **Agora** | RTC transport, STT, managed LLM, tool orchestration, TTS |
| **Customer (this app)** | MCP endpoint, tool validation, commerce services, cart |
| **MCP** | Protocol adapter only — no business logic |

## File map

| File | Role |
|------|------|
| `mcp/mcpHttp.js` | Streamable HTTP MCP transport on `/mcp` |
| `mcp/createCommerceMcpServer.js` | Registers 8 commerce tools with MCP SDK |
| `mcp/commerceToolRunner.js` | Thin adapter → `aiToolService` |
| `mcp/mcpConfig.js` | `MCP_ENDPOINT` / `buildMcpServers()` for Agora agent |
| `services/aiService.js` | Agora agent lifecycle (managed OpenAI + MCP) |
| `services/aiToolDefinitions.js` | Tool schemas + allowlist |
| `services/aiToolValidation.js` | Validate tool args |
| `services/aiToolService.js` | Dispatch → commerce services |

## Session context

Each Agora agent is started with `mcp_servers.headers['X-Voice-Channel'] = ai-{shopperUserId}`.
The MCP adapter resolves the active voice session from that header so `cartUpdated` and live
context stay tied to the correct shopper session.

Prototype cart state is still process-global (`cartService`); production would use per-shopper carts.

## Required configuration

| Variable | Purpose |
|----------|---------|
| `AGORA_APP_ID` / `AGORA_APP_CERTIFICATE` | Agora RTC + Conversational AI |
| `AI_PUBLIC_BASE_URL` or `MCP_ENDPOINT` | Public HTTPS URL Agora reaches for `/mcp` |
| `OPENAI_MODEL` | Managed OpenAI model (default `gpt-4o-mini`) |
| `AGORA_AI_AREA` | Agora Conversational AI data center |

No `OPENAI_API_KEY` or `AI_LLM_API_KEY` is required for the default keyless managed LLM path.
