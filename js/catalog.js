// Everything the map knows about: biomes (paint tools) and places (map icons).
// Icons are referenced as "author/name" from game-icons.net (CC BY 3.0).
// The biome `id` is stored in save files, so never renumber existing biomes.
// `detail` is what can be drawn on top of the land: 'trees' or 'lava'.
// `details` lists what can be drawn on top of a biome's land, as found in the game. They stack
// like layers, and painting land or water clears them. A detail's position in the list is its bit
// in save files, so only ever add new ones at the END of a biome's list.

const CATALOG = {
  // Everything that can be drawn on land. `type`:
  //   tree  - forest (side-on trees, or the game's forest texture in the game look)
  //   glyph - scattered map symbols (peaks, rocks, dead trees...)
  //   area  - covers the ground with its own color (lava, bog water, ice, mist)
  details: {
    beech:    { name: 'Beech', type: 'tree' },
    birch:    { name: 'Birch', type: 'tree' },
    oak:      { name: 'Oak', type: 'tree' },
    fir:      { name: 'Fir', type: 'tree' },
    pine:     { name: 'Pine', type: 'tree' },
    snowfir:  { name: 'Snowy Fir', type: 'tree' },
    boulders: { name: 'Boulders', type: 'glyph' },
    deadtree: { name: 'Dead trees', type: 'glyph' },
    peak:     { name: 'High peaks', type: 'glyph' },
    hill:     { name: 'Hills', type: 'glyph' },
    rocks:    { name: 'Rocks', type: 'glyph' },
    cliff:    { name: 'Cliffs', type: 'glyph' },
    shoot:    { name: 'Yggdrasil', type: 'glyph' },
    ashwood:  { name: 'Ashwood', type: 'glyph' },
    snowhill: { name: 'Snow hills', type: 'glyph' },
    bog:      { name: 'Bog water', type: 'area', color: '#4d5c45', edge: '#262e1f' },
    mist:     { name: 'Mist', type: 'area', color: '#b9b2d0', edge: '#8c84a8' },
    lava:     { name: 'Lava', type: 'area', color: '#f26a1b', edge: '#4a1408' },
    ice:      { name: 'Ice', type: 'area', color: '#e9f7ff', edge: '#8fbcd4' },
  },

  biomes: [
    { id: 1, key: 'meadows',     name: 'Meadows',      color: '#93c25a', badge: '#4f7d2a', icon: 'delapouite/grass', details: ['beech', 'birch', 'oak'] },
    { id: 2, key: 'blackforest', name: 'Black Forest', color: '#3e5b33', badge: '#24401e', icon: 'lorc/pine-tree', details: ['fir', 'pine', 'boulders'] },
    { id: 3, key: 'swamp',       name: 'Swamp',        color: '#6e5a3c', badge: '#4a3a22', icon: 'delapouite/swamp', details: ['deadtree', 'bog'] },
    { id: 4, key: 'mountain',    name: 'Mountain',     color: '#f6f9fb', badge: '#5f7480', icon: 'lorc/peaks', details: ['peak', 'hill', 'fir'] },
    { id: 5, key: 'plains',      name: 'Plains',       color: '#dcc25e', badge: '#8f7516', icon: 'delapouite/high-grass', details: ['birch', 'oak', 'rocks'] },
    { id: 6, key: 'mistlands',   name: 'Mistlands',    color: '#6d6585', badge: '#463e60', icon: 'delapouite/fog', details: ['cliff', 'shoot', 'mist'] },
    { id: 7, key: 'ashlands',    name: 'Ashlands',     color: '#a3352a', badge: '#6e1a12', icon: 'lorc/volcano', details: ['lava', 'ashwood'] },
    { id: 8, key: 'deepnorth',   name: 'Deep North',   color: '#bfe2f2', badge: '#3d7f9e', icon: 'lorc/snowflake-1', details: ['snowfir', 'snowhill', 'ice'] },
    { id: 0, key: 'ocean',       name: 'Ocean',        color: '#3d6f93', badge: '#1f4f73', icon: 'lorc/waves' },
  ],

  // Places shown for every biome.
  common: [
    { key: 'me',     label: 'Me',          icon: 'delapouite/position-marker', badge: '#c8332f' },
    { key: 'base',   label: 'My Base',     icon: 'delapouite/viking-longhouse', badge: '#7a4b22' },
    { key: 'portal', label: 'Portal',      icon: 'lorc/magic-portal',     badge: '#5b3a8c' },
    { key: 'boat',   label: 'Boat',        icon: 'delapouite/drakkar',    badge: '#2d5a7a' },
    { key: 'camp',   label: 'Camp / Bed',  icon: 'delapouite/camping-tent', badge: '#6b5a2e' },
    { key: 'chest',  label: 'Chest',       icon: 'delapouite/chest',      badge: '#7a5a22' },
    { key: 'rune',   label: 'Runestone',   icon: 'lorc/rune-stone',       badge: '#4b5560' },
    { key: 'grave',  label: 'I Died',      icon: 'lorc/tombstone',        badge: '#3a3a3a' },
    { key: 'danger', label: 'Danger!',     icon: 'lorc/hazard-sign',      badge: '#b8461b' },
    { key: 'cool',   label: 'Cool Spot',   icon: 'delapouite/round-star', badge: '#b58a12' },
    { key: 'note',   label: 'Note',        icon: 'lorc/scroll-unfurled',  badge: '#6e5a3c' },
  ],

  // Places per biome. `boss: true` gets a gold ring. `badge` overrides the biome color.
  // `short` is an optional shorter name for the button (the full `label` is its tooltip).
  places: {
    meadows: [
      { key: 'eikthyr',   label: 'Eikthyr',        icon: 'lorc/stag-head', boss: true },
      { key: 'hildir',    label: 'Hildir (Trader)', short: 'Hildir', icon: 'delapouite/shop', badge: '#7a4b22' },
      { key: 'village',   label: 'Draugr Village', icon: 'delapouite/huts-village' },
      { key: 'beehive',   label: 'Beehive',        icon: 'delapouite/beehive', badge: '#b8860b' },
      { key: 'raspberry', label: 'Raspberries',    icon: 'delapouite/raspberry', badge: '#a3243b' },
      { key: 'mushroom',  label: 'Mushrooms',      icon: 'delapouite/mushrooms' },
      { key: 'boar',      label: 'Boars',          icon: 'caro-asercion/boar' },
      { key: 'flint',     label: 'Flint',          icon: 'delapouite/stone-pile', badge: '#6b6b6b' },
    ],
    blackforest: [
      { key: 'elder',      label: 'The Elder',      icon: 'cathelineau/tree-face', boss: true },
      { key: 'haldor',     label: 'Haldor (Trader)', short: 'Haldor', icon: 'delapouite/coins-pile', badge: '#9a7a14' },
      { key: 'crypt',      label: 'Crypt',          icon: 'delapouite/crypt-entrance' },
      { key: 'trollcave',  label: 'Troll Cave',     icon: 'delapouite/cave-entrance' },
      { key: 'troll',      label: 'Troll',          icon: 'skoll/troll', badge: '#2f5a6b' },
      { key: 'bear',       label: 'Bear Den',       icon: 'delapouite/bear-head', badge: '#5a3a22' },
      { key: 'copper',     label: 'Copper',         icon: 'faithtoken/ore', badge: '#b8642e' },
      { key: 'tin',        label: 'Tin',            icon: 'faithtoken/minerals', badge: '#7f8a8f' },
      { key: 'nest',       label: 'Greydwarf Nest', icon: 'lorc/evil-tree' },
      { key: 'blueberry',  label: 'Blueberries',    icon: 'delapouite/berry-bush', badge: '#3b4f9a' },
      { key: 'tower',      label: 'Ruined Tower',   icon: 'lorc/tower-fall' },
    ],
    swamp: [
      { key: 'bonemass',    label: 'Bonemass',          icon: 'delapouite/slime', boss: true },
      { key: 'bogwitch',    label: 'Bog Witch (Trader)', short: 'Bog Witch', icon: 'cathelineau/witch-face', badge: '#4f6b2a' },
      { key: 'sunkencrypt', label: 'Sunken Crypt',      icon: 'delapouite/graveyard' },
      { key: 'iron',        label: 'Iron',              icon: 'lorc/metal-bar', badge: '#5a5050' },
      { key: 'leech',       label: 'Leeches',           icon: 'lorc/leeching-worm' },
      { key: 'abomination', label: 'Abomination',       icon: 'delapouite/tree-roots' },
      { key: 'turnip',      label: 'Turnips',           icon: 'delapouite/beet', badge: '#7a3a6b' },
      { key: 'surtling',    label: 'Surtling Fire',     icon: 'lorc/fire-zone', badge: '#b8461b' },
    ],
    mountain: [
      { key: 'moder',     label: 'Moder',       icon: 'lorc/dragon-head', boss: true },
      { key: 'eggs',      label: 'Dragon Eggs', icon: 'lorc/egg-clutch' },
      { key: 'silver',    label: 'Silver',      icon: 'lorc/crystal-cluster', badge: '#8296a3' },
      { key: 'frostcave', label: 'Frost Cave',  icon: 'delapouite/mountain-cave' },
      { key: 'wolves',    label: 'Wolves',      icon: 'lorc/wolf-head' },
      { key: 'fenring',   label: 'Fenring',     icon: 'lorc/werewolf', badge: '#3a3a55' },
      { key: 'golem',     label: 'Stone Golem', icon: 'delapouite/rock-golem' },
      { key: 'obsidian',  label: 'Obsidian',    icon: 'lorc/crystal-growth', badge: '#2a2433' },
    ],
    plains: [
      { key: 'yagluth', label: 'Yagluth',       icon: 'lorc/horned-skull', boss: true },
      { key: 'fuling',  label: 'Fuling Village', icon: 'delapouite/goblin-camp', badge: '#6b2a2a' },
      { key: 'barley',  label: 'Barley',        icon: 'lorc/wheat' },
      { key: 'flax',    label: 'Flax',          icon: 'delapouite/flax', badge: '#4a6b9a' },
      { key: 'tar',     label: 'Tar Pit',       icon: 'lorc/dripping-goo', badge: '#2a2a2a' },
      { key: 'lox',     label: 'Lox',           icon: 'delapouite/mammoth', badge: '#6b4a2a' },
      { key: 'mosquito', label: 'Deathsquito',  icon: 'delapouite/amber-mosquito', badge: '#b8461b' },
      { key: 'cloudberry', label: 'Cloudberries', icon: 'delapouite/berries-bowl', badge: '#c97a1e' },
      { key: 'stonetower', label: 'Stone Tower', icon: 'lorc/stone-tower' },
    ],
    mistlands: [
      { key: 'queen',    label: 'The Queen',      icon: 'lorc/masked-spider', boss: true },
      { key: 'mine',     label: 'Infested Mine',  icon: 'delapouite/underground-cave' },
      { key: 'dvergr',   label: 'Dvergr Tower',   icon: 'kier-heyl/dwarf-helmet', badge: '#2d5a7a' },
      { key: 'skeleton', label: 'Giant Skeleton', icon: 'lorc/dinosaur-bones' },
      { key: 'jotun',    label: 'Jotun Puffs',    icon: 'lorc/mushroom-gills', badge: '#7a6b9a' },
      { key: 'seeker',   label: 'Seekers',        icon: 'lorc/long-antennae-bug' },
      { key: 'sap',      label: 'Yggdrasil Sap',  icon: 'delapouite/plant-roots', badge: '#2f6b5a' },
      { key: 'marble',   label: 'Black Marble',   icon: 'lorc/stone-block', badge: '#2a2433' },
    ],
    ashlands: [
      { key: 'fader',     label: 'Fader',        icon: 'delapouite/spiked-dragon-head', boss: true },
      { key: 'fortress',  label: 'Fortress',     icon: 'lorc/locked-fortress' },
      { key: 'flametal',  label: 'Flametal',     icon: 'delapouite/melting-metal', badge: '#d0572a' },
      { key: 'lava',      label: 'Lava',         icon: 'delapouite/smoking-volcano', badge: '#c2410c' },
      { key: 'putrid',    label: 'Putrid Hole',  icon: 'lorc/burst-blob' },
      { key: 'charred',   label: 'Charred Army', icon: 'skoll/burning-skull' },
      { key: 'asksvin',   label: 'Asksvin',      icon: 'delapouite/horned-reptile' },
      { key: 'grausten',  label: 'Grausten',     icon: 'delapouite/stone-stack', badge: '#4a4a4a' },
      { key: 'ashwood',   label: 'Ashwood',      icon: 'lorc/burning-tree' },
      { key: 'landing',   label: 'Safe Landing', icon: 'lorc/anchor', badge: '#2d5a7a' },
    ],
    deepnorth: [
      { key: 'ice',      label: 'Ice Field',   icon: 'lorc/icebergs' },
      { key: 'storm',    label: 'Snow Storm',  icon: 'lorc/snowing' },
      { key: 'icebeast', label: 'Ice Monster', icon: 'delapouite/ice-golem' },
      { key: 'ruins',    label: 'Ruins',       icon: 'delapouite/castle-ruins' },
      { key: 'mystery',  label: 'Mystery',     icon: 'delapouite/crystal-shrine', badge: '#5b3a8c' },
    ],
    ocean: [
      { key: 'serpent',   label: 'Sea Serpent', icon: 'lorc/sea-serpent', badge: '#2f6b5a' },
      { key: 'leviathan', label: 'Leviathan',   icon: 'delapouite/whale-tail' },
      { key: 'wreck',     label: 'Shipwreck',   icon: 'delapouite/ship-wreck', badge: '#5a3a22' },
      { key: 'island',    label: 'Island',      icon: 'delapouite/island', badge: '#4f7d2a' },
      { key: 'fish',      label: 'Fish',        icon: 'delapouite/school-of-fish' },
      { key: 'harbor',    label: 'Harbor',      icon: 'lorc/anchor' },
      { key: 'lighthouse', label: 'Lighthouse', icon: 'delapouite/lighthouse', badge: '#b8461b' },
    ],
  },

  // Optional game art. Nothing here ships with ValMap: tools/build-game-assets.js extracts these
  // pictures from your own Valheim install into game-assets/ (which stays out of the repository).
  // Places not listed keep their game-icons.net symbol.
  gameArt: {
    spawn: 'mapicon_start',
    me: 'mapicon_player_32', base: 'mapicon_house', portal: 'mapicon_portal', camp: 'mapicon_bed',
    grave: 'mapicon_death', note: 'mapicon_pin', danger: 'mapicon_shout', cool: 'mapicon_checked',
    eikthyr: 'TrophyEikthyr', hildir: 'mapicon_hildir', village: 'TrophyDraugr', beehive: 'queenbee',
    raspberry: 'raspberry', mushroom: 'mushroom', boar: 'TrophyBoar', flint: 'flint',
    elder: 'TrophyTheElder', haldor: 'mapicon_trader', crypt: 'TrophySkeleton', trollcave: 'TrophyForestTroll',
    troll: 'troll_hide', bear: 'TrophyBjorn', copper: 'copperore', tin: 'TinOre', nest: 'TrophyGreydwarf',
    blueberry: 'blueberries',
    bonemass: 'TrophyBonemass', bogwitch: 'mapicon_bogwitch_camp', sunkencrypt: 'TrophyDraugrElite',
    iron: 'ironscrap', leech: 'TrophyLeech', abomination: 'TrophyAbomination', turnip: 'turnip',
    surtling: 'TrophySurtling',
    moder: 'TrophyDragonQueen', eggs: 'dragonegg', silver: 'silverore', frostcave: 'TrophyUlv',
    wolves: 'TrophyWolf', fenring: 'TrophyFenring', golem: 'TrophySGolem', obsidian: 'obsidian',
    yagluth: 'TrophyGoblinKing', fuling: 'TrophyGoblin', barley: 'barley', flax: 'flax', tar: 'tar',
    lox: 'TrophyLox', mosquito: 'TrophyDeathSquito', cloudberry: 'cloudberry',
    queen: 'TrophySeekerQueen', mine: 'TrophySeekerBrute', dvergr: 'TrophyDvergr', jotun: 'mushroomjotunpuffs',
    seeker: 'TrophySeeker', sap: 'sap', marble: 'blackmarble',
    fader: 'TrophyFader', fortress: 'TrophyCharredMage', flametal: 'flametalore', lava: 'MoltenCore',
    putrid: 'TrophyMorgen', charred: 'TrophyCharredMelee', asksvin: 'TrophyAsksvin', grausten: 'stone_grausten',
    ashwood: 'BlackWood',
    icebeast: 'TrophyFrostTroll',
    serpent: 'TrophySerpent', fish: 'fish1',
  },
  // The game's own map textures, used for the "Game look".
  gameTextures: ['background', 'forest', 'mountain', 'water'],
  // The game's own UI textures for the side panels and buttons: CSS variable -> picture name.
  gameUi: {
    wood: 'woodpanel_400_tileable', button: 'button',
    'button-hi': 'button_highlight', 'button-down': 'button_pressed', separator: 'panel_separator',
  },

  // Icons used by the app itself.
  ui: {
    spawn: 'delapouite/star-altar',
    brush: 'delapouite/paint-brush',
    move: 'lorc/hand',
    trash: 'delapouite/trash-can',
  },
};

if (typeof module !== 'undefined') module.exports = CATALOG;
