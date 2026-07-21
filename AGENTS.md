# AGENTS.md — EasyLearn

Guide for humans and AI agents working in this repository.

## What this is

**EasyLearn** is an LTI 1.3 web app that generates structured quizzes from Canvas course materials (PDF/PPTX) using Google Gemini or OpenRouter, then deploys them back to Canvas. Most behavior is tied to Canvas auth, course context, and the LTI launch flow.

## Repo map

| Path | Purpose |
|------|---------|
| `main.py` | FastAPI entrypoint, middleware, health endpoints (`/healthz`, `/readyz`) |
| `app/routers/` | Route modules (`api`, `oauth`, `lti_routes`, `pages`) |
| `app/dependencies.py` | FastAPI `Depends()` helpers for course ID and Canvas client |
| `app/` | Application logic (Canvas API, LTI adapter, quiz generation, storage) |
| `app/config.py` | All environment variables — single source of truth |
| `app/lti.py` | FastAPI adapter for `pylti1p3` |
| `app/schemas.py` | Pydantic models (`WeeklyQuiz`, `GeneratedQuestion`, etc.) |
| `config/lti_config.json` | LTI tool registration (copy from `lti_config.example.json`) |
| `docker-compose.yml` | Production Docker Compose deployment |
| `Dockerfile` | Container image |
| `keys/` | RSA keypair for LTI signing (gitignored) |
| `cache/` | Downloaded files and quiz drafts (gitignored) |
| `templates/` | Dashboard HTML templates |
| `static/` | Static CSS/JS assets and logo |
| `utils/` | System configuration tools (`configure_lti.py`, `configure_oauth.py`) |
| `docs/` | DevOps Deployment Guide (`deployment.md`) |

## Dev workflow

```bash
cp .env.example .env
cp config/lti_config.example.json config/lti_config.json
uv sync
uv run utils/configure_oauth.py --write-env
docker compose up -d --build
```

Bare-metal: `uv run main.py` after the same `.env` setup.

- Python >= 3.14, dependencies via **`uv`** only.
- Never commit `.env`, `keys/*.key`, or `cache/` contents.
- `CANVAS_API_TOKEN` is CLI-only; the web app uses LTI + per-professor OAuth.

## Agent guardrails

- Extend logic in `app/`, not a resurrected `scripts/` package.
- Keep routes thin in `main.py`; put business logic in `app/*`.
- New env vars → `app/config.py` + `.env.example`.
- Do not log tokens, OAuth codes, or extracted course text.
- Do not disable LTI/OAuth validation or CSRF checks.
- Do not commit secrets — grep diffs before merge.
- Always run static syntax checks after JS changes (`node -c static/js/*.js`) and Python edits (`uv run python -m py_compile ...`) before claiming task completion.

## LTI endpoints (do not rename casually)

| Endpoint | Role |
|----------|------|
| `/login` | OIDC login initiation |
| `/launch` | LTI launch handler |
| `/jwks` | Public JWK set for Canvas |
| `/oauth/callback` | Canvas OAuth2 (multi-instructor mode) |

Canvas Developer Key URLs must match the deployed host exactly when going live.

## Deploy

Primary path: [docker-compose.yml](./docker-compose.yml) + [docs/deployment.md](./docs/deployment.md).
