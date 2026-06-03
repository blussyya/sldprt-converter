# SLDPRT Converter

Extract 3D mesh from SolidWorks `.sldprt` files — no SolidWorks license needed.

Parses the OLE2 container, finds the `DisplayLists` stream with tessellated vertex data, and outputs standard OBJ/STL files.

**Status:** Working for SLDPRT files with uncompressed `DisplayLists` streams. Files using `DisplayLists__Zip` (compressed) are not yet supported.

## Quick Start

### CLI (Node.js)

```bash
# Convert to OBJ (default)
node slprd-cli.js mypart.sldprt

# Convert to STL
node slprd-cli.js mypart.sldprt -f stl

# Scale to millimeters (internal units are meters)
node slprd-cli.js mypart.sldprt -f binary-stl --scale 1000

# Show mesh info only
node slprd-cli.js mypart.sldprt --info

# Batch convert
node slprd-cli.js *.sldprt -f obj --scale 1000
```

### Programmatic (Node.js)

```javascript
const fs = require('fs');
const { extractMesh, toOBJ, toSTL, toBinarySTL } = require('./slprd-extractor.js');

const buf = fs.readFileSync('mypart.sldprt');
const mesh = extractMesh(buf);

if (mesh.vertices.length > 0) {
    fs.writeFileSync('output.obj', toOBJ(mesh));
    fs.writeFileSync('output.stl', toSTL(mesh));
    fs.writeFileSync('output-bin.stl', toBinarySTL(mesh));
}
```

### Browser

```html
<script src="slprd-extractor.js"></script>
<script>
document.getElementById('fileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const buf = await file.arrayBuffer();
    const mesh = slprdExtractor.extractMesh(buf);
    
    if (mesh.vertices.length > 0) {
        const obj = slprdExtractor.toOBJ(mesh);
        // Load into Three.js, download, etc.
    }
});
</script>
```

## CLI Options

| Flag | Description |
|------|-------------|
| `-o, --output <path>` | Output file path (default: input name + extension) |
| `-f, --format <fmt>` | `obj` (default), `stl`, `binary-stl` |
| `--scale <factor>` | Multiply all coordinates by this value |
| `--info` | Print mesh info without writing output |
| `-h, --help` | Show help |

## Output Formats

- **OBJ** — Wavefront OBJ, text format, 1-based face indices
- **STL** — ASCII STL with computed face normals
- **Binary STL** — Compact binary STL (smaller files)

## How It Works

SLDPRT files are OLE2 compound documents. Inside, the `DisplayLists` stream contains tessellated mesh data:

```
[class records] [u32 header: faceCount + per-face vertex counts] [vertex data: float32 LE triplets]
```

The extractor:
1. Parses the OLE2 container to find the `DisplayLists` stream
2. Scans for the tessellation header (face vertex counts)
3. Detects the vertex block by filtering out gap data (interleaved -0.075 y-values)
4. Reads `totalVertices × 12` bytes as float32 LE x,y,z triplets
5. Builds face connectivity as triangle fans

## Limitations

- **`DisplayLists__Zip` not supported** — Newer SLDPRT files compress the DisplayLists stream with SolidWorks' custom `__Zip` format. Decompression works (brotli at offset 14) but the output is another encoding layer that hasn't been reverse-engineered.
- **Only tessellated mesh** — Extracts the pre-tessellated rendering mesh, not the full B-Rep geometry. This is the same mesh SolidWorks uses for display.
- **Internal units** — Coordinates are in the model's internal units (typically meters). Use `--scale 1000` for millimeters.

## File Structure

```
SLDPRT = OLE2 compound file
├── DisplayLists          — Tessellated mesh (what we extract)
├── DisplayLists__Zip     — Compressed tessellation (not yet supported)
├── Config-0              — Feature tree (extrusions, sketches, etc.)
├── Config-0-Body         — Serialized B-Rep geometry (proprietary format)
├── Header                — SW version metadata
├── Preview               — Thumbnail bitmap
└── SummaryInformation    — OLE properties
```

## Test Results

| File | Format | Vertices | Faces | Triangles |
|------|--------|----------|-------|-----------|
| doneConsole.sldprt | DisplayLists | 159 | 25 | 109 |
| SLIDING TABLE.SLDPRT | DisplayLists__Zip | — | — | — |
| CAM.SLDPRT | DisplayLists__Zip | — | — | — |

## License

MIT
