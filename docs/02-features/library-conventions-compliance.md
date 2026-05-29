# Library Conventions Compliance Plan

**Status:** Drafted 2026-05-29, awaiting execution
**Source:** `LIBRARY_CONVENTIONS.md` (org advisory) audited against `main` at `509cb4f`
**Scope:** Adopt the JSDoc → `.d.ts` → CI no-drift types convention (§2) and close the
remaining package-shape (§1), doc-set (§4), and CI (§5) gaps. No production runtime change.
**Aurora plan:** `.aurora/plans/active/comply-library-conventions/` (plan.md / prd.md / tasks.md / agents.json)

---

## Where baremobile already complies ✅

- Pure ESM JS, no build step for shipped code; **zero** production dependencies.
- `package.json`: `type:module`, `main`, `bin`, `engines>=22`.
- `publish.yml` matches `publish.template.yml` byte-for-byte — npm OIDC trusted
  publishing, idempotent, manual `workflow_dispatch`, end-state verification,
  `typecheck --if-present` before tests.
- `baremobile.context.md` exists, correctly named, ships in `files`.
- README + CHANGELOG (keep-a-changelog) present; `CLAUDE.md` + `docs/` correctly repo-only.

## Gaps to close ❌

| # | Conv. | Gap |
|---|-------|-----|
| 1 | §2 | No `tsconfig.json` (checkJs + strictNullChecks toolchain) |
| 2 | §2 | `typescript` + `@types/node` not in devDependencies |
| 3 | §2 | Missing scripts: `typecheck`, `build:types`, `prepublishOnly` |
| 4 | §2 | `/types/` not in `.gitignore` |
| 5 | §2/§1 | `exports` has no `types` condition on `.` or `./ios`; no top-level `types` |
| 6 | §2/§1 | `files` doesn't ship `types/` |
| 7 | §2 | JSDoc gaps — `tsc --noEmit` not yet clean (`ios-cert.js` has 0 JSDoc blocks) |
| 8 | §4 | `files` doesn't ship `CHANGELOG.md` |
| 9 | §5 | No `ci.yml` (push/PR gate) |

---

## Phase 1 — Types toolchain (§2 recipe 1–4)

Goal: stand up the dev-only types pipeline. No source changes yet.

- `npm install -D typescript @types/node` (dev-only).
- Add `tsconfig.json`: `allowJs`, `checkJs`, `declaration`, `emitDeclarationOnly`,
  `declarationDir:./types`, `rootDir:./src`, `module/moduleResolution:nodenext`,
  `target:es2022`, `lib:[es2023]`, `types:[node]`, `skipLibCheck`, `strict:false`,
  `strictNullChecks:true`; `include:[src/**/*.js]`; `exclude:[types,node_modules]`.
- Add scripts: `typecheck:"tsc --noEmit"`, `build:types:"tsc"`,
  `prepublishOnly:"npm run build:types"`.
- Add `/types/` to `.gitignore`.

**Exit criteria:** `npm run build:types` emits `types/*.d.ts`; `git status` ignores them.

## Phase 2 — Drive typecheck to zero (§2 recipe 5–7)

Goal: make the JSDoc a checked contract. **Only phase that touches `src/`** — and only
JSDoc comments + minimal behavior-preserving null guards (never `!`, `as any`, `@ts-ignore`).

- Run `npm run typecheck`; capture the full error inventory.
- Fix JSDoc gaps starting with `src/ios-cert.js` (0 blocks), then `prune.js`/`aria.js`/`xml.js`.
- Fix null-safety findings with guards; add `@typedef`s in `src/types.js` if cross-file shapes recur.
- Iterate to exit 0.

**Verification:** full suite (301 unit tests) green — proves no runtime behavior changed.

## Phase 3 — Cross the npm boundary (§2.5 / §1 / §4)

Goal: ship the generated `.d.ts` so adopters get autocomplete + type errors.

- `exports`: `types`-first condition on `.` (→ `types/index.d.ts`) and `./ios` (→ `types/ios.d.ts`).
- Add top-level `"types": "./types/index.d.ts"`.
- `files`: add `types/` and `CHANGELOG.md`.

**Verification:** `npm pack --dry-run` lists `types/*.d.ts` + `CHANGELOG.md`; excludes `CLAUDE.md`/`docs/`.

## Phase 4 — CI push/PR gate (§5)

Goal: turn the contract into a merge gate.

- Add `.github/workflows/ci.yml` on push + pull_request: `npm ci → typecheck → build:types → test`.
  Node 22. **No lint step** (§5 explicitly excludes it for a vanilla-ESM lib).
- `publish.yml` left unchanged (already compliant).

## Phase 5 — Docs + finalize (§4)

- CHANGELOG `[Unreleased]`: note the types toolchain, `ci.yml`, and `files`/`exports` changes.
- Final verification sweep (AC-1..AC-7); commit on a branch; archive the Aurora plan.

---

## Notes & decisions

- `cli.js` / `mcp-server.js` sit outside `rootDir:./src` → not typechecked. Intended:
  they are bin entry scripts, not the typed public API. Do **not** widen `rootDir`.
- Phase 2 effort is unknowable until `tsc` runs once — strictNullChecks could surface
  anywhere from ~zero to a few dozen real findings in `interact`/`prune`/`xml`.
- Optional polish (not required by conventions): ship `NOTICE` (Apache-2.0) via `files`.
