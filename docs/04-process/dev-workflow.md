# Development Workflow

## Getting started

1. Clone the repo
2. Follow `04-process/dev-setup.md` for Android SDK + emulator setup
3. Start emulator: `emulator -avd baremobile-test -gpu host &`
4. Verify: `adb devices` shows `emulator-5554`

## Running tests

```bash
# All tests (unit + integration)
node --test test/unit/*.test.js test/integration/*.test.js

# Unit only (no device needed)
node --test test/unit/*.test.js

# Single file
node --test test/unit/xml.test.js
```

Integration tests auto-skip when no ADB device is available.

## Adding a feature

1. **POC first** — ~15min proof-of-concept, validate the approach works
2. **Design** — if POC passes, design proper module structure
3. **Build** — one module at a time, each works independently
4. **Test** — unit tests for pure functions, integration tests for device interaction
5. **Document** — update `01-product/prd.md` (blueprint), `baremobile.context.md`, testing guide

## Writing tests

- **Framework:** `node:test` and `node:assert/strict` only, no external test frameworks
- **Unit tests:** Pure function in, value out. No device, no I/O.
- **Integration tests:** Need `connect()` → page object. Must auto-skip without device.
- **Key rule:** Don't cache refs across snapshots. Add settle delays after actions (500ms-2s).

See `04-process/testing.md` for full testing guide.

## Code style

- Vanilla JS, ES modules, no build step
- Zero dependencies (except `adb` in PATH)
- No TypeScript, no JSDoc, no linting config
- Simple > clever, readable > elegant

## Commit conventions

Follow the existing pattern in CHANGELOG.md:
- `feat:` — new feature or module
- `fix:` — bug fix
- `docs:` — documentation changes
- `test:` — test additions or fixes
- `release:` — version bump + changelog
