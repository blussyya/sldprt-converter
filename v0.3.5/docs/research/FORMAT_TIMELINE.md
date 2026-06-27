# Format Timeline — SLDPRT Format Versions

**Last updated**: Current session

---

## Timeline

### SLDPRT v1 (SW 2000 and earlier)
- **Format**: OLE2 compound document
- **Container**: Standard OLE2 with `DisplayLists` and `DisplayLists__Zip` streams
- **Compression**: Zip (deflate) or brotli
- **Topology**: Face blocks with `[12, 100, 2, vc]` markers
- **Test file**: `SW2000-s01.SLDPRT`
- **Status**: PARTIALLY DECODED. Old format parser works for basic vertex extraction.

### SLDPRT v2 (SW 2015–2020)
- **Format**: openswx archive (ROL-encoded)
- **Container**: Custom archive with XOR-encoded stream names
- **Compression**: zlib inflateRaw
- **Topology**: Face blocks with `[12, 100, 2, vc]` markers + Block 1/2
- **Test files**: `USB hub case BOTTOM.SLDPRT`, `USB hub case TOP.SLDPRT`
- **Status**: DECODED. Full face extraction with sub-loop support.

### SLDPRT v3 (SW 2020+)
- **Format**: openswx archive (ROL-encoded)
- **Container**: Same as v2
- **Compression**: Same as v2
- **Topology**: Same face block structure with Block 1/2
- **Test files**: `Helical Bevel Gear.SLDPRT`, `Dekor.SLDPRT`
- **Status**: DECODED. Full face extraction with sub-loop support.

---

## Key Differences Between Versions

| Feature | v1 (OLE2) | v2/v3 (openswx) |
|---------|-----------|------------------|
| Container | OLE2 compound | openswx archive |
| Stream naming | Plain text | XOR-encoded |
| Compression | Zip/brotli | zlib inflateRaw |
| Face marker | Same `[12, 100, 2, vc]` | Same |
| Block 1/2 | Present | Present |
| Sub-loop support | Unknown | Verified |

---

## Stream Inventory Comparison

### BOTTOM (openswx, 43 streams)
- `Contents/DisplayLists` (98481 bytes) — main geometry
- `Contents/Config-0-ResolvedFeatures` (85484 bytes) — metadata
- `ThirdPty/GSSLMachineWorks` (32912 bytes) — third-party
- `Contents/Config-0-Partition` (31885 bytes) — encrypted/unreadable
- `Contents/Config-0` (24726 bytes) — configuration
- `PreviewPNG` (15480 bytes) — thumbnail
- `Contents/Definition` (4303 bytes) — definition data
- 36 other streams (XML, metadata, etc.)

### GEAR (openswx)
- `Contents/DisplayLists` (536060 bytes) — main geometry (5.4× larger than BOTTOM)
- Similar stream structure to BOTTOM

### DEKOR (openswx)
- `Contents/DisplayLists` (1155310 bytes) — main geometry (11.7× larger than BOTTOM)
- Similar stream structure to BOTTOM

---

## DisplayLists Internal Structure

The main DisplayLists stream is organized into sections:

### Section Layout
Each section starts with:
```
u32[0] = 1
u32[1] = 1
u32[2..5] = metadata (varies by section)
```

### Section Types
1. **Metadata section** (Section 0): Contains class names (`uiUserModelEnv_c`), no face data
2. **Face group sections**: Contain face blocks and topology blocks
3. **Empty sections**: Tiny (32 bytes), no face data
4. **Trailing sections**: Metadata at end of stream

### Section Counts
- BOTTOM: 11 sections, 39 faces
- GEAR: 59 sections, 113 faces

### Face Block Structure
Each face block contains:
1. `edgeCount` u32
2. Face type marker `[100, 2, vc]`
3. Vertex array `float32[vc × 3]`
4. Gap marker `[12, 100, 2, vc]`
5. Normal array `float32[vc × 3]`
6. Block 1 (topology)
7. Block 2 (sub-loop slicing mask)

### Section Count by File
- BOTTOM: 11 sections
- TOP: Unknown (not yet counted)
- GEAR: Unknown (not yet counted)
- DEKOR: Unknown (not yet counted)

---

## Unknowns

1. **What do the section separators `[1,1]` mean?**
   - Could be MFC CArchive version markers
   - Could be section boundaries for different face groups
   - Could be something else entirely

2. **How many faces per section?**
   - Not yet determined
   - Could be variable

3. **What is the small DisplayLists stream?**
   - BOTTOM has `Contents/Config-0-LWDATA` (1405 bytes)
   - Could be a lookup table, index, or metadata

4. **What is `Config-0-Partition`?**
   - 31885 bytes, appears encrypted
   - Could contain parametric B-Rep data
   - Currently unreadable

5. **What is `Config-0-ResolvedFeatures`?**
   - 85484 bytes, appears to be feature metadata
   - Could contain design tree information
