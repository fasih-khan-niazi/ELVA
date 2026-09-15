# ELVA — Frontend Spec

Concise reference for building UI that fits this repo (e.g. v0, handoffs). Paths are from **repo root**; app code lives under **`frontend/`**.

---

## 1. App summary

**ELVA** is a multi-tenant **AI agent SaaS**. Tenants create **chat** and/or **voice** agents, chat in-browser, attach **knowledge-base documents**, and operate **orders**, **leads**, and **analytics** per agent. **Outbound campaigns** (voice dialer) and **connected apps** (Slack, email, webhook triggers) extend automation. **Stripe-style** subscription gating applies to the main product.

**In scope on the frontend:** marketing (`Home`, `About`), auth (`Login`), subscription + payment success, dashboard hub, agent create/edit, chat with session history, voice analytics + per-agent call history, CRM-style orders/leads, analytics dashboards, campaign list/create/detail, knowledge-base file UI, global + per-agent connected apps.

---

## 2. Stack & structure

| Topic | Detail |
|--------|--------|
| Runtime | React 18, TypeScript |
| Build | Vite (`frontend/vite.config` pattern) |
| Routing | `react-router-dom` v6 — `BrowserRouter`, `Routes`, `Route`, `Navigate` in `frontend/src/App.tsx` |
| Component library | **[shadcn/ui](https://ui.shadcn.com)** — `components.json` at `frontend/components.json`; UI primitives in **`frontend/src/components/ui/`** (e.g. `button.tsx`). CLI: `npx shadcn@latest add <name>` from **`frontend/`** |
| Styling | Tailwind CSS 3; custom **`ocean.*`** colors + **shadcn semantic tokens** (`background`, `primary`, `border`, …) in `frontend/tailwind.config.js`; globals + CSS variables in `frontend/src/index.css` (`@import "shadcn/tailwind.css"`, Geist variable font) |
| Icons | `lucide-react` (also default for shadcn CLI) |
| Class helpers | `clsx`, **`tailwind-merge`**, **`cn()`** from **`@/lib/utils`**; **`class-variance-authority`** for component variants |
| Notifications | `react-hot-toast` + `ToastProvider` / `useToast` in `frontend/src/components/Toast.tsx` |
| Auth state | `frontend/src/context/AuthContext.tsx` — `useAuth()` exposes `user`, `token`, `subscription`, `login`, `logout`, `refreshSubscription`, etc. |
| API calls | `fetch` to **`import.meta.env.VITE_API_URL || 'http://localhost:3000'`**, header `Authorization: Bearer ${token}` |
| Other deps | `@supabase/supabase-js`, `@twilio/voice-sdk` (voice flows); **`@base-ui/react`** (shadcn primitives); **`tw-animate-css`**, `@fontsource-variable/geist` (shadcn theme) |

**Path alias**

- **`@/` → `frontend/src/`** — use for imports like `@/components/ui/button`, `@/lib/utils`. Configured in `frontend/tsconfig.json` (`paths`) and `frontend/vite.config.ts` (`resolve.alias`).

**Folders**

- `frontend/src/pages/` — screen components (default export)
- `frontend/src/components/` — shared + `agent/` + `connectors/` + **`ui/`** (shadcn-generated)
- `frontend/src/hooks/`, `frontend/src/lib/` — **`utils.ts`** (`cn` helper) and `supabase.ts`

**Route guards (in `App.tsx`)**

- **`ProtectedRoute`** — user authenticated **and** `subscription` present → main app.
- **`AuthRoute`** — authenticated only → `/subscription`, `/payment-success` (no subscription required to view those flows).

**Shell:** `Navbar` is hidden on `/login` (full-height login layout). Most routes use gradient background classes set in `AppRoutes`.

**shadcn (generated UI)**

- From **`frontend/`**: `npx shadcn@latest add <component>` (e.g. `button`, `card`, `input`, `dialog`) — primitives land in **`src/components/ui/`**.
- Imports use the **`@/`** alias, e.g. `import { Button } from "@/components/ui/button"`.
- Merge Tailwind classes with **`import { cn } from "@/lib/utils"`**.
- **Branding:** global **`body`** keeps **`ocean-powder` / `ocean-deep`**; use **`ocean.*`** for ELVA chrome and shadcn tokens (`bg-card`, `border-border`, `text-foreground`, `primary`, …) inside composed UI so controls stay on-system.
- Source of truth for style/registries: **`frontend/components.json`**.

---

## 3. Routes & pages

| Path | File (`frontend/src/pages/`) | Purpose |
|------|------------------------------|--------|
| `/` | `Home.tsx` | Landing, pricing plans from API |
| `/about` | `About.tsx` | Product narrative |
| `/login` | `Login.tsx` | Sign-in; redirect if already logged in |
| `/subscription` | `Subscription.tsx` | Plan selection / billing (auth) |
| `/payment-success` | `PaymentSuccess.tsx` | Post-checkout (e.g. `session_id` query) |
| `/dashboard` | `Dashboard.tsx` | Agent grid, usage, subscription summary, links, voice test |
| `/create-agent` | `CreateAgent.tsx` | New agent wizard |
| `/agents/:agentId/edit` | `EditAgent.tsx` | Edit agent + catalog as wired |
| `/chat/:agentId` | `Chat.tsx` | Live chat, session sidebar, history read-only mode |
| `/voice-analytics` | `VoiceAnalytics.tsx` | Org voice KPIs, time series, alerts |
| `/voice-history/:agentId` | `VoiceCallHistory.tsx` | Sessions + turn transcripts |
| `/orders/:agentId` | `OrdersPage.tsx` | Orders pipeline, stats, status updates |
| `/leads/:agentId` | `LeadsPage.tsx` | Leads, scoring, filters, manual add |
| `/analytics/:agentId` | `AnalyticsPage.tsx` | Combined metrics, date range |
| `/campaigns` | `CampaignsPage.tsx` | Campaign cards, filters, DNC modal |
| `/campaigns/create` | `CreateCampaignPage.tsx` | AI / template / manual builder |
| `/campaigns/:id` | `CampaignDetailPage.tsx` | Run campaign, contacts, stats, controls |
| `/agents/:agentId/knowledge-base` | `AgentKnowledgeBasePage.tsx` | Upload/list/delete docs, quota |
| `/connectors` | `ConnectorsPage.tsx` | All tenant connected apps + stats (URL unchanged) |
| `/agents/:agentId/connectors` | `AgentConnectorsPage.tsx` | Per-agent connected apps, wizard, logs |
| `/profile` | `Profile.tsx` | Profile, workspace, team invites, invite email-domain policy (company admins) |
| `/docs` | `DocsPage.tsx` | Documentation hub |
| `/docs/:slug` | `DocsPage.tsx` | Guide article + sidebar |
| `/legal/terms` | `TermsPage.tsx` | Terms of Service (markdown) |
| `/invite/:token` | `AcceptInvite.tsx` | Accept invite: password + terms |

---

## 4. Key components

| Component | Role |
|-----------|------|
| `Navbar` | Brand, nav links, user email, sign out; mobile menu |
| `VoiceTestPanel` | Embedded voice test on dashboard |
| `Toast` / `useToast` | Styled toasts wrapping react-hot-toast |
| `CatalogManager` | Catalog UI in agent flows |
| `SetupMethodSelector`, `AIQuickSetup`, `ManualSetupForm`, `TemplateSelector`, `FieldWithHistory` | Agent onboarding / editing |
| `ConnectorWizard`, `TemplateGallery`, `ConnectorLogs` | Connected app creation, templates, delivery logs |
| **`components/ui/*`** | shadcn-generated primitives (`button`, …) — add with `npx shadcn@latest add …` |

---

## 5. Data shapes (reference)

Use these for mocks and props; authoritative types are the `interface` blocks in each page file.

**Auth** (`AuthContext.tsx`)

```ts
type User = { id: string; email: string; role: string; tenantId: string };
type Subscription = { plan: string; status: string; currentPeriodEnd?: string };
```

**Chat** (`Chat.tsx`)

```ts
type Message = {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  latencyMs?: number;
};
type SessionSummary = {
  _id: string; sessionId: string; title: string; messageCount: number;
  updatedAt: string; createdAt: string;
};
```

**Agent** (`Dashboard.tsx`, `Chat.tsx`)

```ts
type Agent = {
  _id: string; name: string; type: 'chat' | 'voice';
  tone: string; language: string; prompt: string;
  phoneNumber?: string; callDirection?: 'inbound' | 'outbound';
  outboundCallerId?: string; sttProvider?: 'twilio' | 'google';
  ttsProvider?: 'twilio' | 'google'; ttsVoice?: string;
};
```

**Dashboard subscription payload** (`Dashboard.tsx` — `SubscriptionData`)

```ts
type SubscriptionData = {
  subscription: {
    plan: string; status: string; currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
  };
  usage: {
    agents: { used: number; limit: number };
    documents: { used: number; limit: number };
    messages: { used: number; limit: number };
  };
  features: {
    voiceEnabled: boolean; analyticsEnabled: boolean;
    prioritySupport: boolean; maxDocumentSizeMB: number;
  };
};
```

**Notifications** (`Dashboard.tsx`) — `Record<agentId, { orders: number; leads: number }>`.

**Lead** (`LeadsPage.tsx`) — `_id`, `agentId`, `sessionId`, `channel: 'chat'|'voice'`, `status: 'new'|…|'lost'`, `score`, optional contact fields, `interest`, `source`, `tags`, ISO dates.

**Order** (`OrdersPage.tsx`) — `_id`, `agentId`, `sessionId`, `channel`, `status` (pending → cancelled), `items[]` (`name`, `price`, `quantity`, optional `options`, `notes`), `subtotal`, `tax`, `total`, optional customer fields, ISO dates.

**Campaign (list)** (`CampaignsPage.tsx`) — `_id`, `name`, `description`, `status`, `goal`, `creationMethod?`, `totalContacts`, `agentId: { _id, name } | null`, `stats` (dialer counters + `connectedCalls`, `totalCallDurationSec`), `createdAt`.

**Connected app** (stored as `Connector` in API) (`ConnectorsPage.tsx` / `AgentConnectorsPage.tsx`) — `_id`, `name`, `status: 'active'|'paused'|'failed'`, `trigger`, `destination: { type: 'slack'|'email'|'webhook' }`, `deliveryMode`, `stats`, `failureAlert`, `agentId`, `createdAt`.

**Analytics API response** (`AnalyticsPage.tsx` — `AnalyticsData`) — `agent` summary, `range` days, nested `orders` / `leads` (totals, `byStatus`, timelines, `topItems`, revenue), `catalog`, `documents`.

**Knowledge base** (`AgentKnowledgeBasePage.tsx`) — `KBDocument`: `_id`, `filename`, `fileSize`, `contentType`, `createdAt`; quota type `DocQuota` from `/api/upload/remaining`.

**Voice** (`VoiceCallHistory.tsx`) — `VoiceSession` (call ids, channel, status, timing); `VoiceTurn` (`turnIndex`, `inputTranscript`, `aiResponse`, `latencyMs`, `sloOk`, etc.).

**Home plans** (`Home.tsx`) — `Plan`: `id`, `name`, `price`, `features` (limits, booleans for voice/analytics/support).

---

## 6. Page context (short)

**Marketing:** `Home` loads plans from `/api/subscription/plans`; `About` is static story + CTAs.

**Auth & billing:** `Login` sets token/user; `Subscription` and `PaymentSuccess` sit behind `AuthRoute`. Full app screens use `ProtectedRoute`.

**Hub:** `Dashboard` lists agents with actions to chat, orders, leads, analytics, KB, connected apps, voice routes; shows usage and optional notification badges per agent.

**Agents:** `CreateAgent` / `EditAgent` use shared agent components + `CatalogManager` where applicable.

**Chat:** `Chat` maintains a live `sessionId` (regenerated on “New Chat”); sidebar lists `SessionSummary`; loading a past session is read-only for input.

**Voice:** `VoiceAnalytics` is tenant-wide observability; `VoiceCallHistory` is per-agent sessions and expandable turns.

**Commerce:** `OrdersPage` and `LeadsPage` use status badges, filters, expand rows, PATCH-style updates via existing API patterns.

**Campaigns:** `CampaignsPage` includes DNC list modal; `CreateCampaignPage` is stepped (AI/template/manual); `CampaignDetailPage` is the heavy operational UI.

**Knowledge & connected apps:** KB page handles upload queue, delete confirm, resync; connected app pages list rows, toggle status, open wizard/logs.

---

## 7. Guidelines for UI generators

1. Stay on **React + TS + Tailwind + lucide**. Use **[shadcn/ui](https://ui.shadcn.com)** primitives under **`@/components/ui`** for new buttons, forms, dialogs, menus, etc.; add missing ones via **`npx shadcn@latest add …`** in **`frontend/`**.
2. Reuse **`ocean.*`** for marketing surfaces, nav, and gradients; combine with shadcn semantic classes using **`cn()`** so layouts match ELVA + shadcn together.
3. Place new screens in **`frontend/src/pages/`** (PascalCase); register in **`App.tsx`** with **`ProtectedRoute`** or **`AuthRoute`** as appropriate.
4. Prefer **`useAuth()`** + **`useToast()`** over ad-hoc globals; keep **`VITE_API_URL`** pattern for `fetch`.
5. Keep new UI **modular** (sections/cards) so it can drop into existing pages.
6. **Do not add** extra npm libraries beyond what the repo already uses **unless** they are required for a shadcn add step or explicitly requested.
7. **Do not invent** routes or product areas not listed in §3; extend existing types from page files instead of guessing API contracts.
