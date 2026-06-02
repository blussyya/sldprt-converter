# SLDPRT Reverse Engineering Research

## Goal
Parse SolidWorks .sldprt files in the browser to extract 3D geometry (triangles) without needing SolidWorks or any proprietary software.

## What We Built

### Working OLE2 Parser (`ole2-parser.js`)
- Parses Microsoft Compound File Binary (OLE2/Structured Storage) format
- Reads FAT (File Allocation Table), directory tree, and stream data
- Handles both regular sectors and mini-stream for small streams
- **Tested and working on real SLDPRT files**

### SLDPRT Extractor (`sldprt-extractor.js`)
- Attempts to extract geometry from decompressed data
- Multiple strategies: Parasolid parsing, display list parsing, pattern matching

### Test Pages
- `test.html` — Browser-based file drop + 3D viewer (Three.js)
- `test-node.js` — Node.js CLI testing
- `analyze-streams.js` — Stream content analyzer
- `parse-display.js` — Display list parser

## Key Findings

### SLDPRT File Structure
```
SLDPRT = OLE2 container (like old .doc files)
├── Header
├── FAT (File Allocation Table)
├── Directory (red-black tree of streams)
├── Streams:
│   ├── Header — SolidWorks version info
│   ├── Preview — Thumbnail bitmap
│   ├── Contents/
│   │   ├── DisplayLists / DisplayLists__Zip / DisplayLists__ZLB
│   │   │   └── Tessellated triangle data (compressed or raw)
│   │   ├── Definition
│   │   │   └── Parasolid B-Rep geometry (structured binary)
│   │   ├── Config-0 / Config-0-Partition
│   │   │   └── Part metadata (feature tree, timestamps)
│   │   └── CMgr, CMgrHdr, OleItems
│   ├── SummaryInformation
│   └── ISolidWorksInformation
```

### Compression Naming Convention
| Suffix | Format | SolidWorks Version |
|--------|--------|--------------------|
| (none) | Raw/uncompressed | Older (pre-2015?) |
| `__Zip` | ZIP-compressed | ~2000-2015 |
| `__ZLB` | Zlib-compressed | 2015+ |

### What We Successfully Parsed
1. **OLE2 container** — Full FAT, directory, stream extraction ✓
2. **Stream discovery** — Found DisplayLists, Definition, Config streams ✓
3. **Metadata extraction** — Feature names, timestamps, user info ✓
4. **Raw coordinate data** — Found float64 vertex values in DisplayLists ✓

### What We Haven't Solved Yet
1. **Display list format** — Coordinates are interleaved with metadata; can't just read as float64 triplets
2. **Parasolid Definition format** — Complex structured binary with class names (`moPart_c`, `moCompEdge_cR`, etc.)
3. **Correct triangle extraction** — Got 237 "vertices" but they don't form a coherent mesh

## The Real Problem

The DisplayLists stream is NOT raw float64 vertex data. It's a **custom SolidWorks binary format** with:
- Headers and section markers
- Face/edge/vertex metadata interleaved with coordinates
- Class names like `uiUserModelEnv_c`
- Different data types mixed together

The Definition stream contains Parasolid B-Rep data but in SolidWorks' internal serialization format, not standard `.x_b` or `.step`.

## Next Steps (for future work)

### Option A: Reverse-engineer the DisplayLists format
- Map out the binary structure byte-by-byte
- Identify header patterns, length fields, type markers
- Extract vertices from the correct offsets
- **Effort: High (weeks of reverse engineering)**

### Option B: Use existing tools
- **FreeCAD + Python** — can convert SLDPRT → STEP offline

### Option C: Hybrid approach
- A simple Python script that uses `python-olefile` + `freeCAD` to convert SLDPRT → STEP

## Test Files
Downloaded from sembiance.com:
- `SW2000-s01.SLDPRT` (20KB, SW 2000)
- `plate4.sldprt` (76KB, SW ~2006)
- `chainwheel.sldprt` (253KB, SW ~2006)

## Running Tests
```bash
# Node.js testing
node test-node.js plate4.sldprt

# Stream analysis
node analyze-streams.js plate4.sldprt

# Display list parsing
node parse-display.js plate4.sldprt

# Open browser test
# Open test.html in browser, drop a .sldprt file
```
