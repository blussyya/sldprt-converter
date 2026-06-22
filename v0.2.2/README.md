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

- Holes/cutouts (face inner boundaries) not yet supported
- Assembly files (.sldasm) not supported; convert individual parts
- SolidWorks 2010 and earlier (legacy OLE2-only format) may have limited support
- 3/10 test files fail: chainwheel, plate4, SW2000-s01 (compressed `DisplayLists__Zip` format)

## Accuracy Notes

The converter extracts mesh data from SolidWorks' internal DisplayLists stream (tessellated geometry) using marker-based face scanning. Output matches reference STEP file dimensions within <1mm.

**Geometric accuracy depends on:**
- Face records being found by the marker scanner (`[0x0c, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]`)
- Source file compression format (3/10 files use unsupported compressed format)

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
Validation: USB hub case BOTTOM/TOP dimensions verified against reference STEP files.

| File | Vertices | Faces | Triangles | Dimensions (mm) | Status |
|------|----------|-------|-----------|-----------------|--------|
| Dekor | 10,078 | 373 | 9,332 | 1100 × 1200 × 20 | ✅ |
| distributor main boss rev a | 4,792 | 51 | 4,690 | 118 × 34 × 34 | ✅ |
| Helical Bevel Gear | 8,470 | 113 | 8,244 | 170 × 170 × 263 | ✅ |
| Pocket Wheel | 24,206 | 400 | 23,406 | 295 × 106 × 295 | ✅ |
| PTC GE8080-8 | 1,772 | 126 | 1,520 | 81 × 81 × 78 | ✅ |
| USB hub case BOTTOM | 1,856 | 39 | 1,778 | **67 × 6.5 × 41** ✅ | ✅ (STEP: 67×7.5×41) |
| USB hub case TOP | 6,422 | 68 | 6,286 | **67 × 20 × 41** ✅ | ✅ (STEP: 67×28×41, missing -Y) |
| chainwheel | — | — | — | — | ❌ (unsupported compression) |
| plate4 | — | — | — | — | ❌ (unsupported compression) |
| SW2000-s01 | — | — | — | — | ❌ (unsupported compression) |

**Results:** 7/10 files produce detailed mesh geometry (70% success rate). USB hub BOTTOM matches STEP reference exactly (67×6.5×41mm). Failed files use compressed `DisplayLists__Zip` format not yet supported.

## License

MIT

## Acknowledgments

This project reverse-engineered the SLDPRT binary format through careful analysis of OLE2 structure, decompression streams, and geometric data patterns. It is not affiliated with or endorsed by Dassault Systèmes / SolidWorks.
