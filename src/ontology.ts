// Pure, deterministic entity ontology and command-intent classifiers (ADR 0023).
// Shared across sim, server, and client: no DOM, no Node, no Math.random.
import type { EntityKind } from "./contract";

export type { EntityKind };

export const ENTITY_KINDS: readonly EntityKind[] = [
  "terrain",
  "effect",
  "projectile",
  "shape",
  "prop",
  "creature",
  "player",
];

export interface EntityLike {
  type: string;
  kind?: EntityKind;
  solid?: boolean;
  gravityScale?: number;
  vx?: number;
  vy?: number;
  data?: Record<string, number | string | boolean>;
}

const TERRAIN_TOKENS: ReadonlySet<string> = new Set([
  "ground",
  "grounds",
  "platform",
  "platforms",
  "stair",
  "stairs",
  "staircase",
  "stairway",
  "step",
  "steps",
  "steppingstone",
  "wall",
  "walls",
  "floor",
  "floors",
  "ceiling",
  "ceilings",
  "ledge",
  "ledges",
  "ramp",
  "ramps",
  "slope",
  "slopes",
  "bridge",
  "bridges",
  "cliff",
  "cliffs",
  "block",
  "blocks",
  "brick",
  "bricks",
  "pillar",
  "pillars",
  "column",
  "columns",
  "terrain",
  "surface",
  "surfaces",
  "tile",
  "tiles",
  "road",
  "roads",
  "path",
  "paths",
  "walkway",
  "sidewalk",
  "pavement",
  "ladder",
  "ladders",
  "soil",
  "dirt",
  "mud",
  "turf",
  "bedrock",
  "slab",
  "slabs",
  "pedestal",
  "scaffold",
  "overhang",
  "trampoline",
  "barrier",
]);

const EFFECT_TOKENS: ReadonlySet<string> = new Set([
  "rain",
  "raindrop",
  "raindrops",
  "snow",
  "snowflake",
  "snowflakes",
  "blizzard",
  "fog",
  "mist",
  "haze",
  "smoke",
  "explosion",
  "explosions",
  "blast",
  "shockwave",
  "spark",
  "sparks",
  "ember",
  "embers",
  "lightning",
  "thunder",
  "glow",
  "firefly",
  "fireflies",
  "light",
  "lights",
  "garland",
  "aurora",
  "particle",
  "particles",
  "trail",
  "trails",
  "splash",
  "ripple",
  "weather",
  "wind",
  "breeze",
  "dust",
  "ash",
  "confetti",
  "firework",
  "fireworks",
  "tinsel",
  "sunbeam",
  "moonbeam",
  "drop",
  "drops",
  "background",
  "fire",
  "flame",
  "flames",
  // Cosmetic appendages and light strings are drawn in code, never sprited.
  "tail",
  "tails",
  "string",
  "strings",
]);

const PROJECTILE_TOKENS: ReadonlySet<string> = new Set([
  // grappling gear is a tool in flight, never a character (ADR 0050)
  "hook",
  "hooks",
  "grapple",
  "grappling",
  "tether",
  "tethers",
  "cable",
  "cables",
  "projectile",
  "projectiles",
  "bullet",
  "bullets",
  "shot",
  "shots",
  "arrow",
  "arrows",
  "fireball",
  "fireballs",
  "iceball",
  "snowball",
  "snowballs",
  "bolt",
  "bolts",
  "beam",
  "beams",
  "laser",
  "lasers",
  "laserbeam",
  "plasma",
  "missile",
  "missiles",
  "rocket",
  "rockets",
  "shuriken",
  "shurikens",
  "pellet",
  "pellets",
  "dart",
  "darts",
  "grenade",
  "grenades",
  "cannonball",
  "torpedo",
  "boomerang",
]);

const SHAPE_TOKENS: ReadonlySet<string> = new Set([
  "coin",
  "coins",
  "ball",
  "balls",
  "orb",
  "orbs",
  "bubble",
  "bubbles",
  "sphere",
  "spheres",
  "circle",
  "circles",
  "disc",
  "disk",
  "ring",
  "rings",
  "halo",
  "hoop",
  "backboard",
  "goal",
  "donut",
  "spike",
  "spikes",
  "spiky",
  "thorn",
  "thorns",
  "triangle",
  "triangles",
  "cone",
  "wedge",
  "diamond",
  "diamonds",
  "gem",
  "gems",
  "rhombus",
  "star",
  "stars",
  "pill",
  "capsule",
  "bomb",
  "bombs",
  "marble",
  "pearl",
  "cube",
  "prism",
]);

