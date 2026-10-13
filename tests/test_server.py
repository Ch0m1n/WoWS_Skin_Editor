import base64
import io
import json
from pathlib import Path
import struct
import sys
import unittest
import zipfile
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import safe_relative, contained, encode_dds, export_zip, import_texture, decode_png


def image_data():
    image = Image.new('RGBA', (16, 8), (210, 80, 40, 120))
    stream = io.BytesIO(); image.save(stream, format='PNG')
    return image, 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode()


class ExportTests(unittest.TestCase):
    def test_external_dds_import_preserves_alpha(self):
        image,_=image_data()
        for compression in ('rgba','dxt5'):
            source=encode_dds(image,compression,True)
            imported=import_texture({'data':base64.b64encode(source).decode()})
            decoded=decode_png(imported['data'])
            self.assertEqual(decoded.size,image.size)
            self.assertLess(abs(decoded.getpixel((4,4))[3]-120),4)
    def test_paths_cannot_escape(self):
        for value in ('../oops', '/absolute', 'D:/game', '..\\outside', 'textures/../../bad'):
            with self.assertRaises(ValueError): safe_relative(value)
        self.assertEqual(safe_relative('content\\test.dds'), 'content/test.dds')
        with self.assertRaises(ValueError): contained(Path.cwd(), '../oops')

    def test_dds_roundtrip_alpha_mips(self):
        image, _ = image_data()
        for compression in ('rgba', 'dxt5'):
            data = encode_dds(image, compression, True)
            self.assertEqual(data[:4], b'DDS ')
            self.assertEqual(struct.unpack_from('<I', data, 28)[0], 5)
            decoded = Image.open(io.BytesIO(data)).convert('RGBA')
            self.assertEqual(decoded.size, image.size)
            self.assertLess(abs(decoded.getpixel((4, 4))[3] - 120), 4)

    def test_export_has_valid_routes_and_xml(self):
        _, png = image_data()
        data = export_zip({'format': 'dds', 'compression': 'dxt5', 'mipmaps': True,
                           'textures': [{'name': 'test.png', 'target': 'content/gameplay/japan/ship/test_a.dds', 'data': png}],
                           'xml': '<data/>', 'xmlName': 'camouflages.xml'})
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            self.assertEqual(len(z.namelist()), 3)
            self.assertEqual(z.read('content/gameplay/japan/ship/test_a.dds')[:4], b'DDS ')
            self.assertEqual(z.read('camouflages.xml'), b'<data/>')
            self.assertEqual(json.loads(z.read('workshop-export.json'))['textures'][0]['height'], 8)

    def test_duplicates_and_unsafe_exports_rejected(self):
        _, png = image_data()
        row = {'name': 'x', 'target': 'same.dds', 'data': png}
        with self.assertRaises(ValueError): export_zip({'format': 'dds', 'textures': [row, row]})
        with self.assertRaises(ValueError): export_zip({'textures': [{**row, 'target': '../outside.dds'}]})
        with self.assertRaises(ValueError): export_zip({'textures': []})


if __name__ == '__main__':
    unittest.main()
