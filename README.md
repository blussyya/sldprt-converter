# SLDPRT Reverse Engineering Research

## Goal
Parse SolidWorks .sldprt files in the browser to extract 3D geometry (triangles) without needing SolidWorks or any proprietary software.

## Status: DEFINITIVE FINDINGS — Browser-Based SLDPRT Parsing is NOT Feasible

After extensive research (analyzing 6 SLDPRT files from SW 2000–2022, testing every decompression method, parsing every stream), the conclusion is clear:

### **The Parasolid B-Rep geometry in SLDPRT files is wrapped in SolidWorks' own proprietary serialization format. There is NO public way to extract raw B-Rep geometry without SolidWorks or a commercial library.**

---

## What We Built

### Working OLE2 Parser (`ole2-parser.js`)
- Parses Microsoft Compound File Binary (OLE2/Structured Storage) format
- Reads FAT, directory tree, and stream data (both regular and mini-stream)
- **Tested and working on real SLDPRT files** (SW 2000 through SW 2022)
- Fixed bounds checking for robust stream reading

### Analysis Scripts
- `full-stream-analysis.js` — Hex-dump and analyze every stream
- `analyze-brotli-result.js` — Brotli decompression analysis
- `extract-vertices.js` — Float64/int32/int16 vertex extraction attempts
- `parse-config0-serialization.js` — Config-0 class hierarchy parser
- `deep-analyze-body.js` — Config-0-Body binary structure analysis
- `python-analyze.py` — Python olefile-based analysis

### Test Infrastructure
- `test.html` — Browser-based file drop + Three.js viewer
- `test-node.js` — Node.js CLI test harness
- `sldprt-to-step.py` — Python SLDPRT→STEP converter via FreeCAD
- `generate-test.js` — OLE2 test file generator

---

## Definitive File Structure Analysis

### SLDPRT = OLE2 Container
```
SLDPRT = OLE2 compound file
├── Header
├── FAT (File Allocation Table)
├── Directory
├── Streams:
│   ├── Header — SolidWorks version, metadata (moHeader_c, su_CStringArray)
│   ├── Preview — Thumbnail bitmap (EMF/WMF)
│   ├── Contents/
│   │   ├── DisplayLists__Zip — Tessellated rendering data (custom __Zip compression)
│   │   ├── Config-0 — Feature tree serialization (moPart_c, moHeader_c, moExtrusion_c, etc.)
│   │   ├── Config-0-Body — SolidWorks-serialized geometry (103KB, NOT standard Parasolid)
│   │   ├── Config-2, Config-2-Body — Additional configuration data
│   │   ├── Definition — Display/font classes (moANSI_c, uiUserModelEnv_c)
│   │   ├── CMgr, CMgrHdr, OleItems — Configuration management
│   │   └── Printing — Print settings
│   ├── SummaryInformation — OLE properties
│   ├── ISolidWorksInformation — SW-specific metadata
│   ├── _DL_VERSION_XXXX — Display list version
│   └── _MO_VERSION_XXXX — Model version / Biography / History
└── ThirdPty/ — Third-party add-in data
```

### Key Class Names Found in Config-0
| Class | Purpose |
|-------|---------|
| `moPart_c` | Root part object |
| `moHeader_c` | Part header/metadata |
| `moExtrusion_c` | Extrude feature |
| `moBoss_c` | Boss-extrude feature |
| `moCompFace_c` | Face data |
| `moCompEdge_c` | Edge data |
| `sgSketch` | Sketch definition |
| `sgLineHandle` | Line geometry |
| `sgPointHandle` | Point geometry |
| `moLengthParameter_c` | Dimension parameter |
| `uiUserModelEnv_c` | User model environment |

### Config-0-Body Binary Structure
- **Header (24 bytes)**: `8b 91 01 00 01 06 48 6c 90 04 49 90 c4 86 e6 59 1c 31 8f 8d 2c 60 79 14`
- **Data**: SolidWorks' own Parasolid serialization (NOT standard .x_b format)
- **Contains**: 7431 valid float64 values (transformation matrices, NOT vertex coordinates)
- **No**: Standard Parasolid headers (`PS\0\0`, `B`), no "PARASOLID"/"TRANSMIT" strings
- **Not**: zlib, brotli, or LZMA compressed (standard methods)

### DisplayLists__Zip Compression
- **Header**: `01 06 c0 1f 24 41 12 24` (custom format, NOT standard zlib)
- **Decompression**: Brotli works at offset 14 (4337 bytes), but the result is NOT geometry
- **Contains**: Rendering control data (transformation matrices), NOT vertex/triangle data
- **The `__Zip` suffix**: SolidWorks custom compression, NOT standard zlib/brotli