const HELD_ITEM_TOKENS: ReadonlySet<string> = new Set([
  "gun",
  "guns",
  "pistol",
  "rifle",
  "blaster",
  "shotgun",
  "cannon",
  "bazooka",
  "launcher",
  "revolver",
  "raygun",
  "musket",
  "watergun",
  "sword",
  "swords",
  "blade",
  "dagger",
  "katana",
  "saber",
  "scimitar",
  "rapier",
  "claymore",
  "shield",
  "shields",
  "buckler",
  "bow",
  "bows",
  "crossbow",
  "slingshot",
  "wand",
  "wands",
  "staff",
  "scepter",
  "hammer",
  "mallet",
  "mace",
  "flail",
  "axe",
  "hatchet",
  "spear",
  "lance",
  "halberd",
  "trident",
  "whip",
  "key",
  "keys",
  "potion",
  "potions",
  "flask",
  "vial",
  "elixir",
  "medkit",
  "heart",
  "hearts",
  "jetpack",
  "umbrella",
  "parasol",
  "flashlight",
  "torch",
  "pickaxe",
  "shovel",
  "weapon",
  "weapons",
  "item",
  "tool",
  "grapple",
]);

const PROP_TOKENS: ReadonlySet<string> = new Set([
  ...HELD_ITEM_TOKENS,
  "tree",
  "trees",
  "pine",
  "oak",
  "birch",
  "palm",
  "willow",
  "bush",
  "shrub",
  "hedge",
  "rock",
  "rocks",
  "stone",
  "stones",
  "boulder",
  "boulders",
  "pebble",
  "flower",
  "flowers",
  "rose",
  "tulip",
  "daisy",
  "sunflower",
  "grass",
  "plant",
  "plants",
  "vine",
  "vines",
  "fern",
  "cactus",
  "cacti",
  "mushroom",
  "mushrooms",
  "toadstool",
  "cloud",
  "clouds",
  "mountain",
  "mountains",
  "hill",
  "hills",
  "volcano",
  "island",
  "icicle",
  "icicles",
  "house",
  "houses",
  "hut",
  "cabin",
  "cottage",
  "castle",
  "fortress",
  "palace",
  "tower",
  "turret",
  "windmill",
  "lighthouse",
  "barn",
  "shed",
  "shop",
  "tent",
  "igloo",
  "treehouse",
  "fence",
  "gate",
  "arch",
  "lamp",
  "lantern",
  "lanterns",
  "streetlight",
  "chandelier",
  "candle",
  "candles",
  "waterfall",
  "lake",
  "pond",
  "pool",
  "fountain",
  "well",
  "sign",
  "signpost",
  "billboard",
  "statue",
  "monument",
  "totem",
  "obelisk",
  "crystal",
  "crystals",
  "coral",
  "seaweed",
  "kelp",
  "shell",
  "stump",
  "log",
  "barrel",
  "barrels",
  "keg",
  "crate",
  "crates",
  "chest",
  "chests",
  "coffer",
  "door",
  "doors",
  "window",
  "windows",
  "sun",
  "moon",
  "rainbow",
  "planet",
  "saturn",
  "comet",
  "meteor",
  "asteroid",
  "asteroids",
  "target",
  "targets",
  "dummy",
  "bullseye",
  "snowman",
  "snowmen",
  "campfire",
  "bonfire",
  "fireplace",
  "brazier",
  "cauldron",
  "tornado",
  "twister",
  "cyclone",
  "whirlwind",
  "vortex",
  "hurricane",
  "waterspout",
  "gift",
  "gifts",
  "present",
  "presents",
  "ornament",
  "ornaments",
  "wreath",
  "sleigh",
  "stocking",
  "stockings",
  "candycane",
  "gingerbread",
  "bell",
  "bells",
  "ribbon",
  "scarecrow",
  "pumpkin",
  "pumpkins",
  "gravestone",
  "tombstone",
  "altar",
  "throne",
  "chair",
  "bench",
  "table",
  "desk",
  "bed",
  "bookshelf",
  "cart",
  "wagon",
  "car",
  "racecar",
  "truck",
  "bus",
  "train",
  "boat",
  "ship",
  "submarine",
  "airplane",
  "plane",
  "helicopter",
  "ufo",
  "spaceship",
  "bicycle",
  "bike",
  "skateboard",
  "sled",
  "anchor",
  "wheel",
  "flag",
  "trophy",
  "prize",
  "crown",
  "hat",
  "helmet",
  "boots",
  "cloak",
  "cape",
  "armor",
  "lock",
  "padlock",
  "bottle",
  "cup",
  "mug",
  "goblet",
  "chalice",
  "plate",
  "bowl",
  "fork",
  "spoon",
  "knife",
  "food",
  "apple",
  "banana",
  "cherry",
  "berry",
  "carrot",
  "cake",
  "pie",
  "cookie",
  "bread",
  "cheese",
  "meat",
  "steak",
  "pizza",
  "burger",
  "candy",
  "lollipop",
  "chocolate",
  "icecream",
  "bandage",
  "battery",
  "magnet",
  "compass",
  "book",
  "scroll",
  "letter",
  "sack",
  "backpack",
  "bag",
  "parachute",
  "wings",
  "rope",
  "chain",
  "cage",
  "lever",
  "switch",
  "button",
  "spring",
  "fan",
  "gear",
  "cog",
  "clock",
  "hourglass",
  "mirror",
  "painting",
  "picture",
  "rug",
  "carpet",
  "curtain",
  "pillow",
  "guitar",
  "drum",
  "piano",
  "harp",
  "flute",
  "horn",
  "trumpet",
  "hoe",
  "bucket",
  "broom",
  "anvil",
  "furnace",
  "forge",
  "workbench",
  "pickup",
  "powerup",
  "collectible",
  "prop",
  "decoration",
  "scenery",
]);

