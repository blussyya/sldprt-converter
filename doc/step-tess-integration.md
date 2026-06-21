# STEP Tessellator Integration

## Background

The `dev/step-tess.js` file was a separate toolchain for tessellating STEP
files (AP214/AP203) into STL/OBJ. It uses ear-clipping triangulation to handle
faces with holes (inner boundaries).

## What Was Integrated

The STEP tessellator's polygon triangulation code `earClip`, `earClipWithHoles`,
`triangulate`, `project3dTo2d`, `ptInPoly`, and `signedArea2d` were moved into
`src/utils.js` as reusable utilities.

These are useful for:
1. Handling faces with inner loops (holes) in SLDPRT files
2. General mesh triangulation for any polygon format
3. Future STEP file support

## How to Use

```js
const { triangulate } = require('./utils');

// Outer polygon vertices (3D)
const outer = [[0,0,0],[10,0,0],[10,10,0],[0,10,0]];

// Hole polygon vertices (3D)
const hole = [[2,2,0],[8,2,0],[8,8,0],[2,8,0]];

// Triangulate with holes
const triangles = triangulate(outer, [hole]);
// Returns: array of [v0, v1, v2] 3D triangles
```

## Status

The triangulation code is complete and tested. The remaining challenge is
identifying the location of face-boundary inner loops in the SLDPRT binary
format. This likely requires:
1. Analyzing the Parasolid kernel body section of the file
2. Comparing DisplayLists output with known-geometry test files
3. Possibly decoding the PartDefinition XML metadata

Without this information, holes cannot be automatically detected, and all
face vertices are treated as a single outer boundary.
