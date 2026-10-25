// Builds game-assets/assets.js from YOUR OWN Valheim install, for the optional "Game look".
//
//   pip install UnityPy
//   node tools/build-game-assets.js "C:\Program Files (x86)\Steam\steamapps\common\Valheim" [python.exe]
//
// The extracted art belongs to Iron Gate. It stays in game-assets/ on your computer, which is
// excluded from the repository by .gitignore. Never commit or share that folder.
//
// The pictures are packed into one script as data URLs because a page opened from disk may not
// read pixels from separate image files.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const CATALOG = require('../js/catalog.js');

const [valheim, python = 'python'] = process.argv.slice(2);
if (!valheim) {
  console.error('Usage: node tools/build-game-assets.js <Valheim folder> [python.exe]');
  process.exit(1);
}
const softref = path.join(valheim, 'valheim_Data', 'StreamingAssets', 'SoftRef');
const manifest = fs.readFileSync(path.join(softref, 'manifest_extended'), 'utf8');

// Find each wanted picture's full asset path in the game's manifest.
const names = [...new Set([...Object.values(CATALOG.gameArt), ...CATALOG.gameTextures, ...Object.values(CATALOG.gameUi)])];
const assetPaths = [];
for (const name of names) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = manifest.match(new RegExp(`Assets/UI/map/${esc}\\.png`)) ||
    manifest.match(new RegExp(`Assets/GameElements/Items/_icons/${esc}\\.png`)) ||
    manifest.match(new RegExp(`Assets/UI/textures/small/${esc}\\.png`)) ||
    manifest.match(new RegExp(`Assets/GameElements/Pieces/icons/${esc}\\.png`));
  if (m) assetPaths.push(m[0]);
  else console.warn(`not in this game version: ${name}`);
}

const outDir = path.join(__dirname, '..', 'game-assets');
const pngDir = path.join(outDir, 'png');
execFileSync(python, [path.join(__dirname, 'extract_valheim.py'), softref, pngDir, ...assetPaths], { stdio: 'inherit' });

const assets = {};
for (const name of names) {
  const file = path.join(pngDir, `${name}.png`);
  if (fs.existsSync(file)) assets[name] = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
}
fs.writeFileSync(path.join(outDir, 'assets.js'),
  `// Generated from your own Valheim install by tools/build-game-assets.js. Do not share.\n` +
  `window.GAME_ASSETS = ${JSON.stringify(assets)};\n`);
console.log(`Packed ${Object.keys(assets).length} pictures into game-assets/assets.js`);