const CREATURE_TOKENS: ReadonlySet<string> = new Set([
  "creature",
  "creatures",
  "enemy",
  "enemies",
  "walker",
  "walkers",
  "slime",
  "gel",
  "blob",
  "ooze",
  "turtle",
  "tortoise",
  "snail",
  "slug",
  "chicken",
  "hen",
  "rooster",
  "chick",
  "bird",
  "birds",
  "songbird",
  "sparrow",
  "robin",
  "crow",
  "raven",
  "pigeon",
  "dove",
  "parrot",
  "toucan",
  "seagull",
  "pelican",
  "flamingo",
  "peacock",
  "ostrich",
  "penguin",
  "owl",
  "eagle",
  "hawk",
  "falcon",
  "vulture",
  "duck",
  "goose",
  "swan",
  "cat",
  "cats",
  "kitten",
  "kitty",
  "feline",
  "dog",
  "dogs",
  "puppy",
  "hound",
  "retriever",
  "pug",
  "bulldog",
  "poodle",
  "wolf",
  "wolves",
  "coyote",
  "fox",
  "bear",
  "grizzly",
  "panda",
  "koala",
  "rabbit",
  "bunny",
  "hare",
  "squirrel",
  "chipmunk",
  "hamster",
  "mouse",
  "mice",
  "rat",
  "hedgehog",
  "porcupine",
  "raccoon",
  "badger",
  "otter",
  "beaver",
  "skunk",
  "mole",
  "bat",
  "bats",
  "frog",
  "toad",
  "tadpole",
  "newt",
  "salamander",
  "axolotl",
  "fish",
  "goldfish",
  "salmon",
  "trout",
  "tuna",
  "clownfish",
  "pufferfish",
  "anglerfish",
  "eel",
  "stingray",
  "manta",
  "shark",
  "whale",
  "dolphin",
  "orca",
  "seal",
  "walrus",
  "manatee",
  "crab",
  "lobster",
  "shrimp",
  "prawn",
  "octopus",
  "squid",
  "jellyfish",
  "starfish",
  "seahorse",
  "urchin",
  "bee",
  "bumblebee",
  "wasp",
  "hornet",
  "ant",
  "beetle",
  "ladybug",
  "butterfly",
  "moth",
  "dragonfly",
  "grasshopper",
  "cricket",
  "mantis",
  "roach",
  "worm",
  "caterpillar",
  "centipede",
  "scorpion",
  "spider",
  "tarantula",
  "snake",
  "cobra",
  "viper",
  "python",
  "boa",
  "lizard",
  "gecko",
  "chameleon",
  "iguana",
  "komodo",
  "crocodile",
  "alligator",
  "gator",
  "dino",
  "dinosaur",
  "trex",
  "raptor",
  "triceratops",
  "stegosaurus",
  "brontosaurus",
  "pterodactyl",
  "mammoth",
  "sabertooth",
  "horse",
  "pony",
  "stallion",
  "mare",
  "donkey",
  "mule",
  "zebra",
  "unicorn",
  "pegasus",
  "griffin",
  "gryphon",
  "phoenix",
  "hippo",
  "rhino",
  "elephant",
  "giraffe",
  "camel",
  "llama",
  "alpaca",
  "deer",
  "stag",
  "fawn",
  "moose",
  "elk",
  "reindeer",
  "caribou",
  "antelope",
  "gazelle",
  "buffalo",
  "bison",
  "yak",
  "cow",
  "bull",
  "ox",
  "calf",
  "pig",
  "hog",
  "boar",
  "piglet",
  "sheep",
  "ram",
  "lamb",
  "goat",
  "lion",
  "tiger",
  "leopard",
  "cheetah",
  "panther",
  "jaguar",
  "cougar",
  "lynx",
  "monkey",
  "ape",
  "chimp",
  "gorilla",
  "orangutan",
  "baboon",
  "lemur",
  "sloth",
  "armadillo",
  "anteater",
  "platypus",
  "kangaroo",
  "wallaby",
  "wombat",
  "possum",
  "dragon",
  "wyvern",
  "drake",
  "hydra",
  "leviathan",
  "kraken",
  "behemoth",
  "chimera",
  "cerberus",
  "minotaur",
  "centaur",
  "satyr",
  "faun",
  "mermaid",
  "merman",
  "siren",
  "harpy",
  "gorgon",
  "medusa",
  "cyclops",
  "titan",
  "giant",
  "ogre",
  "troll",
  "orc",
  "goblin",
  "hobgoblin",
  "kobold",
  "imp",
  "gremlin",
  "gnome",
  "dwarf",
  "elf",
  "elves",
  "fairy",
  "pixie",
  "nymph",
  "dryad",
  "ent",
  "treant",
  "golem",
  "gargoyle",
  "mimic",
  "zombie",
  "undead",
  "ghoul",
  "skeleton",
  "skull",
  "lich",
  "mummy",
  "vampire",
  "dracula",
  "werewolf",
  "lycan",
  "ghost",
  "phantom",
  "specter",
  "wraith",
  "banshee",
  "poltergeist",
  "demon",
  "fiend",
  "devil",
  "angel",
  "seraph",
  "cherub",
  "valkyrie",
  "wizard",
  "mage",
  "sorcerer",
  "warlock",
  "necromancer",
  "witch",
  "shaman",
  "druid",
  "cleric",
  "priest",
  "monk",
  "paladin",
  "knight",
  "warrior",
  "fighter",
  "barbarian",
  "berserker",
  "gladiator",
  "soldier",
  "trooper",
  "guard",
  "guardian",
  "sentinel",
  "warden",
  "archer",
  "ranger",
  "hunter",
  "sniper",
  "gunner",
  "rogue",
  "thief",
  "bandit",
  "outlaw",
  "assassin",
  "ninja",
  "shinobi",
  "samurai",
  "ronin",
  "shogun",
  "viking",
  "pirate",
  "buccaneer",
  "sailor",
  "captain",
  "king",
  "queen",
  "prince",
  "princess",
  "emperor",
  "lord",
  "lady",
  "peasant",
  "villager",
  "citizen",
  "merchant",
  "blacksmith",
  "farmer",
  "miner",
  "lumberjack",
  "fisherman",
  "chef",
  "baker",
  "bard",
  "jester",
  "clown",
  "doctor",
  "scientist",
  "astronaut",
  "pilot",
  "santa",
  "wanderer",
  "newcomer",
  "traveler",
  "explorer",
  "adventurer",
  "stranger",
  "ally",
  "companion",
  "sidekick",
  "follower",
  "pet",
  "mount",
  "minion",
  "henchman",
  "grunt",
  "brawler",
  "brute",
  "rival",
  "nemesis",
  "villain",
  "boss",
  "overlord",
  "warlord",
  "champion",
  "hero",
  "superhero",
  "defender",
  "protector",
  "stalker",
  "crawler",
  "flyer",
  "hopper",
  "jumper",
  "charger",
  "shooter",
  "spitter",
  "chaser",
  "seeker",
  "lurker",
  "predator",
  "beast",
  "monster",
  "critter",
  "bug",
  "insect",
  "alien",
  "martian",
  "mutant",
  "cyborg",
  "android",
  "robot",
  "bot",
  "droid",
  "mech",
  "mecha",
  "drone",
  "tidecaller",
  "person",
  "human",
  "man",
  "woman",
  "boy",
  "girl",
  "child",
  "kid",
  "baby",
  "guy",
  "character",
  "npc",
]);

