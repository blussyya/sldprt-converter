# SLDPRT Converter

Extract 3D mesh from SolidWorks `.sldprt` files — no SolidWorks license needed.

Parses the OLE2 container (or modern OpenSX format), finds the `DisplayLists` stream with tessellated vertex data, and outputs standard OBJ/STL files.

**Status:** Working for both legacy OLE2-based and modern OpenSX-compressed SLDPRT files. 4 of 5 Grabcad test files successfully extract.

## Quick Start

### CLI (Node.js)

```bash
cd sldprt-converter

# Install dependencies
npm install

# Convert to OBJ (default)
node src/slprd-cli.js mypart.sldprt

# Convert to binary STL
node src/slprd-cli.js mypart.sldprt -f binary-stl

# Scale to millimeters (internal units are meters)
node src/slprd-cli.js mypart.sldprt -f binary-stl --scale 1000

# Show mesh info only
node src/slprd-cli.js mypart.sldprt --info

# Batch convert
node src/slprd-cli.js *.sldprt -f obj --scale 1000
```

### Browser (Self-Contained)

Open `web/viewer.html` in any modern browser. Drop an SLDPRT file onto the page — no server needed. Uses inlined pako for decompression.

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

### Two File Formats

SLDPRT files come in two formats:

1. **Legacy OLE2** — Standard compound document. `DisplayLists` stream is raw (or `__Zip` compressed, not yet supported).
2. **Modern OpenSX** — SolidWorks 2015+ format. `Contents/DisplayLists` stream is compressed with ROL + raw deflate.

### OpenSX Decompression

For modern files, the extractor:
1. Scans for the OpenSX stream marker: `14 00 06 00 08 00`
2. Finds the `Contents/DisplayLists` stream entry
3. ROL-decodes the stream name (key byte 7 — always 4)
4. Decompresses with raw deflate (pako `inflateRaw`)

### Mesh Extraction

The decompressed DisplayLists stream contains:
```
[8-byte header] [11 × float64 LE metadata] [u32 faceCount] [u32[] per-face vertex counts] [float32 LE vertex positions]
```

The extractor:
1. Reads the face-count header at offset 0x60
2. Scans for valid vertex patterns (coordinates in ±0.6 range)
3. Reads float32 LE x,y,z triplets for each surface
4. Builds face connectivity as triangle fans per face

### Multi-Surface Support

The extractor scans the entire stream for multiple surfaces, not just one. Each surface is independently detected and merged into the final mesh.

## Test Results

| File | Format | Surfaces | Vertices | Faces | Time |
|------|--------|----------|----------|-------|------|
| PTC GE8080-8.SLDPRT | OpenSX | 101 | 541 | 110 | 9ms |
| distributor main boss rev a.SLDPRT | OpenSX | 25 | 818 | 45 | 19ms |
| Helical Bevel Gear.SLDPRT | OpenSX | 72 | 2,200 | 159 | 27ms |
| Pocket Wheel.SLDPRT | OpenSX | 186 | 6,242 | 683 | 51ms |
| Dekor..SLDPRT | OpenSX (unsupported) | 0 | 0 | 0 | 35ms |

## Limitations

- **Face connectivity** — Currently uses triangle fans per face, not true mesh connectivity. Works visually but may have incorrect normals at shared edges.
- **Dekor format** — Some files use a different internal format that isn't yet supported (different MFC class structure, header zeros, garbled stream names).
- **B-Rep not supported** — Extracts the pre-tessellated rendering mesh, not the full B-Rep geometry. This is the same mesh SolidWorks uses for display.
- **Internal units** — Coordinates are in the model's internal units (typically meters). Use `--scale 1000` for millimeters.

## Repo Structure

```
sldprt-converter/
├── src/
│   ├── slprd-extractor.js   — Core extraction library (Node.js + browser)
│   └── slprd-cli.js         — CLI tool for batch conversion
├── web/
│   └── viewer.html          — Self-contained browser viewer with inlined pako
├── test/                    — Test files and harnesses
├── analyze/                 — Analysis and debugging scripts
├── package.json
└── LICENSE                  — MIT
```

## License

MIT
