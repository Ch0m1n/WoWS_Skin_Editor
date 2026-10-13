import json
import sys
from pathlib import Path
import unittest
from unittest.mock import patch
import tempfile
import time
import threading
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import game_library as g

class LibraryTests(unittest.TestCase):
    def test_camouflage_reads_original_archive_only(self):
        from types import SimpleNamespace
        entry = SimpleNamespace(unpacked_size=100)
        info = {'id':'camo-test','folder':str(Path(self.storage.name)),'build':123}
        with patch.dict(g.GAMES, {'camo-test': info}), patch.object(g,'install_info',return_value=info), \
             patch('game_archive.read_archive_index',return_value=(123,{'/camouflages.xml':entry})), \
             patch('game_archive.extract_entry',return_value=b'\xef\xbb\xbf<data/>') as read, patch.object(g,'camouflage_labels',return_value={}):
            result = g.camouflage_xml('camo-test')
            self.assertEqual(result['xml'],'<data/>')
            self.assertEqual(result['name'],'camouflages.xml')
            read.assert_called_once_with(Path(info['folder']),entry)
            self.assertEqual(list(Path(self.storage.name).iterdir()),[])

    def test_camouflage_missing_or_oversized_is_rejected(self):
        from types import SimpleNamespace
        info = {'id':'camo-test','folder':str(Path(self.storage.name)),'build':123,'entries':{}}
        with patch.dict(g.GAMES, {'camo-test':info}), patch.object(g,'install_info',return_value=info), \
             patch('game_archive.extract_entry') as read:
            with self.assertRaises(FileNotFoundError): g.camouflage_xml('camo-test')
            info['entries']['/camouflages.xml'] = SimpleNamespace(unpacked_size=33*1024*1024)
            with self.assertRaises(ValueError): g.camouflage_xml('camo-test')
            read.assert_not_called()

    def setUp(self):
        self.storage=tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.home_patch=patch.object(g.project_store,'HOME',Path(self.storage.name));self.home_patch.start()
    def tearDown(self):
        g.EXTRACTION_QUEUE.join();self.home_patch.stop();self.storage.cleanup()
    def test_cancel_queued_job_does_not_run_and_can_retry(self):
        entered=threading.Event();release=threading.Event();ran=threading.Event()
        blocker=g.start_job('block-'+str(time.time()),lambda p:(entered.set(),release.wait(3)),serial=True)
        self.assertTrue(entered.wait(1));signature='extract:cancel-test:'+str(time.time())
        job=g.start_job(signature,lambda p:ran.set(),serial=True)
        try:
            self.assertEqual(g.cancel_job(job),'cancelled')
        finally:release.set()
        g.EXTRACTION_QUEUE.join();self.assertFalse(ran.is_set())
        retry=g.start_job(signature,lambda p:{'ok':True},serial=True);g.EXTRACTION_QUEUE.join()
        self.assertNotEqual(job,retry);self.assertEqual(g.JOBS[retry]['status'],'done')

    def test_cancel_running_extraction_terminates_owned_child(self):
        started=threading.Event()
        def work(progress):
            started.set();g.run_command([sys.executable,'-c','import time; print("waiting",flush=True); time.sleep(60)'],{},progress)
        job=g.start_job('extract:child-test:'+str(time.time()),work,serial=True)
        self.assertTrue(started.wait(1))
        for _ in range(100):
            if job in g.JOB_PROCESSES:break
            time.sleep(.01)
        self.assertIn(job,g.JOB_PROCESSES);g.cancel_job(job)
        for _ in range(100):
            if g.JOBS[job]['status']=='cancelled':break
            time.sleep(.01)
        self.assertEqual(g.JOBS[job]['status'],'cancelled');self.assertNotIn(job,g.JOB_PROCESSES)
    def test_extraction_queue_runs_one_ship_at_a_time(self):
        first_started=threading.Event();release=threading.Event();second_started=threading.Event()
        def first(progress):
            first_started.set();release.wait(3);return {'first':True}
        key=g.start_job('queue-first-'+str(time.time()),first,serial=True)
        self.assertTrue(first_started.wait(1))
        second=g.start_job('queue-second-'+str(time.time()),lambda p:(second_started.set() or {'second':True}),serial=True)
        try:
            self.assertEqual(g.JOBS[second]['status'],'queued');self.assertFalse(second_started.is_set())
        finally:release.set()
        self.assertTrue(second_started.wait(1))
    def test_preview_precedes_silhouette(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as tmp, patch.object(g, 'game_dir', return_value=Path(tmp)), patch.object(g, 'cache_dir', return_value=Path(tmp)), patch.dict(g.GAMES, {'test': {'entries': {'/gui/ship_preview/pjsc769.png': 'preview', '/gui/ship_icons/pjsc769.png': 'icon'}}}), patch('game_archive.extract_entry', return_value=b'preview') as extract:
            self.assertEqual(g.thumbnail('test', 'PJSC769').read_bytes(), b'preview')
            self.assertEqual(extract.call_args.args[1], 'preview')
    def test_job_exposes_measured_progress(self):
        def work(progress):
            progress('Textures', percent=54, stage='texture')
            return {'ok': True}
        key = g.start_job('test-progress-'+str(time.time()), work)
        for _ in range(100):
            if g.JOBS[key]['status'] != 'running': break
            time.sleep(.01)
        self.assertEqual(g.JOBS[key]['status'], 'done')
        self.assertEqual(g.JOBS[key]['percent'], 100)
        self.assertEqual(g.JOBS[key]['stage'], 'texture')
    def test_invalid_install(self):
        self.assertIsNone(g.install_info(Path(__file__).parent))
    def test_unknown_game_is_rejected(self):
        with self.assertRaises(ValueError):g.game_dir('unknown')
    def test_invalid_language_is_rejected(self):
        with self.assertRaises(ValueError):g.catalog_job('unknown',language='zh')
    def test_installed_engine_is_self_contained(self):
        # Pure-Python components must import using only the included engine and Pillow.
        import catalog, native_glb_export, compat_cache
        self.assertTrue((g.ENGINE/'wowsunpack.exe').is_file())

if __name__=='__main__':unittest.main()
