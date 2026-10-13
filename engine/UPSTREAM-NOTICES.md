# Third-party notices and format references

WoWS Toolbox is an unofficial community tool and is not endorsed by, sponsored
by, or affiliated with Wargaming Group Limited, Lesta Games, their licensors,
or their affiliates. Game names, trademarks, logos, game data, 3D models,
textures, audio, and all other game assets remain the property of their
respective owners. The root MIT license covers WoWS Toolbox code only; it does
not grant rights to extracted game assets. Users are responsible for following
the applicable game EULA, platform terms, and local law, and must not
redistribute or sell extracted assets without permission from the rights
holder.

This package is distributed under the root `LICENSE`. It does not bundle World
of Warships Legends, World of Warships PC, Korabli, or WoWS Blitz assets; generated models;
textures; replays; GLBs; Blender files; animation samples; or Oodle DLLs.

## CPython embedded runtime

- Project: <https://www.python.org/>
- Bundled version: CPython 3.10.11, Windows embeddable package (64-bit)
- License: Python Software Foundation License, reproduced in
  `Runtime/Python/LICENSE.txt`
- Upstream archive SHA-256:
  `608619f8619075629c9c69f361352a0da6ed7e62f83a0e19c63e0ea32eb7629d`
- Use: private interpreter for cataloging, extraction, texture conversion, and
  native OBJ assembly. It does not replace or modify a system Python install.

## Pillow

- Project: <https://pypi.org/project/pillow/12.3.0/>
- Bundled version: 12.3.0 (`cp310-cp310-win_amd64` wheel)
- License files: `Runtime/Python/Lib/site-packages/pillow-12.3.0.dist-info/licenses`
- Upstream wheel SHA-256:
  `300557495eb45ebb8aec96c2da9c4be642fbf7cd937278b4013ba894ea8eb0eb`
- Use: local DDS-derived texture image processing for portable OBJ/MTL output.

## UnityPy and WoWS Blitz codec dependencies

- Project: <https://github.com/K0lb3/UnityPy>
- Bundled version: UnityPy 1.25.3
- License: MIT, reproduced in
  `Runtime/Python/Lib/site-packages/unitypy-1.25.3.dist-info/licenses/LICENSE`
- Use: local parsing of user-supplied WoWS Blitz Unity AssetBundles,
  SerializedFiles, meshes, materials, and textures.

UnityPy's bundled runtime dependencies are:

- astc-encoder-py 0.1.12
- archspec 0.2.6
- attrs 26.1.0
- Brotli 1.2.0
- etcpak 0.9.15
- fsspec 2026.7.0
- lz4 4.4.5
- texture2ddecoder 1.0.6
- tpk_ar 0.2.4
- typing_extensions 4.16.0

UnityPy's optional FMOD audio converter and the proprietary FMOD runtime are
not bundled. WoWS Toolbox does not export game audio.
Their upstream license and notice files are preserved in the corresponding
`Runtime/Python/Lib/site-packages/*-dist-info` directories. These libraries
are executable format/codec support only; no WoWS Blitz OBB, AssetBundle,
DesignData, model, texture, or other game asset is included.

## Microsoft Edge WebView2 SDK

- Package: <https://www.nuget.org/packages/Microsoft.Web.WebView2>
- Bundled SDK version: 1.0.4078.44
- License: Microsoft WebView2 SDK license reproduced in
  `Viewer/LICENSE-WebView2.txt`
- Use: the WPF host control and loader used by the integrated offline 3D viewer.

The Inno Setup installer carries Microsoft's signed Evergreen bootstrapper only so it can install the WebView2 Runtime when the runtime is missing. The runtime itself is downloaded and installed by Microsoft.

- Bootstrapper source: <https://go.microsoft.com/fwlink/p/?LinkId=2124703>
- Bootstrapper SHA-256: `8C4A80540B6BBCBEF30A4E8C7D1AC504B6FC09DB922B4ACDFD85C9D5F6F1050E`
- Authenticode signer: Microsoft Corporation
- Use: prerequisite installation for the integrated 3D viewer only.

## Three.js

- Project: <https://threejs.org/>
- Bundled version: 0.185.1
- License: MIT, reproduced in `Viewer/LICENSE-ThreeJS.txt`
- Use: offline WebGL rendering, OBJ/MTL loading, orbit controls, transform
  controls, raycast selection, grid and wireframe display.

Only the modules needed by the local viewer are included. They do not contact a
CDN or external service.

WoWS Toolbox carries a local ImageBitmapLoader compatibility fix so duplicate
asynchronous requests for one cached image resolve to the decoded bitmap.

## landaire/wowsunpack

- Repository: <https://github.com/landaire/wowsunpack>
- Modified base commit: `53f7c6040780e6fede941fbf4579cf785fedb718`
- Package version: 0.23.0
- License: MIT
- Packaged executables:
  - `Backend/ship_material_probe.exe` — read-only Korabli hull material inspector;
    its source is included as `Backend/ship_material_probe.rs` and build details
    are in `docs/SHIP_2_MATERIAL_DETECTION.md`. The complete modified library,
    example and locked dependencies for this inspector are in `Backend/probe-source`
  - `Backend/wowsunpack.exe` — normal PC/Korabli ship-model exporter
  - `Backend/wowsunpack_armor.exe` — armor-sidecar exporter used only with the
    no-texture armor pass; it also emits exact per-triangle thickness metadata

