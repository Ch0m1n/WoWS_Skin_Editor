import json
import io
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
import game_library as g
import server
from test_server import image_data
import native_glb_export as native
import pbr_materials as pbr
from types import SimpleNamespace

class ReviewRegressionTests(unittest.TestCase):
    def test_shutdown_blocks_queued_work_and_new_jobs(self):
        handler=object.__new__(server.Handler);handler.headers={'Content-Type':'application/json'};payload=json.dumps({'action':'restart'}).encode();handler.headers['Content-Length']=str(len(payload));handler.rfile=io.BytesIO(payload);handler.path='/api/server-control';handler.server=SimpleNamespace(closing=False);handler.check_host=lambda:None
        replies=[];handler.json=lambda value,status=200:replies.append((value,status))
        with patch.dict(g.JOBS,{'queued':{'status':'queued'}},clear=True):handler.do_POST()
        self.assertEqual(replies[-1][1],400);self.assertFalse(handler.server.closing)
        with patch.object(g,'SHUTTING_DOWN',True),patch.dict(g.JOBS,{},clear=True),self.assertRaises(ValueError):g.start_job('new',lambda _:None)

    def test_windows_output_collisions_and_device_names(self):
        _,data=image_data()
        for targets in [('Hull/a.dds','hull/A.dds'),('CON.dds','other.dds'),('hull./a.dds','other.dds')]:
            with self.subTest(targets=targets),self.assertRaises(ValueError):
                server.export_zip({'format':'png','textures':[{'name':'a','target':p,'data':data} for p in targets]})

    def test_finished_resolve_work_is_not_reused(self):
        done=threading.Event();calls=[]
        def work(progress):calls.append(1);done.set();return {'folder':'temporary'}
        with patch.dict(g.JOBS,{},clear=True):
            first=g.start_job('resolve:fixture',work,reuse_done=False);self.assertTrue(done.wait(2))
            for _ in range(100):
                if g.JOBS[first]['status']=='done':break
                time.sleep(.01)
            done.clear();second=g.start_job('resolve:fixture',work,reuse_done=False);self.assertTrue(done.wait(2))
            self.assertNotEqual(first,second);self.assertEqual(len(calls),2)

    def test_catalog_refresh_invalidates_completed_lookup(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);translation=root/'bin/10/res/texts/en/LC_MESSAGES/global.mo';translation.parent.mkdir(parents=True);translation.write_bytes(b'fixture')
            signature='catalog:fixture:10:en:cache';old={'signature':signature,'status':'done','result':{'ships':['old']}}
            with patch.dict(g.GAMES,{'fixture':{'folder':str(root),'build':10}},clear=True),patch.dict(g.JOBS,{'old':old},clear=True),patch.object(g,'cache_dir',return_value=root),patch.object(g,'install_info',return_value={'id':'fixture'}),patch('catalog.pc_catalog',return_value=[{'ShipCode':'NEW'}]):
                job=g.catalog_job('fixture',refresh=True,language='en')
                for _ in range(200):
                    if g.JOBS[job]['status'] not in ('running','queued'):break
                    time.sleep(.01)
                self.assertEqual(g.JOBS[job]['status'],'done');self.assertEqual(g.JOBS['old']['status'],'invalidated')
                new=g.catalog_job('fixture',language='en');self.assertNotEqual(new,'old')
                for _ in range(200):
                    if g.JOBS[new]['status']!='running':break
                    time.sleep(.01)
                self.assertEqual(g.JOBS[new]['result']['ships'],[{'ShipCode':'NEW'}])

    def test_external_image_and_accessor_boundaries(self):
        with tempfile.TemporaryDirectory() as temporary:
            source=Path(temporary)/'model.glb';source.write_bytes(b'')
            with self.assertRaises(native.NativeGlbError):native.image_payload({},b'',{'uri':'../secret.png'},source)
        doc={'accessors':[{'bufferView':0,'componentType':5126,'type':'VEC3','count':2}], 'bufferViews':[{'byteLength':12}]}
        with self.assertRaises(native.NativeGlbError):native.accessor_values(doc,b'\0'*24,0)

    def test_pbr_cache_resolution_namespaces(self):
        # Stop before conversion; verify every downstream cache operation receives the size namespace.
        seen=[]
        def stop(exporter,game,cache):seen.append(cache);raise RuntimeError('probe')
        with tempfile.TemporaryDirectory() as temporary,patch.object(pbr,'load_mfm_paths',side_effect=stop):
            root=Path(temporary)
            for size in (0,1024,4096):
                with self.assertRaisesRegex(RuntimeError,'probe'):pbr.prepare_pbr_materials({},exporter=root/'engine',game_dir=root,texture_dir=root,work_dir=root,cache_root=root,max_size=size)
            self.assertEqual(seen,[root,root/'resolution-1024',root/'resolution-4096'])
