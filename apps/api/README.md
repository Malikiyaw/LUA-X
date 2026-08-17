# LUA-X API

The LUA-X backend is the server-side control plane for AI generation and future project/Studio integrations.

## Endpoints

- `GET /health` — liveness.
- `GET /ready` — readiness; returns `503` until an AI provider is configured.
- `GET /api/ai/status` — configured provider/model metadata without exposing credentials.
- `POST /api/ai/generate` — compiles a LUA-X prompt, calls NVIDIA, validates the structured JSON plan, and returns a safe plan.

## Start locally

```bash
cp apps/api/.env.example apps/api/.env
# Put the real key into the runtime environment, not Git.
# NVIDIA_API_KEY=...
npm install
npm run dev:api
```

The API listens on `127.0.0.1:4000` by default.

## Generate request

```json
{
  "prompt": "Create a secure server-authoritative sword combat system",
  "projectId": "my-game",
  "context": {
    "relevantFiles": ["ServerScriptService/Combat/CombatService.luau"],
    "relevantInstances": ["ReplicatedStorage.Remotes.Combat"],
    "architecture": "Existing combat service with shared config",
    "constraints": ["Preserve existing damage API"]
  }
}
```

The backend sends project context to the configured NVIDIA model through NVIDIA's OpenAI-compatible `/v1/chat/completions` endpoint and validates the response before returning it. Current defaults are configurable through environment variables. citeturn881813search9turn881813search3

## Secrets

Never commit `NVIDIA_API_KEY`. Use the runtime/deployment secret store. A private GitHub repository is not a substitute for secret management.