The model exporter includes the Ships 2.0 geometry/material and independently
implemented BC7Prep texture changes. The dedicated armor exporter retains its
separately verified no-texture build with `--armor-json` and includes unified-root
armor geometry used by Ships 2.0 hulls. Their hashes are tracked individually
below. Armor is converted to the adjacent viewer sidecar and is not
merged into the editable OBJ.

Local modifications add current Korabli executable recognition, split
visual/node layouts, `_ports.visual` hardpoint merging, GameParams/assets-bin
overrides, package codec dispatch, dynamically loaded Oodle decoding, RPC
`FLOAT64` support for current PC builds, ship-specific export fixes, current
offset-binary packed-normal decoding, and correct right-handed triangle winding.
The MIT license text is reproduced by the package's root `LICENSE`.

Packaged SHA-256 values:

```text
3466A3FDC6C7EEEE696F365806D968BD1B2D5867E8537DD73A2C2F5795411A65  Backend/ship_material_probe.exe
5D465F21E8DDDD00605ABF1BF52B0C0AE5ABF0967144E22FE54C61F8CD82101F  Backend/wowsunpack.exe
5D465F21E8DDDD00605ABF1BF52B0C0AE5ABF0967144E22FE54C61F8CD82101F  Backend/wowsunpack_armor.exe
```

The Oodle runtime itself is proprietary external software. It is not copied,
modified, or redistributed here; users may point the GUI at a compatible DLL
from software they are entitled to use.

The Microsoft-signed `vcruntime140.dll` and `vcruntime140_1.dll` files from the
bundled CPython distribution are also placed beside the native exporters for
app-local loading. This avoids requiring a separate Visual C++ Redistributable
installation on a clean supported Windows system.

## wows-tools/wows-model-exporter

- Repository: <https://github.com/wows-tools/wows-model-exporter>
- Inspected commit: `284fd8fdbb1b6b90dbaa3872ed47c2917a00446d`
- License: MIT
- Use: high-level behavioral and format reference for GameParams component
  graphs, hardpoint transforms, BlendBone correction, render-set/material
  relationships, and glTF coordinate conventions.

The Legends parser is separately validated. PC/Korabli extraction uses the
modified `landaire/wowsunpack` build described above.

## wows-tools/wows-depack

- Repository: <https://github.com/wows-tools/wows-depack>
- License: MIT
- Use: public conceptual reference for World of Warships resource unpacking.

The bundled Legends extractor independently implements the inspected Legends
IDX v5/PKG contract and CRC checks.

## Simi4/WoT-Blender-Addons

- Repository: <https://github.com/Simi4/WoT-Blender-Addons>
- Inspected commit: `e711c6478cdb23503df8b17baac43db147b999d8`
- Relevant file: `tank_viewer/map_viewer/compiled_space/anca_reader/__init__.py`
- License: Do What The Fuck You Want To Public License, Version 2
- Use: `.anca` container/channel-table format reference.

The local ANCA reader adds bounds checks, preserves decoded values, treats the
verified Legends duration as a float, emits a versioned JSON schema, and states
that streamed bit-packed keys and standalone `.anim` remain unsupported. See
`FullAssembly/Ticonderoga1990/ANCA/THIRD_PARTY_NOTICES.md`.

## Research-only references not copied

### SkaceKamen/wot-model-converter

- Repository: <https://github.com/SkaceKamen/wot-model-converter>
- Inspected commit: `79abff5c376ad76f442d2259c0980cfacbeb1187`
- License finding: no redistribution license file was found in that commit.
- Use: behavioral cross-reference only. No source was copied.

### Gamemodels3D/TheRipperNotes

- Reference: <https://github.com/Gamemodels3D/TheRipperNotes/blob/main/Engines/BigWorld/04.format-primitives.md>
- Use: independent format-note cross-reference.

### wotcuk/WoT-Blender-Toolkit

- Repository: <https://github.com/wotcuk/WoT-Blender-Toolkit>
- Inspected commit: `59c5ca0af2e043b4091df788f2cc562e22980af8`
- License: GPL-3.0
- Use: research reference for Blender animation concepts only. Its GPL source
  is not copied or bundled, and it is not evidence that Legends standalone
  `.anim` is supported.

## Game assets

World of Warships Legends, World of Warships PC, Korabli, and World of Warships
Blitz models, textures, replays, animation data, names, and other game content remain assets of their
respective rights holders. Users must supply files from their own installation
and follow the game's terms and applicable law. This notice is not legal advice.

CPython, Pillow, UnityPy, and the listed codec dependencies are bundled under their licenses. PowerShell 5.1/7 is provided by Windows or the user. Blender is not required or invoked by WoWS Toolbox 5.0.61. The WebView2 bootstrapper is redistributed as described above; the WebView2 Runtime is supplied by Microsoft. Oodle runtimes are never redistributed and must come from the user's legally installed software.
