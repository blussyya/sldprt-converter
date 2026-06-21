# SLDPRT Reverse-Engineering Research Notes

## File Format

SLDPRT is a proprietary SolidWorks part file format. It exists in two variants:

### Old Format (SolidWorks 98-2001?)
- OLE2 (Compound Document Format) container
- Contains a Stream named `DisplayLists` (or `DisplayLists__Zip` / `DisplayLists__ZLB`)
- DisplayLists stream stores pre-tessellated triangle/quad data as float32 arrays
- The stream is optionally zlib-compressed (header `78 01` / `78 9C`)

### New Format (SolidWorks 2001+)
- OLE2 container with `openswx` stream
- Contains ROL-encoded (XOR rotation) data
- Uses a custom compression scheme (CArchive-based)
- Multiple surface patches with different tessellation levels

## DisplayLists Format (Old)

After decompression, the DisplayLists stream has this known structure:

```
[u32 faceCount]
For each face:
  [u32 vertexCount]
  [float32 * 3 * vertexCount] (xyz positions)
```

Faces with 3 or 4 vertices are stored directly as triangles/quads. Larger polygons represent pre-triangulated fan/strip data that must be fan-triangulated.

### But in some files, there are additional fields:
- After vertex data: Often has 3 float32 values (possibly face normal or bounding info)
- Some files show a `u32 uvCount` field followed by float32 * 2 * uvCount (UV coordinates)
- Some files show a section type byte before the face count

### Known section markers in DisplayLists:
```
01 = face section header (followed by face data)
02 = NURBS surface patch
03 = edge/tessellation level
```

## NURBS Support

The DisplayLists stream sometimes contains section `02` which stores NURBS surface control points. However:
- Control points alone are insufficient for evaluation
- Knot vectors and degrees are not present in DisplayLists
- These would need to be extracted from the PARASOLID kernel data or PartDefinition section
- Without them, we interpolate the control net rather than evaluating the true NURBS surface

## Missing Information (Need More Research)

1. **Hole/Cutout topology**: How are face boundaries with inner loops (holes) stored?
   - Possibly in a separate stream (Parasolid body data or PartDefinition XML)
   - DisplayLists only stores the already-triangulated mesh, so holes may already be triangulated
   - The triangulation with hole support in `utils.js` is ready for when this is decoded

2. **UV coordinates**: Present in some files as float32 pairs after vertex data.
   - Not extracted by the current parser
   - Needed for texture mapping

3. **Face normals**: Store per-face or per-vertex normals.
   - Not currently extracted (recomputed in STL/OBJ output)

4. **New format (openswx) decompression**: 
   - Uses MFC CArchive serialization
   - The ROL decoding is implemented but decompression is incomplete
   - May require a CArchive reader understanding for full extraction

## Analysis Tools

See the `analyze/` directory for format analysis scripts:
- `analyze-displaylists.js` - Detailed hex dump and section identification
- `analyze-displaylists-deep.js` - Decompression experiments
- `analyze-streams.js` - All streams in an OLE2 file
- `full-stream-analysis.js` - Comprehensive format analysis

## Future Work

1. Download more SLDPRT sample files (varied geometry, with holes, with NURBS surfaces)
2. Cross-reference with Parasolid .x_t text files for format validation
3. Implement full CArchive/MFC serialization reader for the new format
4. Integrate rhino3dm.js or NURBS.js for proper NURBS evaluation
5. Extract UV coordinates and add texture support to OBJ output
