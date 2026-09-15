# ELVA

**Easy Live Virtual Agent** is a multi-tenant SaaS platform for businesses to create, deploy, and operate AI **chat** and **voice** agents in a few steps.

Teams register a workspace, configure an agent (persona, knowledge base, catalog), then go live on their website, over the phone, or through tools they already use (Slack, email, webhooks, WhatsApp).

---

## What you can do

- **Chat agents:** in-dashboard testing plus a public website embed widget
- **Voice agents:** inbound and outbound phone calls (Twilio), browser voice testing, real-time STT/TTS
- **Knowledge:** PDF and text ingestion with RAG so answers stay grounded in your documents
- **Catalog, orders, and leads:** agents can take orders and capture leads during a conversation
- **Connectors:** notify Slack, email, WhatsApp, or a webhook when an order, lead, or call event fires
- **Campaigns:** outbound dialer with contact lists, DNC, calling hours, and post-call analysis
- **Workspaces:** invites, roles, audit log, and plan-based limits
- **Billing:** Stripe subscriptions (Free, Starter, Pro, Enterprise)

---

## Architecture

Three services in one monorepo:

| Service | Stack | Port | Role |
|---------|--------|------|------|
| **frontend** | React 18, Vite, TypeScript, Tailwind | 5173 | Dashboard, marketing, docs |
| **backend** | Node.js 20, Express, TypeScript, MongoDB | 3000 | Auth, REST API, webhooks, voice WebSocket |
| **ai_service** | Python 3.11, FastAPI, LangChain | 8000 | RAG, LLM chat, voice AI, document ingest |

```
Browser / website widget ──► Frontend (5173)
                                 │
                                 ▼
                           Backend (3000) ──► MongoDB
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
              AI service     Supabase      Stripe / Twilio
                (8000)      (vectors +     SendGrid / Slack
                             files)        Deepgram / Azure
```

The dashboard talks only to the backend. The backend calls the AI service. The AI service posts orders and leads back to the backend over an internal API.

---

## Integrations

| Product | Used for |
|---------|----------|
| MongoDB | Workspaces, users, agents, CRM, campaigns |
| Supabase | Document storage and pgvector RAG |
| Groq | Primary LLM |
| Google Gemini | Embeddings (optional) |
| Ollama | Local LLM / embedding fallback |
| Twilio | PSTN, Media Streams, browser voice |
| Deepgram | Real-time speech-to-text |
| Azure Speech | Neural text-to-speech |
| Stripe | Plans, checkout, customer portal |
| SendGrid | Verification, password reset, connector email |
| Google OAuth | Sign-in |
| Slack | OAuth, alerts, interactivity |
| WhatsApp (Meta) | Connector destination |

---

## Quick start

### Prerequisites

- Node.js 20+
- Python 3.11+
- MongoDB 7+
- API keys for the providers you want to use (see `.env.example` in each service)

### 1. Environment files

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
cp ai_service/.env.example ai_service/.env
```

Fill in secrets. These pairs **must match**:

| backend | other service |
|---------|----------------|
| `INTERNAL_API_SECRET` | `ai_service` `INTERNAL_API_SECRET` |
| `AI_SERVICE_SECRET` | `ai_service` `AI_SERVICE_SECRET` |
| `GOOGLE_CLIENT_ID` | frontend `VITE_GOOGLE_CLIENT_ID` |

### 2. Run locally (three terminals)

```bash
# Terminal 1 - AI service
cd ai_service
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000

# Terminal 2 - Backend
cd backend
npm install
npm run dev

# Terminal 3 - Frontend (Vite proxies /api to backend)
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

Voice testing over the public internet needs a tunnel (`ngrok http 3000`) and `BASE_URL` set in `backend/.env`.

### Docker (optional)

```bash
docker compose up --build
```

Populate `backend/.env` and `ai_service/.env` first. MongoDB is included in Compose.

---

## Project structure

```
ELVA/
├── frontend/              React dashboard (Vite)
├── backend/               Express API + voice WebSocket
│   └── public/embed/      Website chat widget (elva-chat.js)
├── ai_service/            FastAPI RAG + LLM
├── .github/workflows/     CI
├── docker-compose.yml
├── supabase_schema.sql    pgvector schema for RAG
└── README.md
```

---

## Typical flow

1. Sign up (email or Google) and verify email
2. Choose a plan
3. Create a **chat** or **voice** agent (AI quick setup, template, or manual)
4. Upload knowledge-base PDFs and optional product catalog
5. Go live:
   - **Website:** publish an embed key and paste the widget snippet
   - **Phone:** assign a Twilio number
   - **Connectors:** Slack / email / webhook / WhatsApp on order, lead, or call events
6. Operate from the dashboard: chats, orders, leads, analytics, campaigns

---

## Auth and tenancy

- JWT in an HttpOnly cookie (`elva_token`); Bearer tokens are used for saved-account switching and the public widget
- Roles: `business_admin`, `member`, `platform_admin` (ELVA operators)
- One **tenant** (workspace) per business; members join by invite
- Plans gate agent count, messages, documents, voice, analytics, connectors, and seats

---

## Testing and CI

```bash
cd backend && npm test
cd frontend && npm run lint && npm run build
```

GitHub Actions runs backend tests, frontend lint/build, and an AI service import check on every push and pull request.

---

## Security notes

- Never commit `.env` files. They are gitignored. Use the `.env.example` templates.
- Shared secrets between backend and AI service are required in production.
- `ELVA_DEV_INSECURE=1` is for local development only.
- Twilio and Slack webhooks are signature-verified.

---

## Docs in this repo

- `FRONTEND_SPEC.md`: frontend structure and UI conventions
- `supabase_schema.sql`: vector table and `match_documents` RPC
- `voice-analytics-guide.html`: voice analytics notes
- `ELVA_PROJECT_AUDIT.html`: technology inventory and audit notes
