"""Extract named textures from a local Valheim install into PNG files.

Usage: python extract_valheim.py <StreamingAssets/SoftRef dir> <out dir> <asset path> [<asset path> ...]
Asset paths are as listed in the game's manifest, e.g. Assets/UI/map/forest.png
Needs UnityPy (pip install UnityPy). Normally run by tools/build-game-assets.js.
"""
import os
import re
import sys

import UnityPy

softref, out_dir, *wanted = sys.argv[1:]
os.makedirs(out_dir, exist_ok=True)

# The manifest maps every asset path to the bundle file that holds it.
with open(os.path.join(softref, "manifest_extended"), encoding="utf-8", errors="replace") as f:
    manifest = f.read()
bundle_of = {
    m.group(2): m.group(1)
    for m in re.finditer(r"bundle: ([0-9a-f]+)\.?\s*\n\s*path in bundle: (.+?)\.?\s*\n", manifest)
}

by_bundle = {}
for path in wanted:
    b = bundle_of.get(path)
    if b is None:
        print(f"MISSING in manifest: {path}")
        continue
    by_bundle.setdefault(b, []).append(path)

saved = 0
for bundle, paths in by_bundle.items():
    env = UnityPy.load(os.path.join(softref, "Bundles", bundle))
    containers = {k.lower(): v for k, v in env.container.items()}
    for path in paths:
        obj = containers.get(path.lower())
        if obj is None:
            print(f"NOT FOUND in bundle {bundle}: {path}")
            continue
        data = obj.read()
        if not hasattr(data, "image"):
            print(f"NOT AN IMAGE ({obj.type.name}): {path}")
            continue
        name = os.path.splitext(os.path.basename(path))[0]
        data.image.save(os.path.join(out_dir, name + ".png"))
        saved += 1

print(f"extracted {saved} of {len(wanted)}")
