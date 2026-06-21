# Changelog

## v0.2.0

### Critical Fixes
- Fixed vertex bounds (MIN_C/MIN_C) to support large parts >1 meter (applied)
- Added cycle detection in FAT-chain loop to prevent hangs on malformed OLE2 files (applied)
- Fixed package.json: bin now points to sldprt-cli.js, files list includes all sources (applied)

### New Features
- Added `--verbose` flag for detailed parsing logs
- Added `setVerbose()` to programmatic API
- Default scale changed from 1 to 1000 (mm output, matching user expectations)
- Deprecated `convert.js` in favor of `sldprt-cli.js`

### Bug Fixes
- Removed redundant `data.length > 5000 && data.length > 20000` check (first was dead code)
- Ruled-surface detection (`isCleanStrip`) now axis-agnostic (uses face normal, not just Y)
- Removed dead "ORIGINAL.STL" debug code from convert.js
- Replaced silent catch blocks with verbose-aware logging

### Documentation
- Added DEPRECATED header to convert.js
- Updated README with --verbose, new default scale
- Created DETAILED_CODE_REVIEW.md (applied)
- Created FIXES APPLIED SUMMARY.txt (applied)

### Deferred
- True NURBS evaluation (currently control points)
- Full hole/cutout support from binary stream (inner loop format unknown)

## v0.2.1

### Completed (from v0.2.0 deferred)
- OLE2 parser extracted into `src/ole2-parser.js` with cycle detection
- Real test suite at `test/test-extractor.js` with 20+ tests
- Three.js-based web viewer (`web/viewer.html`) with OrbitControls
- Test fixtures downloaded: `box.SLDPRT`, `door.SLDPRT`, `drawer.SLDPRT`, `locker.SLDPRT`, `sink.SLDPRT`
- Synthetic test fixture generator: `test/generate-test-fixture.js`
- `npm test` runner configured (`npm run test`)
- GitHub CI workflow (`.github/workflows/test.yml`)
- Polygon triangulation utilities: `earClip`, `triangulate`, `project3dTo2d` in `src/utils.js`
- Face-boundary hole support: `triangulate(outer, holes)` ready for inner loop data
- Research documentation: `doc/research-notes.md`, `doc/step-tess-integration.md`
