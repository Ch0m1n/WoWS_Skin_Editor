import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import game_library as library

class PreparedShipsTests(unittest.TestCase):
    def test_only_complete_exports_for_matching_game_and_engine_are_ready(self):
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp);key='game';current=base/'engine-current'
            def model(engine,build,code,complete=True,obj=True):
                folder=base/engine/key/build/'models'/code;folder.mkdir(parents=True)
                if complete:(folder/'ready.json').write_text(json.dumps({'engine':'current' if engine=='engine-current' else 'old','code':code}))
                if obj:(folder/f'{code}.obj').write_text('')
            model('engine-old','10','READY');model('engine-current','10','READY')
            model('engine-old','10','STALE');model('engine-current','9','OLD_BUILD')
            model('engine-current','10','PARTIAL',False);model('engine-current','10','MISSING_OBJ',obj=False)
            other=base/'engine-current'/'other'/'10'/'models'/'OTHER';other.mkdir(parents=True)
            with patch.object(library,'BASE_CACHE',base),patch.object(library,'CACHE',current),patch.object(library,'ENGINE_ID','current'),patch.dict(library.GAMES,{key:{'folder':temp,'build':'10'}},clear=True):
                self.assertEqual(library.prepared_ships(key),{'READY':'ready','STALE':'stale','OLD_BUILD':'stale'})
