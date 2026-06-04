# sldprt-converter

Convert SolidWorks SLDPRT files to STL and OBJ format.

## Usage

```bash
npm install
node src/convert.js input.sldprt [output.stl]
```

If no output path is given, writes `input_converted.stl` and `input_converted.obj`.

## How it works

This tool reverse-engineers the SLDPRT binary format to extract mesh geometry directly:

1. Parses the OLE2 compound document format
2. Extracts the `Contents/DisplayLists` stream
3. Decompresses the stream (pako/inflate)
4. Finds face markers (`0x0C 0x00 0x00 0x00 0x64 0x00 0x00 0x00`)
5. Reads NURBS control points for each face (stored as float32 in meters, scaled to mm)
6. Triangulates faces based on type:
   - **Flat faces** (constant Y): convex hull + centroid fan
   - **Ruled surfaces** (alternating Y): linear interpolation between two curves
   - **Quads** (4 vertices): two triangles
   - **Other**: centroid fan with angle sorting

## Current limitations

- Extracted vertices are NURBS control points, not evaluated mesh vertices
- Linear interpolation between control points produces surfaces slightly outside the true B-spline curve
- Flat face holes (for standoffs, cutouts) not yet supported
- Tested on SolidWorks 2015+ SLDPRT files

## License

MIT
