#!/usr/bin/env python3
"""Check 64-bit PT_LOAD alignment in the actual APK/AAB native libraries."""
import argparse
from pathlib import Path
import re
import struct
import zipfile

def load_alignment(data):
    if len(data)<64 or data[:4]!=b'\x7fELF' or data[4]!=2 or data[5] not in (1,2):
        raise ValueError('Missing or invalid 64-bit ELF header')
    endian='<' if data[5]==1 else '>'
    offset=struct.unpack_from(endian+'Q',data,32)[0]
    size,count=struct.unpack_from(endian+'HH',data,54)
    if size<56 or not count or offset+size*count>len(data):
        raise ValueError('Invalid ELF program-header table')
    values=[]
    for i in range(count):
        start=offset+i*size
        if struct.unpack_from(endian+'I',data,start)[0]!=1:continue
        alignment=struct.unpack_from(endian+'Q',data,start+48)[0]
        if alignment<16384 or alignment&(alignment-1):
            raise ValueError('PT_LOAD alignment is below 16 KB or invalid')
        values.append(alignment)
    if not values:raise ValueError('ELF has no loadable segments')
    return min(values)

def verify(artifact):
    result={}
    with zipfile.ZipFile(artifact) as z:
        names=z.namelist()
        if len(names)!=len(set(names)):raise ValueError('Duplicate entries in native package')
        for name in names:
            if re.search(r'/lib/(?:arm64-v8a|x86_64)/[^/]+\.so$', '/'+name):
                try:result[name]=load_alignment(z.read(name))
                except ValueError as e:raise ValueError(name+': '+str(e)) from None
    if not result:raise ValueError('No 64-bit native libraries were found')
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--artifact',type=Path,required=True);args=p.parse_args()
    try:print(f'PASS {args.artifact.name}: {len(verify(args.artifact))} 64-bit native libraries have 16 KB load alignment.')
    except (ValueError,OSError,zipfile.BadZipFile) as e:p.exit(1,'ANDROID_NATIVE_PAGES: BLOCKED '+str(e)+'\n')
