import json
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import project_store as store
import game_library as g
import launch

class StorageQueueTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.root=Path(self.temporary.name);self.home=patch.object(store,'HOME',self.root);self.home.start()
    def tearDown(self):
        if g.PAUSED:g.queue_control({'paused':False})
        g.EXTRACTION_QUEUE.join();self.home.stop();self.temporary.cleanup()
    def test_backups_are_versioned_by_ship_and_keep_five(self):
        for i in range(7):store.save_backup({'schema':'wows-skin-workshop/v1','source':{'name':'A','code':'AAAA123'},'documents':[],'revision':i})
        store.save_backup({'schema':'wows-skin-workshop/v1','source':{'name':'B','code':'BBBB123'},'documents':[]})
        backups=store.list_backups();self.assertEqual(len(backups),6)
        latest=next(b for b in backups if b['code']=='AAAA123');self.assertEqual(store.read_backup(latest['id'])['revision'],6)
        with self.assertRaises(ValueError):store.read_backup('../../other')
    def test_new_build_never_reuses_old_server(self):
        valid={'app':'wows-skin-workshop','version':launch.VERSION,'build':launch.BUILD_ID,'root':str(launch.ROOT)}
        self.assertTrue(launch.same_build(valid));self.assertFalse(launch.same_build({**valid,'build':'old'}));self.assertFalse(launch.same_build({**valid,'root':'different'}))
    def test_queue_order_pause_and_persistence(self):
        g.queue_control({'paused':True});seen=[]
        a=g.start_job('extract:order-a-'+str(time.time()),lambda p:seen.append('A'),serial=True)
        b=g.start_job('extract:order-b-'+str(time.time()),lambda p:seen.append('B'),serial=True)
        order=list(g.QUEUE_ORDER);order.remove(a);order.remove(b);g.queue_control({'order':[b,a,*order]})
        self.assertEqual(seen,[]);g.queue_control({'paused':False});g.EXTRACTION_QUEUE.join();self.assertEqual(seen,['B','A'])
        self.assertTrue((self.root/'queues'/g.QUEUE_FILE.name).is_file())
    def test_saved_queue_restores_in_order(self):
        store.atomic_json(self.root/'queues'/g.QUEUE_FILE.name,{'paused':False,'jobs':[{'folder':'game','code':'AAAA123','language':'en'},{'folder':'game','code':'BBBB123','language':'ko'}]})
        restored=[];done=threading.Event()
        def extract(game,code,language):
            restored.append((code,language))
            if len(restored)==2:done.set()
        with patch.object(g,'install_info',return_value={'id':'fixture'}),patch.object(g,'catalog_job',return_value='restored-catalog'),patch.dict(g.JOBS,{'restored-catalog':{'status':'done'}}),patch.object(g,'extract_job',side_effect=extract):
            g.restore_queue();self.assertTrue(done.wait(2))
        self.assertEqual(restored,[('AAAA123','en'),('BBBB123','ko')])
    def test_cache_delete_is_bounded_and_protects_open_model(self):
        identity='a'*16+'/123/models/AAAA123';folder=self.root/identity;folder.mkdir(parents=True);(folder/'ready.json').write_text(json.dumps({'engine':'old'}));(folder/'model.obj').write_text('mesh')
        with patch.object(g,'CACHE',self.root):
            self.assertFalse(g.list_model_cache()[0]['ready'])
            with self.assertRaises(ValueError):g.cache_control({'id':identity,'action':'delete','protected':str(folder)})
            with self.assertRaises(ValueError):g.cache_control({'id':'../outside','action':'delete'})
            g.cache_control({'id':identity,'action':'delete'});self.assertFalse(folder.exists())
    def test_paused_owned_process_stops_and_resumes(self):
        target=self.root/'ticks.txt';entered=threading.Event()
        command=[sys.executable,'-c',f'import time; f=open({str(target)!r},"a");\nwhile True: f.write("x"); f.flush(); time.sleep(.03)']
        def work(progress):entered.set();g.run_command(command,{},progress)
        game='pause-test-game';g.GAMES[game]={'folder':str(self.root)}
        job=g.start_job('extract:pause-child-'+str(time.time()),work,serial=True,metadata={'code':'AAAA123','game':game})
        self.assertTrue(entered.wait(1))
        for _ in range(100):
            if target.exists() and target.stat().st_size>2:break
            time.sleep(.03)
        try:
            g.queue_control({'paused':True});time.sleep(.08);size=target.stat().st_size;time.sleep(.12);self.assertEqual(target.stat().st_size,size)
            g.queue_control({'paused':False});time.sleep(.12);self.assertGreater(target.stat().st_size,size)
        finally:
            g.cancel_job(job)

if __name__=='__main__':unittest.main()
