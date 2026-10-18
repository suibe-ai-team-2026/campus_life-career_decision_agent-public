# Repository instructions

## What this repository is

- Competition main project: `suibe-ai-team-2026/genote` (private). Forked from `turtojian520/genote`.
- The team decided on 2026-10-15 that the competition topic is **校园 AI 知识库助手**, and the technical base is **Next.js (Vercel) + Supabase + Python Deep Agents / LangGraph + Freestyle VM**.
- Genote's original product (考研 / 考公 AI 学习助手) is a **different product**. It is kept as reusable design and implementation reference. Do not present Genote's original scope, subscription model, or Docker / SurrealDB stack as the competition scope.
- Read `docs/product-alignment.md` before changing product docs, prototype copy, or repository description.
- The workspace repository `suibe-ai-team-2026/ai-agent-competition-2026` holds meetings, decisions, task Issues and submission materials. Decisions there override documents here; do not copy meeting records into this repository.

## Workflow

- Work on short-lived branches (`feat/<issue>-<slug>`, `fix/<issue>-<slug>`, `docs/<issue>-<slug>`) and merge through PRs into `main`. Delete branches after merge.
- Keep `prototype/` runnable as plain static files (React 18 + Babel CDN). Do not introduce a build step for it.
- Do not add framework dependencies, cloud resources or paid API calls unless the task explicitly asks for that work.
- User-facing documentation is written in Chinese.

## Secrets and data

- Never commit `.env`, keys, tokens, real student data, or unlicensed course materials. `.env.example` documents variable names only.
- Do not put Supabase / Freestyle credentials in client code, logs or screenshots.

## Verification

- Prototype: serve `prototype/` over HTTP and confirm it renders (see README). `file://` does not work because Babel loads `.jsx` via XHR.
- No automated test suite exists yet. Report what was actually run; do not claim tests that were not executed.

## License

- No license is granted. The repository is private; do not add a license file without the team's confirmation.
