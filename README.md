# ValMap

Draw your own map while playing Valheim with the map turned off.

The world starts as ocean on a round map with spawn in the middle. Paint the land you find,
then drop big icons for the places you discover.

> Unofficial fan tool. Not affiliated with Iron Gate or Coffee Stain. The optional "Game look"
> uses Valheim art (c) Iron Gate AB; see [CREDITS.md](CREDITS.md).

## Run it

Double-click **`ValMap.cmd`**. It opens ValMap in its own window with Microsoft Edge.

You can also open `index.html` in any modern browser. No install, no internet needed.

## How to use

1. **Paint the land.** Pick a biome on the left and drag on the map. Pick **Ocean** to erase land.
   Each biome also has its own details, picked under "Draw on ..." and painted over that biome:

   | Biome | Details |
   |---|---|
   | Meadows | Beech, Birch, Oak |
   | Black Forest | Fir, Pine, Boulders |
   | Swamp | Dead trees, Bog water |
   | Mountain | High peaks, Hills, Fir |
   | Plains | Birch, Oak, Rocks |
   | Mistlands | Cliffs, Yggdrasil, Mist |
   | Ashlands | Lava, Ashwood |
   | Deep North | Snowy Fir, Snow hills, Ice |

   Details stack: paint Oak over Beech for a mixed forest, or Hills next to High peaks.
   To remove details, paint land or water over them.
2. **Add places.** The right side shows places for the biome you picked (Crypt, Troll Cave,
   Copper...). Click one, then click the map. Places under **Anywhere** work in every biome.
3. **Change a place.** Click it to name it or delete it. Drag it to move it.

Your map saves itself automatically. Use **Save** to keep a `.valmap` file and **Picture** to
export a PNG.

| Action | Mouse / key |
|---|---|
| Paint | Left-drag |
| Move the map | Right-drag, or hold Space and drag, or the Move tool |
| Zoom | Mouse wheel, or `+` / `-` |
| Pick a biome | `1` to `9` |
| Brush size | `[` and `]` |
| Paint / Move tool | `B` / `M` |
| Step through Land and the biome's details | `T` |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Y` |
| Delete selected place | `Delete` |
| Show / hide all places | `P` |
| Save | `Ctrl+S` |

## Game look

The **Game look** button switches to Valheim's own map textures (parchment, water, forests,
mountains), trophy, item and map-pin icons, and wooden panel and button textures. This art is
(c) Iron Gate AB, is not covered by ValMap's MIT license, and is used only in this free,
non-commercial fan project (see [CREDITS.md](CREDITS.md)). It is packed in `game-assets/assets.js`.

To refresh it after a Valheim update:

1. Install Python and run `pip install UnityPy`
2. Run `node tools/build-game-assets.js "C:\Program Files (x86)\Steam\steamapps\common\Valheim"`

## Feedback

The **Feedback** button (bottom left) opens a pre-filled GitHub issue titled "Feedback: ...".
Reports are checked first by `js/bugcheck.js`: 10 to 255 characters of plain text, with no links,
code, HTML, markdown links, @mentions or hidden characters, and at most one report per minute.

To collect all reports into `bug-reports.json` (checked again, suspicious ones marked `flagged`):

```
node tools/export-bug-reports.js
```

## Project layout

```
index.html          the app
css/style.css       look and feel
fonts/              Averia Serif Libre (SIL Open Font License)
js/catalog.js       biomes and places (edit this to add icons)
js/icons.js         generated icon shapes, do not edit
js/app.js           painting, places, undo, saving
tools/build-icons.js  rebuilds js/icons.js from game-icons.net
```

### Adding a place

1. Find an icon on [game-icons.net](https://game-icons.net) and note its `author/name`.
2. Add it to the right biome in `js/catalog.js`.
3. Download and extract https://github.com/game-icons/icons/archive/refs/heads/master.zip
4. Run `node tools/build-icons.js <path-to-extracted-icons-master>`
5. Add the author to `CREDITS.md` if they are new.

## License

Code: MIT. Icons: CC BY 3.0 from game-icons.net. Font: SIL OFL 1.1. See [CREDITS.md](CREDITS.md).