function classifyToken(tok: string): EntityKind | undefined {
  if (!tok) return undefined;
  if (tok === "player") return "player";
  if (TERRAIN_TOKENS.has(tok)) return "terrain";
  if (PROJECTILE_TOKENS.has(tok)) return "projectile";
  if (EFFECT_TOKENS.has(tok)) return "effect";
  if (SHAPE_TOKENS.has(tok)) return "shape";
  if (PROP_TOKENS.has(tok)) return "prop";
  if (CREATURE_TOKENS.has(tok)) return "creature";
  return undefined;
}

function classifyTypeTokens(raw: string): EntityKind | undefined {
  const lower = raw.toLowerCase().trim();
  if (!lower) return undefined;
  if (lower === "player") return "player";
  if (lower.startsWith("photo-") || lower.startsWith("photo")) return "prop";

  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
  // Scan right-to-left so the head noun of compound types wins:
  // "snow-ground" -> "ground" (terrain), "boss-bullet" -> "bullet" (projectile),
  // "christmas-light" -> "light" (effect), "christmas-star" -> "star" (shape),
  // "christmas-gift" -> "gift" (prop), "laser-gun" -> "gun" (prop).
  for (let i = tokens.length - 1; i >= 0; i--) {
    const tok = tokens[i];
    const kind = classifyToken(tok) ?? (tok.endsWith("s") && tok.length > 3 ? classifyToken(tok.slice(0, -1)) : undefined);
    if (kind) return kind;
  }

  // Compound suffix fallback for unhyphenated compounds (e.g. "raincloud", "rockwall", "stairstep"):
  // check the ending root of each token right-to-left so "wanderer" never matches "wand".
  for (let i = tokens.length - 1; i >= 0; i--) {
    const tok = tokens[i];
    if (tok.length < 6) continue;
    for (const w of TERRAIN_TOKENS) if (w.length >= 4 && tok.endsWith(w)) return "terrain";
    for (const w of PROJECTILE_TOKENS) if (w.length >= 4 && tok.endsWith(w)) return "projectile";
    for (const w of EFFECT_TOKENS) if (w.length >= 4 && tok.endsWith(w)) return "effect";
    for (const w of SHAPE_TOKENS) if (w.length >= 4 && tok.endsWith(w)) return "shape";
    for (const w of PROP_TOKENS) if (w.length >= 4 && tok.endsWith(w)) return "prop";
    for (const w of CREATURE_TOKENS) if (w.length >= 4 && tok.endsWith(w)) return "creature";
  }
  return undefined;
}

