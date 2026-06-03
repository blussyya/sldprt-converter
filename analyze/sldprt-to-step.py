#!/usr/bin/env python3
"""
SLDPRT to STEP Converter (offline)
Uses FreeCAD + python-olefile to convert SolidWorks .sldprt files to STEP format.

Requirements:
    pip install olefile freecad (or install FreeCAD separately)

Usage:
    python sldprt-to-step.py input.sldprt output.step
    
    Or drag-and-drop: just run the script and it will prompt for a file.

This is a workaround for browser-based conversion. The STEP output can then be
uploaded to the KARAZA CAD Converter for mesh conversion.
"""

import sys
import os
import struct
import zlib
import io

def check_dependencies():
    """Check if required libraries are available."""
    missing = []
    try:
        import olefile
    except ImportError:
        missing.append('olefile')
    
    try:
        import FreeCAD
    except ImportError:
        # Try FreeCADCmd
        try:
            import FreeCADCmd
        except ImportError:
            missing.append('freecad')
    
    if missing:
        print(f"Missing dependencies: {', '.join(missing)}")
        print(f"Install with: pip install {' '.join(missing)}")
        print()
        print("Alternatively, install FreeCAD from https://www.freecad.org/")
        print("FreeCAD includes everything needed.")
        return False
    return True

def list_ole_streams(filepath):
    """List all streams in an OLE2 file."""
    import olefile
    
    ole = olefile.OleFileIO(filepath)
    streams = ole.listdir()
    print(f"\nOLE2 streams in {os.path.basename(filepath)}:")
    for stream in streams:
        path = '/'.join(stream)
        size = ole.get_size(stream)
        print(f"  {path} ({size} bytes)")
    ole.close()
    return streams

def extract_display_lists(filepath):
    """Extract and try to decompress DisplayLists streams."""
    import olefile
    
    ole = olefile.OleFileIO(filepath)
    results = {}
    
    for stream_path in ole.listdir():
        stream_name = stream_path[-1]
        if 'DisplayList' in stream_name:
            path = '/'.join(stream_path)
            data = ole.openstream(stream_path).read()
            print(f"\n  {path}: {len(data)} bytes")
            
            # Check if compressed
            if data[:2] == b'\x78\x01' or data[:2] == b'\x78\x9c' or data[:2] == b'\x78\xda':
                print("    Compressed (zlib), decompressing...")
                try:
                    data = zlib.decompress(data)
                    print(f"    Decompressed: {len(data)} bytes")
                except:
                    try:
                        data = zlib.decompress(data, -15)
                        print(f"    Decompressed (raw): {len(data)} bytes")
                    except Exception as e:
                        print(f"    Decompression failed: {e}")
            else:
                print("    Not compressed")
            
            results[path] = data
    
    ole.close()
    return results

def convert_with_freecad(filepath, output_path):
    """Convert SLDPRT to STEP using FreeCAD."""
    try:
        import FreeCAD
        import Import
    except ImportError:
        try:
            import FreeCADCmd as FreeCAD
            import Import
        except ImportError:
            print("FreeCAD not available. Please install FreeCAD.")
            return False
    
    print(f"\nLoading {filepath} with FreeCAD...")
    
    # Create a new document
    doc = FreeCAD.newDocument("SLDPRT_Import")
    
    try:
        # Import the SLDPRT file
        Import.importSldPart(filepath, doc.Name)
        
        # Export as STEP
        print(f"Exporting to {output_path}...")
        Import.export(doc.Objects, output_path)
        
        # Close document
        FreeCAD.closeDocument(doc.Name)
        
        print(f"✓ Successfully converted to {output_path}")
        return True
        
    except Exception as e:
        print(f"Conversion failed: {e}")
        print()
        print("Alternative methods:")
        print("  1. Open in FreeCAD: File → Import → select .sldprt")
        print("  2. Export as STEP: File → Export → select STEP format")
        print("  3. Upload the .step file to KARAZA CAD Converter")
        try:
            FreeCAD.closeDocument(doc.Name)
        except:
            pass
        return False

def main():
    if len(sys.argv) < 2:
        print("SLDPRT to STEP Converter")
        print("=" * 40)
        print()
        print("Usage: python sldprt-to-step.py <input.sldprt> [output.step]")
        print()
        print("This script converts SolidWorks .sldprt files to STEP format")
        print("using FreeCAD's import/export capabilities.")
        print()
        print("The resulting .step file can be uploaded to KARAZA CAD Converter")
        print("for mesh conversion (OBJ/STL).")
        sys.exit(1)
    
    input_file = sys.argv[1]
    if len(sys.argv) >= 3:
        output_file = sys.argv[2]
    else:
        output_file = os.path.splitext(input_file)[0] + '.step'
    
    if not os.path.exists(input_file):
        print(f"Error: File not found: {input_file}")
        sys.exit(1)
    
    print(f"Input:  {input_file} ({os.path.getsize(input_file) / 1024:.1f} KB)")
    print(f"Output: {output_file}")
    
    # List OLE2 streams
    try:
        list_ole_streams(input_file)
    except Exception as e:
        print(f"Not an OLE2 file: {e}")
        print("This might be a newer ZIP-based SLDPRT. Trying FreeCAD directly...")
    
    # Try FreeCAD conversion
    if convert_with_freecad(input_file, output_file):
        sys.exit(0)
    else:
        print("\nFreeCAD conversion failed. Showing stream analysis instead:")
        extract_display_lists(input_file)
        sys.exit(1)

if __name__ == '__main__':
    main()
