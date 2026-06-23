# SLDPRT Converter

Convert SolidWorks `.sldprt` files to standard 3D formats (STL, OBJ, STEP) using a Node.js CLI. Extracts pre-tessellated mesh geometry from the SLDPRT binary format, with optional STEP validation to verify surface accuracy.

## Requirements

- **Node.js 18+** (tested on Node 20/22)
- **npm** (comes with Node)
- Windows, macOS, or Linux

## Installation

```bash
# Clone the repo
git clone https://github.com/blussyya/sldprt-converter.git
cd sldprt-converter

# Install dependencies
npm install
```

That's it. Three commands. No build step, no compilation.

## Quick Start

### Convert a SLDPRT file to binary STL (most common)

```bash
node src/validate.js path/to/your-file.SLDPRT
```

This outputs `your-file_extracted_v1.stl` in the same directory as the input file. The output is auto-versioned (`_v1`, `_v2`, etc.) so you never overwrite previous exports.

### Convert with STEP validation

If you have a `.STEP` file for the same part, you can validate the extraction against it:

```bash
node src/validate.js path/to/your-file.SLDPRT path/to/your-file.STEP
```

This runs a surface-by-surface comparison and shows you exactly which faces match, which are warnings, and which failed.

### Export as OBJ instead

```bash
node src/validate.js path/to/your-file.SLDPRT --format obj
```

### Export as text STL

```bash
node src/validate.js path/to/your-file.SLDPRT --format stl
```

## CLI Reference

### `validate.js` — Extract + Validate + Export

This is the main tool. It extracts the mesh, optionally validates against a STEP file, and exports the result.

```
node src/validate.js <input.sldprt> [input.STEP] [options]
```

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `-f, --format <fmt>` | Output format: `binary-stl`, `stl`, `obj` | `binary-stl` |
| `-o, --output <path>` | Custom output file path | Auto-generated |
| `--tolerance <mm>` | Max distance for STEP face matching | `0.5` mm |
| `-v, --verbose` | Show detailed parsing and matching logs | Off |

**Examples:**

```bash
# Basic conversion — extracts mesh, writes binary STL
node src/validate.js USB hub case BOTTOM.SLDPRT

# Full validation pipeline — extract, compare against STEP, export STL
node src/validate.js USB hub case BOTTOM.SLDPRT "USB hub case BOTTOM ORIGINAL.STEP"

# Export as OBJ with custom output path
node src/validate.js part.SLDPRT --format obj -o ./output/part.obj

# Verbose mode for debugging extraction issues
node src/validate.js part.SLDPRT -v

# Tighter tolerance for STEP validation (stricter matching)
node src/validate.js part.SLDPRT part.STEP --tolerance 0.1
```

### `sldprt-cli.js` — Simple Converter (no STEP validation)

A lighter tool for quick conversions when you don't need STEP validation.

```
node src/sldprt-cli.js <input.sldprt> [options]
```

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `-f, --format <fmt>` | Output format: `obj`, `stl`, `binary-stl` | `obj` |
| `-o, --output <path>` | Custom output file path | Same name as input |
| `--scale <factor>` | Scale factor | `1000` (meters → mm) |
| `--info` | Show mesh info only, no output file | Off |
| `--verbose` | Show detailed parsing logs | Off |
| `-h, --help` | Show help | |

**Examples:**

```bash
# Convert to OBJ (default) — outputs part.obj in mm
node src/sldprt-cli.js part.SLDPRT

# Convert to binary STL
node src/sldprt-cli.js part.SLDPRT -f binary-stl

# Custom output path
node src/sldprt-cli.js part.SLDPRT -o ./exports/part.stl -f binary-stl

# Output in meters instead of mm
node src/sldprt-cli.js part.SLDPRT --scale 1

# Just show mesh info (vertices, faces, dimensions)
node src/sldprt-cli.js part.SLDPRT --info

# Batch convert multiple files
node src/sldprt-cli.js *.sldprt -f binary-stl
```

## Output Files

Exported files are placed alongside the input file by default. Output is auto-versioned to prevent overwriting:

```
USB hub case BOTTOM_extracted_v1.stl
USB hub case BOTTOM_extracted_v2.stl
USB hub case BOTTOM_extracted_v3.stl
...
```

## Supported Formats

### Input

