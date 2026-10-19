# Repository instructions

## What this repository is

- Competition main project: `suibe-ai-team-2026/campus_life-career_decision_agent` (private). Forked from `turtojian520/genote`.
- The competition product is named **知途（Campus Pathway）** (decided 2026-10-18). The current implementation branch `feat/career-cloud-wizard` delivers the user-requested pure career-planning version (Next.js/Vercel + Supabase + Freestyle worker + OpenRouter embeddings); see `docs/adr/0001-career-cloud-wizard-scope.md`. The repository slug is `campus_life-career_decision_agent`; the slug is an identifier, not the product name. Use 知途 / Campus Pathway in user-facing copy, the PRD and submission materials.
- The team decided on 2026-10-15 that the competition topic is **校园 AI 知识库助手**, and the technical base is **Next.js (Vercel) + Supabase + Python Deep Agents / LangGraph + Freestyle VM**.
- The fork upstream **Genote** (考研 / 考公 AI 学习助手) is a **different product**. Keep the name Genote only when describing the fork source or its retained reference documents; do not present Genote's original scope, subscription model, or Docker / SurrealDB stack as the competition scope.
- Read `docs/product-alignment.md` before changing product docs, prototype copy, or repository description.
- The workspace repository `suibe-ai-team-2026/ai-agent-competition-2026` holds meetings, decisions, task Issues and submission materials. Decisions there override documents here; do not copy meeting records into this repository.

## Workflow

- Work on short-lived branches (`feat/<issue>-<slug>`, `fix/<issue>-<slug>`, `docs/<issue>-<slug>`) and merge through PRs into `main`. Delete branches after merge.
- `prototype/` is archived reference only; do not present it as the product entry. Keep its files runnable as plain static files (React 18 + Babel CDN) and do not introduce a build step for it.
- The product stack is Next.js 16 / TypeScript / Supabase / Python 3.12 worker; do not add other frameworks or paid API calls unless the task explicitly asks. Real OpenRouter/Supabase calls require user-authorized credentials and budget.
- User-facing documentation is written in Chinese.

## Secrets and data

- Never commit `.env`, keys, tokens, real student data, or unlicensed course materials. `.env.example` documents variable names only.
- Do not put Supabase / Freestyle credentials in client code, logs or screenshots.

## Verification

- Product: `npm run check` (typecheck + lint + vitest + production build) and `cd worker && uv run --python 3.12 pytest -q`.
- Data: `npx tsx scripts/import-research.ts --dry-run` and `npx tsx scripts/build-corpus.ts`; never execute the old `01-import.sql`.
- Prototype (historical): serve `prototype/` over HTTP and confirm it renders. `file://` does not work because Babel loads `.jsx` via XHR.
- Report what was actually run; do not claim tests, migrations, imports or deployments that were not executed.

## License

- No license is granted. The repository is private; do not add a license file without the team's confirmation.