/**
 * Deterministic ontological role for any entity type string or Entity/SpawnDef object.
 */
export function entityKind(input: string | EntityLike): EntityKind {
  if (typeof input === "string") {
    return classifyTypeTokens(input) ?? "creature";
  }
  const t = (input.type ?? "").toLowerCase().trim();
  if (t === "player") return "player";
  // Hard invariant (ADR 0023): any static solid (solid: true && gravityScale === 0) is terrain.
  if (input.solid === true && input.gravityScale === 0) return "terrain";
  if (input.kind && (ENTITY_KINDS as readonly string[]).includes(input.kind)) return input.kind;
  const byType = classifyTypeTokens(t);
  if (byType) return byType;
  if (input.data?.hostile === true || input.data?.casual === true || input.data?.hero === true) {
    return "creature";
  }
  if (input.vx === 0 && input.vy === 0 && input.gravityScale === 0 && !input.solid) {
    return "prop";
  }
  return "creature";
}

/**
 * Only creatures and props may generate or bind AI sprite sheets.
 * Terrain, effects, projectiles, and shapes are ALWAYS drawn procedurally in code.
 */
export function canUseSpriteSheet(input: string | EntityLike): boolean {
  const k = entityKind(input);
  return k === "creature" || k === "prop";
}

export function isTerrainType(input: string | EntityLike): boolean {
  return entityKind(input) === "terrain";
}

/**
 * The single art decision for a subject or entity type (ADR 0031). Art never
 * guesses from its own word lists: the ontology decides.
 * - `none`      terrain and static structure, effects, projectiles and shapes are drawn in code
 * - `held-item` weapons, tools and pickups get isolated item art (no character holding them)
 * - `scenery`   other props get static scenery variants, never character poses
 * - `sheet`     creatures get an animated pose sheet (the player's sheet ships with the engine)
 */
