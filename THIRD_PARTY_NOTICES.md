# Third-party notices

This application includes Three.js 0.185.1, distributed under the MIT License.

- Project: https://github.com/mrdoob/three.js
- Included files: `web/vendor/three/build`, selected modules under `web/vendor/three/examples/jsm`
- Full license and copyright notice: `web/vendor/three/LICENSE`

The backend uses Pillow, installed separately by the Python environment.

- Project: https://python-pillow.github.io/
- License: https://github.com/python-pillow/Pillow/blob/main/LICENSE

The War Thunder Skin Editor repository was inspected for product research. Its code
and executable are not included in the workshop application.

Game models and textures are loaded from folders selected by the user; they are not
distributed with this application.

## Included extraction engine

`engine/Backend` contains selected MIT-licensed WoWS Toolbox 5.0.77 Python modules
and its modified landaire/wowsunpack 0.23.0 model exporter. No installed Toolbox
program is required at runtime. The copyright notice is reproduced in
`engine/LICENSE-Toolbox`. Upstream executable hashes, codec notes and attribution
are retained in `engine/UPSTREAM-NOTICES.md`. The included exporter SHA-256 is
`5D465F21E8DDDD00605ABF1BF52B0C0AE5ABF0967144E22FE54C61F8CD82101F`.

`OBJLoader.js` has one local modification: its Three.js import is relative so it
also works inside a module worker, where document import maps are unavailable.

Portable builds include CPython 3.10.11 and its license in
`Runtime/Python/LICENSE.txt`, Pillow 12.3.0 and its license under
`Runtime/Python/Lib/site-packages/pillow-12.3.0.dist-info/licenses`, and app-local
Microsoft VC runtime files. No game assets, Oodle runtime, pre-unpacked game
directory or extracted model cache is included in the release.
