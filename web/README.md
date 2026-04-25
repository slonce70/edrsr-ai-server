# EDRSR-AI Web Portal

React + TypeScript portal for authenticated analysis history, job details, AI chat, prompts, workspaces, matters, and public share links.

## Runtime Config

- `VITE_API_BASE` defaults to `/api`.
- `VITE_WS_PATH` defaults to `/ws`.
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` must be set for staging/production.
- Local development keeps a convenience Supabase fallback so `npm run web:dev` can start without extra setup.

## Local Commands

Run from the repository root:

```bash
npm run web:dev
npm run web:lint
npm run web:build
```

## Workspace Realtime

Portal pages fetch workspace jobs with `workspaceId` and pass that same `workspaceId` into WebSocket subscriptions. This keeps realtime updates working for workspace members who did not create the job.

## Source Map

- `src/pages/AnalysesPage.tsx` - job list and workspace-aware subscriptions.
- `src/pages/JobDetailPage.tsx` - job detail, matter linkage, chat, and report views.
- `src/state/WebSocketContext.tsx` - authenticated WebSocket connection and job subscriptions.
- `src/state/AuthContext.tsx` - Supabase session handling.