### Compression Naming Convention
| Suffix | Format | Notes |
|--------|--------|-------|
| (none) | Raw/uncompressed | Older SW files |
| `__Zip` | Custom compression | NOT standard zlib/brotli |
| `__ZLB` | Standard zlib | Common in SW drawings |

---

## Why Browser-Based SLDPRT Parsing is NOT Feasible

### 1. No Parasolid Data in Standard Format
- SLDPRT files do NOT contain standard Parasolid XT transmit files (.x_b)
- The geometry is in SolidWorks' own serialization format (`moPart_c` hierarchy)
- No `PS\0\0` (neutral binary) or `B` (bare binary) headers found anywhere

### 2. No Config-0-Partition Stream
- Earlier research suggested Config-0-Partition contains zlib-compressed Parasolid data
- **NONE of our 6 test files (SW 2000–2022) contain this stream**
- Only Config-0, Config-0-Body, Config-2, Config-2-Body exist

### 3. Custom Compression is NOT Standard
- `DisplayLists__Zip` uses SolidWorks' custom compression (NOT zlib, brotli, or LZMA)
- Even after decompression, the data is NOT standard Parasolid format
- The decompressed data contains rendering control structures, not mesh geometry

### 4. Config-0-Body Contains SolidWorks Serialization
- The 103KB Config-0-Body stream starts with a custom 24-byte header
- Contains class hierarchy (`moPart_c` → `moHeader_c` → features)
- Float64 values are transformation matrices, NOT vertex coordinates
- Cannot be parsed without knowing SolidWorks' internal serialization format

### 5. Only Commercial Libraries Can Read SLDPRT
- **HOOPS Exchange** (Tech Soft 3D) — reads SLDPRT via Parasolid connector
- **ODA MCAD SDK** — reads SLDPRT versions 2011–2025
- **3DViewStation** — reads SLDPRT versions 1997–2024
- All require paid licenses and are closed-source

---

## What IS Possible

### 1. Offline Python Converter (requires FreeCAD)
`sldprt-to-step.py` — Converts SLDPRT→STEP using FreeCAD (free, open-source)
- Requires FreeCAD installation on user's machine
- Works via FreeCAD's import/export capabilities
- Not suitable for browser-based conversion

### 2. Tessellated Mesh Extraction (if __Zip format is decoded)
The `DisplayLists__Zip` stream likely contains pre-computed tessellated triangles
- But the `__Zip` compression format is custom and undocumented
- Even if decompressed, the data format is proprietary
- Would require significant reverse-engineering effort

### 3. Guidance-Only Approach (current main site approach)
- Guide users to export SLDPRT→STEP/IGES in SolidWorks first
- Then convert STEP/IGES in browser using occt-import-js
- Most practical for web-based workflow

---

## Test Files Analyzed

| File | SW Version | Size | Config-0-Partition | Notes |
|------|-----------|------|-------------------|-------|
| SW2000-s01.SLDPRT | SW 2000 | 20KB | NO | Old format |
| plate4.sldprt | ~SW 2006 | 76KB | NO | Simple part |
| chainwheel.sldprt | ~SW 2006 | 253KB | NO | Complex part |
| CAM.SLDPRT | SW 2022 | 138KB | NO | Newer format |
| doneConsole.sldprt | Unknown | 350KB | NO | Large part |
| SLIDING TABLE.SLDPRT | SW 2017 | 539KB | NO | Multi-config |

**None of these files contain Config-0-Partition or standard Parasolid data.**

---

## References

- [HOOPS Exchange SolidWorks Reader](https://docs.techsoft3d.com/exchange/2025.6.0/start/format/solidworks_reader.html) — "SolidWorks uses Parasolid as its geometry engine"
- [Ansys CAD Reader](https://ansyshelp.ansys.com/public/Views/Secured/corp/v251/en/ref_cad/cadSWreader.html) — "SOLIDWORKS stores B-rep data in separate streams"
- [Parasolid XT Format Reference](http://www.13thmonkey.org/documentation/CAD/Parasolid-XT-format-reference.pdf) — Binary format spec
- [heybryan.org SLDPRT format](https://heybryan.org/solidworks_file_format.html) — Reverse engineering attempts
- [Free-Solidworks-OBJ-Exporter](https://github.com/Aeroanion/Free-Solidworks-OBJ-Exporter) — Requires SolidWorks API

---

## License
MIT
