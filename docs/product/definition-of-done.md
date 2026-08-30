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
- [ ] `01-product/prd.md` (blueprint) updated — module details, verified flows, roadmap status
- [ ] `baremobile.context.md` updated — agent integration patterns
- [ ] `04-process/testing.md` updated — test counts, new test descriptions
- [ ] `CHANGELOG.md` updated — what changed, what was verified
- [ ] `README.md` updated if public API changed

## Validation
- [ ] Run full test suite: `node --test test/unit/*.test.js test/integration/*.test.js`
- [ ] Manual verification on emulator for interaction features
- [ ] Obstacle course tables updated with module annotations
