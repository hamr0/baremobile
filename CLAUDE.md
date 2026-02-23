## Dev Rules

**POC first.** Always validate logic with a ~15min proof-of-concept before building. Cover happy path + common edges. POC works → design properly → build with tests. Never ship the POC.

**Build incrementally.** Break work into small independent modules. One piece at a time, each must work on its own before integrating.

**Dependency hierarchy — follow strictly:** vanilla language → standard library → external (only when stdlib can't do it in <100 lines). External deps must be maintained, lightweight, and widely adopted. Exception: always use vetted libraries for security-critical code (crypto, auth, sanitization).

**Lightweight over complex.** Fewer moving parts, fewer deps, less config. Simple > clever. Readable > elegant.

**Open-source only.** No vendor lock-in. Every line of code must have a purpose — no speculative code, no premature abstractions.

## Project Specifics

- **What:** Vanilla JS library — ADB-direct Android device control for autonomous agents. Accessibility tree in, pruned snapshot out.
- **Language:** Vanilla JavaScript, ES modules, no build step
- **Runtime:** Node.js >= 22
- **Protocol:** ADB (Android Debug Bridge) via `child_process.execFile` — no Appium
- **Device:** Any ADB-connected Android device or emulator
- **Tests:** Run with `node --test test/unit/*.test.js test/integration/*.test.js`
- **Docs:** `docs/research.md` (feasibility research), `docs/poc-plan.md` (POC scope)