export type ArtPlan = "none" | "held-item" | "scenery" | "sheet";

export function artPlanFor(input: string | EntityLike): ArtPlan {
  const kind = entityKind(input);
  if (kind === "creature" || kind === "player") return "sheet";
  if (kind !== "prop") return "none";
  return isHeldItemType(typeof input === "string" ? input : input.type) ? "held-item" : "scenery";
}

export function isPropType(input: string | EntityLike): boolean {
  return entityKind(input) === "prop";
}

/**
 * True when the subject or entity type is a weapon, tool, or held item (e.g. gun, sword, bow, wand, shield).
 * Held items must always generate static isolated item art (scenery: true), never a character holding the item.
 */
export function isHeldItemType(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (!lower) return false;
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const tok = tokens[i];
    if (CREATURE_TOKENS.has(tok)) return false;
    if (HELD_ITEM_TOKENS.has(tok)) return true;
  }
  return false;
}

export interface SpawnedEntitySummary {
  type: string;
  kind: EntityKind;
  solid: boolean;
  gravityScale: number;
}

function enclosingObjectLiteral(source: string, index: number): string {
  let start = index;
  let depth = 0;
  while (start > 0 && index - start < 500) {
    const c = source[start];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) break;
      depth--;
    }
    start--;
  }
  let end = index;
  depth = 0;
  while (end < source.length && end - index < 600) {
    const c = source[end];
    if (c === "{") depth++;
    else if (c === "}") {
      if (depth === 0) {
        end++;
        break;
      }
      depth--;
    }
    end++;
  }
  return source.slice(start, end);
}

/**
 * Deterministically extract spawned entity types and their ontological kinds from mod source code.
 */
export function extractSpawnedEntities(source: string): SpawnedEntitySummary[] {
  const byType = new Map<string, SpawnedEntitySummary>();
  const re = /type\s*:\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const t = m[1].trim();
    if (!t) continue;
    const block = enclosingObjectLiteral(source, m.index);
    const solid = /solid\s*:\s*true\b/.test(block);
    const gravityZero = /gravityScale\s*:\s*0(?:\b|\.0*\b)/.test(block);
    const gravityScale = gravityZero ? 0 : 1;
    const hostile = /hostile\s*:\s*true\b/.test(block);
    const casual = /casual\s*:\s*true\b/.test(block);
    const hero = /hero\s*:\s*true\b/.test(block);
    const kind = entityKind({
      type: t,
      solid,
      gravityScale,
      data: { ...(hostile ? { hostile: true } : {}), ...(casual ? { casual: true } : {}), ...(hero ? { hero: true } : {}) },
    });
    const prev = byType.get(t);
    if (!prev) {
      byType.set(t, { type: t, kind, solid, gravityScale });
    } else if (solid && gravityZero) {
      prev.solid = true;
      prev.gravityScale = 0;
      prev.kind = "terrain";
    }
  }
  return [...byType.values()];
}

const KNOWN_MOOD_WORDS: ReadonlySet<string> = new Set([
  "spooky",
  "scary",
  "creepy",
  "haunted",
  "halloween",
  "horror",
  "gothic",
  "eerie",
  "christmas",
  "xmas",
  "festive",
  "holiday",
  "santa",
  "yuletide",
  "snowy",
  "wintry",
  "winter",
  "icy",
  "frozen",
  "arctic",
  "neon",
  "cyberpunk",
  "synthwave",
  "vaporwave",
  "retrowave",
  "daytime",
  "daylight",
  "sunny",
  "morning",
  "noon",
  "sunrise",
  "dawn",
  "night",
  "nighttime",
  "midnight",
  "starry",
  "moonlit",
  "twilight",
  "dusk",
  "sunset",
  "desert",
  "underwater",
  "autumn",
  "candy",
  "candyland",
  "pastel",
  "retro",
  "noir",
  "sepia",
  "volcanic",
]);

const BACKDROP_NOUN = "(?:background|backdrop|bg|scenery|landscape|setting|surroundings|parallax)";
/** Filler that says "a background" without saying which one. */
const BACKDROP_FILLER = /\b(?:parallax|paralax|background|backdrop|bg|scenery|scene|landscape|setting|style|styled|themed|theme|looking|look|new|cool|nice|different|whole|kind\s+of|sort\s+of|something|one|please)\b/gi;