| Format | Support Level |
|--------|--------------|
| `.SLDPRT` (SolidWorks 2015+) | Full — modern openswx format with zlib-compressed DisplayLists |
| `.SLDPRT` (older versions) | Partial — OLE2 compound document format, some files supported |
| `.STEP` / `.STP` (AP214) | Used for validation only (not conversion input) |

### Output

| Format | Description |
|--------|-------------|
| Binary STL (`.stl`) | Compact binary format, best for 3D printing and CAD import |
| Text STL (`.stl`) | ASCII format, human-readable, larger file size |
| OBJ (`.obj`) | Wavefront OBJ, widely supported by 3D viewers and renderers |
| STEP (`.step`) | AP214 with deduplicated CARTESIAN_POINTs (~200KB) |

## How It Works

SolidWorks SLDPRT files store pre-tessellated mesh data inside `DisplayLists` streams. The extraction pipeline:

1. **Parse OLE2** compound document (or detect modern openswx format)
2. **Find DisplayLists** stream by XOR-decoding stream names (key = byte 7)
3. **Decompress** via pako (zlib inflate)
4. **Read face topology**: each face has a header `u32(edgeCount) u32(12) u32(100) u32(2) u32(vertexCount)` followed by `float32[vertexCount × 3]` vertex data
5. **Scale vertices** from meters to millimeters (×1000)
6. **Reconstruct triangle strips** per face for export

When a STEP file is provided, the tool also:

7. **Parse STEP entities** — extract ADVANCED_FACE, EDGE_LOOP, VERTEX_POINT topology
8. **Evaluate surface equations** — PLANE, CYLINDRICAL_SURFACE, CONICAL_SURFACE
9. **Match each SLDPRT face** to its corresponding STEP face by vertex-surface distance
10. **Report per-face accuracy** — match percentage, max distance, status (OK/WARN/FAIL)

## Validation Output

When run with a STEP file, the tool outputs a table like:

```
SLDPRT# | Verts | Area     | STEP#  | Type | Match% | MaxDist  | Status
--------|-------|----------|--------|------|--------|----------|--------
  #  0 |     4 |    240.5 | #  53 | PLANE |  100%  |    0.000 | OK
  #  4 |    75 |   8703.9 | #1000 | PLANE |  100%  |    0.000 | OK
  # 11 |    14 |     23.3 | # 138 |  CYL |  100%  |    0.000 | OK
  # 43 |    71 |    106.9 | #1064 |  CON |  100%  |    0.016 | OK
```

**Status meanings:**
- **OK** — all vertices within tolerance (default 0.5mm) of the STEP surface
- **WARN** — some vertices exceed tolerance but within 3× tolerance
- **FAIL** — vertices significantly far from the expected surface
- **MISS** — no matching STEP face found

## Project Structure

```
sldprt-converter/
├── README.md
├── package.json
├── package-lock.json
├── .gitignore
├── src/
│   ├── validate.js          # Main CLI: extract + validate + export
│   ├── sldprt-cli.js        # Simple converter (no STEP validation)
│   ├── sldprt-extractor.js  # Core library: SLDPRT parsing + mesh extraction
│   ├── step-parse.js        # STEP AP214 parser + surface evaluator
│   ├── ole2-parser.js       # OLE2 compound document parser
│   ├── sldprt-reader.js     # Node-only SLDPRT stream reader
│   └── utils.js             # Shared math utilities (triangulation, etc.)
├── test/                    # Test fixtures and test suite
└── node_modules/            # Dependencies (pako, earcut, lzma)
```

## Dependencies

| Package | Purpose |
|---------|---------|
| [pako](https://www.npmjs.com/package/pako) | zlib decompression for compressed SLDPRT streams |
| [earcut](https://www.npmjs.com/package/earcut) | Polygon triangulation with hole support |
| [lzma](https://www.npmjs.com/package/lzma) | LZMA decompression for legacy SLDPRT streams |

## Known Limitations

- **Only pre-tessellated meshes** — SLDPRT files store display mesh, not B-Rep geometry. Surface equations are not readable from the binary format.
- **Old format support** — Some very old SLDPRT files (SW2000 era) use non-standard compression that isn't fully supported.
- **Strip-based triangulation** — Faces are exported as triangle strips from the SLDPRT display data. Some faces (especially PLANE faces with holes) may have overlapping triangles.
- **No assembly support** — Only single-part `.SLDPRT` files. Assemblies (`.SLDASM`) are not supported.

## License

MIT
