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
npx sldprt-convert input.sldprt --format binary-stl

# Convert to ASCII STL
npx sldprt-convert input.sldprt --format stl

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

- Surface detection is heuristic (`tryReadSurface` at fixed offsets) — may pick up false positives
- Some files use compressed `DisplayLists__Zip` format not yet supported (openswx decoder only handles uncompressed)
- Holes/cutouts (face inner boundaries) not yet supported
- Assembly files (.sldasm) not supported; convert individual parts
- SolidWorks 2010 and earlier (legacy OLE2-only format) may have limited support

## Accuracy Notes

The converter extracts mesh data from SolidWorks' internal DisplayLists stream (tessellated geometry).

**Geometric accuracy depends on:**
- Surface detection finding correct byte offsets
- Source file compression format
- Heuristic face reconstruction from raw vertex data

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

## Conversion Test Results (v0.2.2)

Tested against 10 SolidWorks SLDPRT files covering various geometries.
The iterative MAD outlier filter removes garbage vertices from false-positive surfaces while preserving valid geometry.

| File | Vertices | Faces | Triangles | Dimensions (mm) | Status |
|------|----------|-------|-----------|-----------------|--------|
| Dekor | 9 | 2 | 5 | — | ⚠️ (incomplete mesh) |
| distributor main boss rev a | 313 | 40 | 231 | 135 × 124 × 34 | ✅ |
| Helical Bevel Gear | 2,235 | 300 | 1,588 | — | ⚠️ (dimension inflation) |
| Pocket Wheel | 5,784 | 679 | 3,956 | — | ⚠️ (dimension inflation) |
| PTC GE8080-8 | 577 | 104 | 308 | — | ⚠️ (dimension inflation) |
| USB hub case BOTTOM | 165 | 21 | 123 | **63 × 67 × 27** ✅ | ✅ (matches STEP ref) |
| USB hub case TOP | 483 | 69 | 328 | 144 × 67 × 11 | ⚠️ (partial inflation) |
| chainwheel | — | — | — | — | ❌ (unsupported compression) |
| plate4 | — | — | — | — | ❌ (unsupported compression) |
| SW2000-s01 | — | — | — | — | ❌ (unsupported compression) |

**Results:** 7/10 files produce mesh output (70% parse rate). Failed files use compressed `DisplayLists__Zip` format not yet supported. The USB hub case BOTTOM now matches the reference STEP file dimensions exactly (63×67×27mm). Other files suffer from false-positive surface detection inflating bounding boxes.

## License

MIT

## Acknowledgments

This project reverse-engineered the SLDPRT binary format through careful analysis of OLE2 structure, decompression streams, and geometric data patterns. It is not affiliated with or endorsed by Dassault Systèmes / SolidWorks.
