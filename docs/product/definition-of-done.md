---
type: reference
title: Definition of Done
status: stable
contract: docs/product/prd.md
---

# Definition of Done

A feature or phase is "done" when:

## Code
- [ ] Implementation complete and working
- [ ] All existing tests still pass
- [ ] New tests added for new functionality
- [ ] No external dependencies added (unless absolutely necessary and approved)

## Testing
- [ ] Unit tests for all pure functions
- [ ] Integration tests for device-dependent features (with auto-skip)
- [ ] POC validated on emulator before building
- [ ] Edge cases covered (error messages, missing refs, invalid input)

## Documentation
- [ ] `docs/product/prd.md` (the product contract) updated — module details, verified flows, roadmap status
- [ ] `baremobile.context.md` updated — agent integration patterns
- [ ] `docs/product/dev-setup.md` updated — test counts, new test descriptions
- [ ] `CHANGELOG.md` updated — what changed, what was verified
- [ ] `README.md` updated if public API changed

## Validation
- [ ] Run full test suite: `node --test test/unit/*.test.js test/integration/*.test.js`
- [ ] Manual verification on emulator for interaction features
- [ ] Obstacle course tables updated with module annotations
