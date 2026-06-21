# sldprt-converter

Convert SolidWorks SLDPRT files to STL and OBJ format by reverse-engineering the binary mesh data.

## Installation

```bash
npm install sldprt-converter
```

## Usage

### Command Line

```bash
# Basic: convert to OBJ (default)
npx sldprt-convert input.sldprt

# Convert to STL (binary format, smaller file)
npx sldprt-convert input.sldprt --format stl

# Convert to ASCII STL
npx sldprt-convert input.sldprt --format stl --ascii

# Specify output file
npx sldprt-convert input.sldprt --output result.obj

# Scale coordinates (input is in meters, scale by 1000 for mm)
npx sldprt-convert input.sldprt --scale 1000

# Show mesh info without writing output
npx sldprt-convert input.sldprt --info

# Batch convert all files in a directory
npx sldprt-convert *.sldprt --scale 1000

# Enable verbose logging for debugging
npx sldprt-convert input.sldprt --verbose
```

### Programmatic API

```javascript
const { extractMesh, toOBJ, toSTL } = require('sldprt-converter');
const fs = require('fs');

const buf = fs.readFileSync('part.sldprt');
const mesh = extractMesh(buf);

// Inspect mesh
console.log(`Vertices: ${mesh.vertices.length}`);
console.log(`Faces: ${mesh.faces.length}`);
console.log(`Dimensions: ${JSON.stringify(mesh.partDimensions)}`);

// Export
fs.writeFileSync('output.obj', toOBJ(mesh));
fs.writeFileSync('output.stl', toSTL(mesh));
```

## How It Works

This tool reverse-engineers the SLDPRT binary format to extract mesh geometry directly:

1. Parses the OLE2 compound document structure
2. Locates and decompresses the `Contents/DisplayLists` stream (pako/zlib)
3. Scans for modern-format (openswx) surface data or legacy DisplayLists
4. Extracts vertex arrays and face definitions
5. Triangulates faces:
   - **Flat faces**: Centroid fan with angle sorting
   - **Ruled surfaces**: Detected via vertex pattern analysis
   - **Quads**: Diagonal split into two triangles
   - **Other**: Best-effort fan triangulation

## Supported Formats

- **Input:** SLDPRT files from SolidWorks 2015+
- **Output:** STL (ASCII or binary), OBJ, JSON (with `--output-json`)

## Current Limitations

- Extracted geometry represents NURBS control points, not evaluated surfaces
- B-spline interpolation is linear (surfaces may deviate slightly from true curves)
- Holes/cutouts (face inner boundaries) not yet supported
- Assembly files (.sldasm) not supported; convert individual parts
- SolidWorks 2010 and earlier (legacy OLE2-only format) may have limited support

## Accuracy Notes

The converter produces valid, manifold 3D meshes suitable for:
- 3D printing (STL import)
- CAD visualization
- Mesh analysis and manipulation

**Geometric accuracy depends on:**
- Original SolidWorks part complexity
- Surface curvature (curved faces deviate slightly due to linear control-point interpolation)
- File format version

For production use where exact geometry is critical, export directly from SolidWorks instead.

## Web Viewer

Open `web/viewer.html` in a browser to visually inspect converted geometry before exporting.

Drag and drop a `.sldprt` file onto the viewer to extract and display its mesh. Export as OBJ or STL directly from the browser.

## API Reference

### `extractMesh(buf: Uint8Array | Buffer): MeshData`

Extracts 3D mesh from SLDPRT file data.

**Returns:**
```javascript
{
  vertices: [[x1,y1,z1], [x2,y2,z2], ...],  // Vertex coordinates
  faces: [[v0,v1,v2,...], ...],             // Face vertex indices
  faceVertexCounts: [3, 4, 3, ...],         // Vertices per face
  partDimensions: {                         // Bounding box
    x: {min, max, size},
    y: {min, max, size},
    z: {min, max, size}
  },
  warnings: [...],                          // Processing warnings
  errors: [...]                             // Critical errors
}
```

### `toOBJ(mesh: MeshData): string`

Convert mesh to Wavefront OBJ format.

### `toSTL(mesh: MeshData): string`

Convert mesh to ASCII STL format.

### `toBinarySTL(mesh: MeshData): Uint8Array`

Convert mesh to binary STL format (compact, suitable for 3D printing).

## Development

See [dev/README.md](dev/README.md) for information about the reverse-engineering scripts and format analysis tools.

## Conversion Test Results (v0.2.1)

Tested against 10 SolidWorks SLDPRT files covering various geometries:

| File | Vertices | Faces | Triangles | Status |
|------|----------|-------|-----------|--------|
| Dekor | 12 | 2 | 8 | ✅ |
| distributor main boss rev a | 831 | 47 | 738 | ✅ |
| Helical Bevel Gear | 2,897 | 299 | 2,406 | ✅ |
| Pocket Wheel | 8,531 | 780 | 6,878 | ✅ |
| PTC GE8080-8 | 952 | 174 | 605 | ✅ |
| USB hub case BOTTOM | 244 | 21 | 221 | ✅ |
| USB hub case TOP | 1,813 | 96 | 1,665 | ✅ |
| chainwheel | — | — | — | ❌ (unsupported compression) |
| plate4 | — | — | — | ❌ (unsupported compression) |
| SW2000-s01 | — | — | — | ❌ (unsupported compression) |

**Results:** 7/10 files converted successfully (70% success rate). Failed files use a compression format not yet supported by the openswx decoder.

## License

MIT

## Acknowledgments

This project reverse-engineered the SLDPRT binary format through careful analysis of OLE2 structure, decompression streams, and geometric data patterns. It is not affiliated with or endorsed by Dassault Systèmes / SolidWorks.
