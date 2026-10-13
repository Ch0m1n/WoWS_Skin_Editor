"""Optional regression against locally extracted game models, never bundled assets."""
import os
import hashlib
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'engine'/'Backend'))
import native_glb_export as export

@unittest.skipUnless(os.environ.get('FLANDRE_ORIGINAL_GLB') and os.environ.get('FLANDRE_FIXED_GLB'),'Set local original/fixed GLB paths')
class BindPoseOutputTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original,cls.old_binary=export.load_glb(Path(os.environ['FLANDRE_ORIGINAL_GLB']))
        cls.fixed,cls.new_binary=export.load_glb(Path(os.environ['FLANDRE_FIXED_GLB']))

    def primitive_key(self,doc,binary,primitive):
        uv=export.accessor_values(doc,binary,primitive['attributes']['TEXCOORD_0']) if 'TEXCOORD_0' in primitive['attributes'] else []
        return (doc['materials'][primitive['material']]['name'],hashlib.sha256(repr(uv).encode()).hexdigest(),doc['accessors'][primitive['attributes']['POSITION']]['count'])

    def paired_meshes(self):
        before={m['name']:m for m in self.original['meshes']};after={m['name']:m for m in self.fixed['meshes']}
        self.assertEqual(set(before),set(after))
        for name,old in before.items():yield old,after[name]

    def paired_primitives(self,old,new):
        new_parts={self.primitive_key(self.fixed,self.new_binary,p):p for p in new['primitives']}
        self.assertEqual(len(old['primitives']),len(new['primitives']))
        for a in old['primitives']:
            key=self.primitive_key(self.original,self.old_binary,a)
            self.assertIn(key,new_parts,'UV and material identity preserved regardless of export ordering')
            yield a,new_parts[key]

    def test_uvs_and_static_geometry_are_unchanged(self):
        for old,new in self.paired_meshes():
            for a,b in self.paired_primitives(old,new):
                material=self.original['materials'][a['material']]['name']
                if 'skinned' not in material.lower():
                    self.assertEqual(export.accessor_values(self.original,self.old_binary,a['attributes']['POSITION']),export.accessor_values(self.fixed,self.new_binary,b['attributes']['POSITION']))

    def test_chimney_stays_in_its_own_hull_section(self):
        mesh=next(m for m in self.fixed['meshes'] if m['name']=='FSB031_Flandre_1952_MidBack')
        body=export.accessor_values(self.fixed,self.new_binary,mesh['primitives'][0]['attributes']['POSITION'])
        low,high=min(v[2] for v in body),max(v[2] for v in body)
        for primitive in mesh['primitives']:
            material=self.fixed['materials'][primitive['material']]['name']
            if 'skinned' not in material.lower():continue
            points=export.accessor_values(self.fixed,self.new_binary,primitive['attributes']['POSITION'])
            self.assertGreaterEqual(min(v[2] for v in points),low)
            self.assertLessEqual(max(v[2] for v in points),high)

    def test_attached_turret_geometry_does_not_flip(self):
        for old,new in self.paired_meshes():
            if not old['name'].startswith('HP_FGM_'):continue
            for a,b in self.paired_primitives(old,new):
                before=export.accessor_values(self.original,self.old_binary,a['attributes']['POSITION'])
                after=export.accessor_values(self.fixed,self.new_binary,b['attributes']['POSITION'])
                self.assertEqual(len(before),len(after))
                self.assertLess(max(abs(x-y) for p,q in zip(before,after) for x,y in zip(p,q)),0.001)

if __name__=='__main__':unittest.main()
