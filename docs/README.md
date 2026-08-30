# Documentation

## Navigation

### product/ — The contract and its supporting references

**`product/prd.md` is the single source of truth — the product contract.** Every
other doc below is a reference that derives from it, or a record of what happened;
none of them overrides it. Each carries `contract: docs/product/prd.md` in its
frontmatter.

| File | What |
|------|------|
| [prd.md](product/prd.md) | **THE CONTRACT** — architecture blueprint. Split into the wiki/ pages below; the pre-split original is frozen at [archive/prd.md](archive/prd.md) |
| [vision.md](product/vision.md) | Product purpose, principles, boundaries |
| [assumptions.md](product/assumptions.md) | Constraints, risks, open questions |
| [research.md](product/research.md) | Platform feasibility research (Android, iOS, Windows, macOS, Linux) |
| [ios-exploration.md](product/ios-exploration.md) | iOS translation layer design — WDA XML → Android node shape → shared prune pipeline. Phase 3.2: usbmux.js + auto-connect. Phase 3.3: CLI + MCP integration, cert tracking, setup wizard. **iOS = QA only** (USB required on Linux). |

### wiki/ — Pages derived from the contract
| File | What |
|------|------|
| [module-reference.md](wiki/module-reference.md) | Per-file walkthrough of every module in `src/` plus the two entry points |
| [platforms.md](wiki/platforms.md) | Android and iOS support, connectivity modes, integration with multis |
| [testing.md](wiki/testing.md) | Test suite composition and the device flows verified end to end |
| [capabilities.md](wiki/capabilities.md) | What the agent drives unaided, what needs help, known limitations |
| [project-record.md](wiki/project-record.md) | Design decisions, roadmap, comparison with alternatives, references |

### logs/ — History: what changed, and why
| File | What |
|------|------|
| [code-review-fixes.md](logs/code-review-fixes.md) | Phased plan to fix all Critical + Important findings from the v0.7.13 code review and ship targeted enhancements. |
| [library-conventions-compliance.md](logs/library-conventions-compliance.md) | Phased plan to comply with `LIBRARY_CONVENTIONS.md` — JSDoc→`.d.ts` types toolchain (§2), package shape, doc set, and push/PR CI. |
| [implementation-log.md](logs/implementation-log.md) | What was built and when |
| [decisions-log.md](logs/decisions-log.md) | Key architectural and design decisions with rationale |
| [bug-log.md](logs/bug-log.md) | Known bugs, root causes, and fixes |
| [validation-log.md](logs/validation-log.md) | POC and E2E validation results by module |
| [insights.md](logs/insights.md) | Patterns and lessons learned |

### product/ — Process and usage references (same bucket, grouped by job)
| File | What |
|------|------|
| [cli-guide.md](product/cli-guide.md) | **Complete CLI reference** — all commands, options, setup wizard steps, iOS prerequisites, JSON mode, troubleshooting |
| [dev-setup.md](product/dev-setup.md) | **Single reference** — all prerequisites, environment setup, and tests split by platform (Android + iOS). Package summaries, emulator setup, test suites, E2E flows, writing new tests. |
| [dev-workflow.md](product/dev-workflow.md) | Feature workflow, code style, commit conventions |
| [definition-of-done.md](product/definition-of-done.md) | Checklist for completing a feature or phase |
| [llm-prompts.md](product/llm-prompts.md) | System prompts and tool descriptions for agent integration |

### archive/ — Frozen history (never edited, never authoritative)
| File | What |
|------|------|
| [poc-plan.md](archive/poc-plan.md) | Original POC validation criteria (completed, POC deleted) |
| [prd.md](archive/prd.md) | The pre-split 716-line blueprint. Kept because the wiki/ pages cite line ranges into it — not a second source of truth |

### Guides
| File | What |
|------|------|
| [customer-guide.md](product/customer-guide.md) | Module overview, choosing the right module, setup and quick start for each |

## Root-level docs
| File | What |
|------|------|
| [README.md](../README.md) | Public README — install, quick start, API, obstacle course |
| [CHANGELOG.md](../CHANGELOG.md) | Version history |
| [CLAUDE.md](../CLAUDE.md) | Dev rules and project specifics for Claude Code |
| [baremobile.context.md](../baremobile.context.md) | Agent integration guide — patterns, gotchas, examples |
