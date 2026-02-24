# Documentation

## Navigation

### 00-context/ — Why and what exists
| File | What |
|------|------|
| [vision.md](00-context/vision.md) | Product purpose, principles, boundaries |
| [assumptions.md](00-context/assumptions.md) | Constraints, risks, open questions |
| [system-state.md](00-context/system-state.md) | Current architecture, what's built, what's next |
| [research.md](00-context/research.md) | Platform feasibility research (Android, iOS, Windows, macOS, Linux) |
| [ios-exploration.md](00-context/ios-exploration.md) | iOS bridging analysis (pymobiledevice3, WDA, BLE HID). Setup/packages in dev-setup.md |

### 01-product/ — What the product must do
| File | What |
|------|------|
| [prd.md](01-product/prd.md) | Blueprint — full architecture, module details, verified flows, roadmap, design decisions |

### 02-features/ — How features are designed
Reserved for feature-specific deep dives as complexity grows.

### 03-logs/ — Memory (what changed over time)
| File | What |
|------|------|
| [implementation-log.md](03-logs/implementation-log.md) | What was built and when |
| [decisions-log.md](03-logs/decisions-log.md) | Key architectural and design decisions with rationale |
| [bug-log.md](03-logs/bug-log.md) | Known bugs, root causes, and fixes |
| [validation-log.md](03-logs/validation-log.md) | POC and E2E validation results by module |
| [insights.md](03-logs/insights.md) | Patterns and lessons learned |

### 04-process/ — How to work with this system
| File | What |
|------|------|
| [dev-setup.md](04-process/dev-setup.md) | All packages and setup by module: Core ADB, Termux ADB, Termux:API, iOS |
| [testing.md](04-process/testing.md) | Test suites by module, validation status, writing new tests |
| [dev-workflow.md](04-process/dev-workflow.md) | Feature workflow, code style, commit conventions |
| [definition-of-done.md](04-process/definition-of-done.md) | Checklist for completing a feature or phase |
| [llm-prompts.md](04-process/llm-prompts.md) | System prompts and tool descriptions for agent integration |

### archive/ — Old docs preserved
| File | What |
|------|------|
| [poc-plan.md](archive/poc-plan.md) | Original POC validation criteria (completed, POC deleted) |

## Root-level docs
| File | What |
|------|------|
| [README.md](../README.md) | Public README — install, quick start, API, obstacle course |
| [CHANGELOG.md](../CHANGELOG.md) | Version history |
| [CLAUDE.md](../CLAUDE.md) | Dev rules and project specifics for Claude Code |
| [baremobile.context.md](../baremobile.context.md) | Agent integration guide — patterns, gotchas, examples |