/**
 * "Change the background to medieval", "change the background to be in an Indiana farm",
 * "medieval parallax background" (ADR 0067). Returns the theme words, or null when the command
 * is not about the backdrop. "Add a castle in the background" is a build, not a backdrop.
 */
export function detectBackdropCommand(command: string): string | null {
  const clean = command.trim().replace(/[.!?,;:]+$/, "").trim().replace(/\s+/g, " ");
  if (!clean || new RegExp(`\\b(?:in|on|into|to)\\s+(?:the|my|our)\\s+${BACKDROP_NOUN}$`, "i").test(clean)) return null;
  const lead = "^(?:(?:please|can\\s+you|could\\s+you|let'?s|i\\s+want\\s+to)\\s+)?";
  const change = new RegExp(`${lead}(?:change|set|switch|make|turn|swap|replace|redo|update)\\s+(?:the\\s+|my\\s+|our\\s+|this\\s+)?${BACKDROP_NOUN}(?:\\s+(?:background|backdrop|scenery))?\\s+(?:(?:to|into|with|for|so\\s+it(?:'s|\\s+is)?|so\\s+we(?:'re|\\s+are)?)\\s+)?(.+)$`, "i").exec(clean);
  const named = change ? null : new RegExp(`${lead}(?:(?:give\\s+(?:me|us)|i\\s+want|use|add|make|show(?:\\s+me)?|put\\s+(?:up|in)|switch\\s+to|go\\s+to)\\s+)?(?:a\\s+|an\\s+|the\\s+|some\\s+)?(.+?)\\s+(?:parallax\\s+|paralax\\s+)?(?:background|backdrop|scenery|landscape)$`, "i").exec(clean);
  const raw = (change ?? named)?.[1];
  // "…to medieval and add a dragon" is a compound: the splitter gives each part its own route.
  if (!raw || /(?:,|;|\b(?:and|then|also|plus)\s+(?:add|make|create|spawn|build|give|put|turn|change|remove|let)\b)/i.test(raw)) return null;
  const phrase = raw
    .replace(BACKDROP_FILLER, " ")
    .replace(/^\s*(?:be|look|looks|feel)\s+(?:like\s+)?/i, " ")
    .replace(/^\s*(?:(?:set|located|placed)\s+)?(?:in|on|at|like|of)\s+/i, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:(?:a|an|the|some|in|on|at|of|with|like)\s+)+/i, "")
    .replace(/\s+(?:a|an|the|in|on|at|of|with|and)$/i, "")
    .trim()
    .toLowerCase();
  if (!/[a-z]{3}/.test(phrase) || phrase.split(" ").length > 6) return null;
  if (/^(?:add|create|spawn|build|remove|undo|delete|change|set|switch|make|turn|swap|replace|bigger|smaller|darker|lighter|brighter)\b/.test(phrase)) return null;
  return phrase;
}

/**
 * Deterministic detector for whole-world theme/mood commands (e.g. "Make this Christmas themed.",
 * "make it daytime", "make the world spooky", "christmas theme").
 * Returns the extracted mood phrase or null when the command is not a mood request.
 */
