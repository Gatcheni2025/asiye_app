import struct
import tempfile
from pathlib import Path
import unittest
import zipfile
from scripts.verify_android_native_pages import load_alignment,verify

def elf(alignment):
    b=bytearray(120);b[:6]=b'\x7fELF\x02\x01'
    struct.pack_into('<Q',b,32,64);struct.pack_into('<HH',b,54,56,1)
    struct.pack_into('<I',b,64,1);struct.pack_into('<Q',b,112,alignment)
    return b

class NativePageTests(unittest.TestCase):
    def test_elf_rejects_4k_invalid_and_truncated_load_segments(self):
        self.assertEqual(load_alignment(elf(16384)),16384)
        for b in (elf(4096),elf(24576),elf(0),elf(16384)[:70],b'not ELF'):
            with self.assertRaises(ValueError):load_alignment(b)
    def test_actual_package_layouts_check_all_64bit_libraries(self):
        with tempfile.TemporaryDirectory() as d:
            for ext,prefix in (('apk','lib/'),('aab','base/lib/')):
                p=Path(d)/('candidate.'+ext)
                for bad in (False,True):
                    with zipfile.ZipFile(p,'w') as z:
                        z.writestr(prefix+'arm64-v8a/libflutter.so',elf(16384))
                        z.writestr(prefix+'x86_64/libplugin.so',elf(4096 if bad else 16384))
                        z.writestr(prefix+'armeabi-v7a/libflutter.so',b'32-bit ABI does not run on 16 KB 64-bit devices')
                    if bad:
                        with self.assertRaisesRegex(ValueError,'libplugin'):verify(p)
                    else:self.assertEqual(len(verify(p)),2)
if __name__=='__main__':unittest.main()
