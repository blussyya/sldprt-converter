import olefile
import zlib
import struct
import os
import brotli

# Open the SLDPRT file
filepath = r'D:\karaza\websites\Karazas-website\sldprt-research\new-samples\SLIDING TABLE.SLDPRT'
ole = olefile.OleFileIO(filepath)

print("=== OLE2 Stream List ===")
streams = ole.listdir()
for s in streams:
    path = '/'.join(s)
    size = ole.get_size(path)
    print(f"  {path} ({size} bytes)")

# Check for streams we haven't examined
print("\n=== Checking all streams for Parasolid data ===")
for s in streams:
    path = '/'.join(s)
    data = ole.openstream(path).read()
    
    # Check for PS header (neutral binary)
    if len(data) > 4 and data[0:2] == b'PS' and data[2:4] == b'\x00\x00':
        print(f"  {path}: PARASOLID NEUTRAL BINARY!")
    
    # Check for bare binary 'B' header
    if len(data) > 4 and data[0:1] == b'B':
        print(f"  {path}: Possible PARASOLID BARE BINARY!")
    
    # Check for Parasolid transmit text header
    if b'PARASOLID' in data[:100]:
        print(f"  {path}: Contains PARASOLID string!")
    
    # Check for PK_ (Parasolid kernel function names)
    if b'PK_' in data[:1000]:
        print(f"  {path}: Contains PK_ string!")
    
    # Check for SCH_ (schema)
    if b'SCH_' in data[:1000]:
        print(f"  {path}: Contains SCH_ string!")

# Focus on Config-0-Body
print("\n=== Config-0-Body deep analysis ===")
body_path = 'Contents/Config-0-Body'
if ole.exists(body_path):
    body_data = ole.openstream(body_path).read()
    print(f"Size: {len(body_data)} bytes")
    
    # The first 24 bytes might be a header
    header = body_data[:24]
    print(f"Header: {header.hex()}")
    
    # Try to find where actual data starts
    # Look for patterns that might indicate data sections
    
    # Search for float64 values that look like coordinates
    # SLIDING TABLE dimensions: ~112mm x 40mm x 6mm
    target_values = [112.1426, 40.0674, 5.9861]
    for target in target_values:
        target_bytes = struct.pack('<d', target)
        idx = body_data.find(target_bytes)
        if idx >= 0:
            print(f"  Found {target} at offset {idx} (0x{idx:x})")
            # Show context
            context = body_data[max(0,idx-16):idx+24]
            print(f"    Context: {context.hex()}")

# Check DisplayLists__Zip
print("\n=== DisplayLists__Zip analysis ===")
dl_path = 'Contents/DisplayLists__Zip'
if ole.exists(dl_path):
    dl_data = ole.openstream(dl_path).read()
    print(f"Size: {len(dl_data)} bytes")
    print(f"Header: {dl_data[:16].hex()}")
    
    # Try brotli at offset 14
    try:
        decompressed = brotli.decompress(dl_data[14:])
        print(f"Brotli @ 14: {len(decompressed)} bytes")
        
        # Search for Parasolid markers in decompressed data
        if b'PARASOLID' in decompressed:
            print("  Contains PARASOLID!")
        if b'VERTEX' in decompressed:
            print("  Contains VERTEX!")
        if b'EDGE' in decompressed:
            print("  Contains EDGE!")
        if b'FACE' in decompressed:
            print("  Contains FACE!")
        if decompressed[0:2] == b'PS':
            print("  PARASOLID HEADER!")
    except Exception as e:
        print(f"Brotli error: {e}")

# Also check for any stream we might have missed
print("\n=== Checking for hidden streams ===")
for s in streams:
    path = '/'.join(s)
    data = ole.openstream(path).read()
    
    # Check for zlib compressed data
    for offset in range(min(len(data), 100)):
        if offset + 2 < len(data) and data[offset] == 0x78 and data[offset+1] in (0x01, 0x9C, 0xDA):
            try:
                result = zlib.decompress(data[offset:])
                if len(result) > 100:
                    if b'PARASOLID' in result or result[0:2] == b'PS':
                        print(f"  {path} @ {offset}: zlib -> PARASOLID!")
            except:
                pass
    
    # Check for brotli compressed data
    for offset in range(min(len(data), 200)):
        try:
            result = brotli.decompress(data[offset:])
            if len(result) > 200:
                if b'PARASOLID' in result or result[0:2] == b'PS':
                    print(f"  {path} @ {offset}: brotli -> PARASOLID!")
                if b'VERTEX' in result or b'EDGE' in result or b'FACE' in result:
                    print(f"  {path} @ {offset}: brotli -> VERTEX/EDGE/FACE!")
        except:
            pass

ole.close()