export function detectMoodCommand(command: string): string | null {
  const clean = command.trim().replace(/[.!?,;:]+$/, "").trim();
  if (!clean) return null;
  // A new backdrop is a mood scoped to the background (ADR 0067).
  const backdrop = detectBackdropCommand(clean);
  if (backdrop) return backdrop;

  // 1. "<X> themed" / "<X> theme" / "<X> mood" / "<X> vibe":
  // Matches "Make this Christmas themed", "make it christmas themed", "make the world retro themed", "christmas theme", etc.
  const themedMatch =
    /^(?:(?:please|can\s+you|could\s+you)\s+)?(?:(?:make|turn|set|change|give)\s+(?:it|this|everything|the\s+(?:world|game|level|map|place|scene|stage|background|environment|atmosphere|theme|mood|vibe|style))\s+(?:to\s+|into\s+|be\s+|look\s+(?:like\s+)?|feel\s+(?:like\s+)?)?(?:a\s+|an\s+|more\s+|very\s+|so\s+)?)?([a-z0-9][a-z0-9\s-]{1,36}?)\s+(?:themed|theme|mood|vibe)$/i.exec(
      clean,
    );
  if (themedMatch) {
    const phrase = themedMatch[1]
      .trim()
      .replace(/^(?:a|an|the|more|very|so|all|really)\s+/i, "")
      .trim()
      .toLowerCase();
    if (phrase && !/^(?:add|create|spawn|build|remove|undo|delete)\b/i.test(phrase)) {
      return phrase;
    }
  }

  // 2. "set/change/switch the theme/mood/vibe/atmosphere to <X>":
  const setThemeMatch =
    /^(?:(?:please|can\s+you|could\s+you)\s+)?(?:set|change|switch|turn)\s+(?:the\s+)?(?:theme|mood|vibe|atmosphere|lighting|time(?:\s+of\s+day)?)\s+(?:to|into)\s+(?:a\s+|an\s+|the\s+)?([a-z0-9][a-z0-9\s-]{1,36})$/i.exec(
      clean,
    );
  if (setThemeMatch) {
    return setThemeMatch[1].trim().toLowerCase();
  }

  // 3. "make/turn/set/change (it|this|everything|the world|the game|the level|...) [look/feel [like]] <KNOWN_MOOD_WORD>":
  const targetMoodMatch =
    /^(?:(?:please|can\s+you|could\s+you)\s+)?(?:make|turn|set|change)\s+(?:it|this|everything|the\s+(?:world|game|level|map|place|scene|stage|sky|background|environment|atmosphere))(?:\s+(?:look|feel)(?:\s+like)?)?(?:\s+(?:more|so|very|really|a\s+bit|a\s+little|like\s+a|like))?\s+([a-z0-9][a-z0-9\s-]{1,36})$/i.exec(
      clean,
    );
  if (targetMoodMatch) {
    const candidate = targetMoodMatch[1].trim().toLowerCase();
    const words = candidate.split(/[^a-z0-9-]+/).filter(Boolean);
    if (words.some((w) => KNOWN_MOOD_WORDS.has(w)) || /\b(?:at\s+(?:sunset|night|dawn|dusk)|in\s+winter|in\s+space)\b/.test(candidate)) {
      return words.find((w) => KNOWN_MOOD_WORDS.has(w)) ?? candidate;
    }
  }

  // 4. Bare single mood word ("spooky", "daytime", "christmas", "cyberpunk", "synthwave", "snowy", "neon"):
  const lower = clean.toLowerCase();
  if (KNOWN_MOOD_WORDS.has(lower)) {
    return lower;
  }

  return null;
}

/**
 * True when a command explicitly refers to the player's own character ("my character", "the player", "me", "I", "my ninja").
 */
export function isPlayerCommand(command: string): boolean {
  return /\b(?:my\s+(?:character|player|ninja|guy|hero|avatar|person)|the\s+(?:player|ninja)|(?:when|if|whenever)\s+i\s+(?:jump|press|hit|push|hold|tap|walk|run|move|fall|land|shoot|attack|touch|collide|double\s+jump)|(?:make|give|let|allow)\s+me\b|i\s+(?:can|get|have|want\s+to)\s+(?:jump|double\s+jump|wall\s+jump|stick|climb|dash|glide|fly|shoot|teleport))\b/i.test(
    command,
  );
}

/**
 * True when a command asks for a player ability or movement power (double jump, extra jump, wall stick/climb/jump, dash, glide, etc.)
 * that should be built as a standalone mod hooking api.player() rather than editing an NPC mod.
 */
export function isPlayerAbilityCommand(command: string): boolean {
  if (
    /\b(?:double[-\s]?jump|extra\s+jump|second\s+jump|triple\s+jump|jump\s+again|jumps?\s+again|another\s+jump|one\s+more\s+(?:extra\s+)?jump|hit\s+space(?:\s*bar)?\s+again|press\s+space(?:\s*bar)?\s+again|stick\s+to\s+(?:the\s+)?walls?|wall[-\s]?(?:stick|jump|climb|slide|cling|grab)|climb\s+(?:up\s+)?(?:the\s+)?walls?|air[-\s]?dash|ground[-\s]?pound|glide\s+in\s+the\s+air)\b/i.test(
      command,
    )
  ) {
    return true;
  }
  if (
    isPlayerCommand(command) &&
    /\b(?:can\s+(?:stick|climb|dash|glide|double\s+jump|wall\s+jump|teleport|fly|hover|bounce|roll|slide|shield)|gets?\s+(?:a\s+|an\s+|one\s+more\s+)?(?:extra\s+|second\s+|double\s+)?jump)\b/i.test(
      command,
    )
  ) {
    return true;
  }
  return false;
}
