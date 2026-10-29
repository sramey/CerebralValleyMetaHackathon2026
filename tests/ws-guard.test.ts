// Wire hardening (ADR 0036): every ClientMsg kind is validated before dispatch, and a
// hostile or malformed frame can never throw, never reach a handler, and never spend
// Meta budget. These tests only touch pure code (no socket, no keys, no live calls).
import { describe, expect, it } from "vitest";
import { Budget } from "../server/budget";
import type { Limits } from "../server/budget";
import {
  clampKnobValue,
  gateMessage,
  MAX_FRAME,
  MAX_IMAGE,
  MAX_KEY,
  MAX_MODS,
  MAX_POINTS,
  MAX_SHEET_KEYS,
  MAX_STROKES,
  MAX_TEXT,
  parseClientMessage,
  validateClientMsg,
} from "../server/validate";
import type { ClientMsg } from "../src/contract";

const PNG = `data:image/png;base64,${"A".repeat(320)}`;
const BBOX = { x: 10, y: 20, w: 120, h: 16 };
const KNOWN_KINDS = new Set([
  "command", "undo", "knob", "photo", "photoFind", "photoBring", "photoBringLocal",
  "worldState", "voiceWarm", "voiceStart", "voiceEnd", "worldSave", "worldLoad", "worldExport",
  "restyle", "feedback", "sketch", "tester", "timelineRestore",
]);

const STROKE = { color: "#3fd06a", tag: "terrain" as const, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], bbox: BBOX };

/** One valid frame per ClientMsg kind. The table is typed so a new member fails to compile here. */
const VALID: { [K in ClientMsg["kind"]]: Extract<ClientMsg, { kind: K }> } = {
  command: { kind: "command", text: "add a player" },
  undo: { kind: "undo", modId: "player" },
  knob: { kind: "knob", modId: "player", knob: "size", value: 64 },
  photo: { kind: "photo", key: "photo-1", image: PNG, prompt: "my mug" },
  photoFind: { kind: "photoFind", key: "photo-2", image: PNG, prompt: "the mug" },
  photoBring: { kind: "photoBring", key: "photo-2" },
  photoBringLocal: { kind: "photoBringLocal", key: "photo-3", prompt: "", aspect: 1.5 },
  worldState: { kind: "worldState", mods: [{ id: "player", values: { size: 32, on: true, label: "hi" } }, { id: "rain", values: {} }] },
  voiceWarm: { kind: "voiceWarm" },
  voiceStart: { kind: "voiceStart" },
  voiceEnd: { kind: "voiceEnd", cancel: true },
  worldSave: { kind: "worldSave", mods: [{ id: "player", values: { size: 32 } }, { id: "coins", values: {} }] },
  worldLoad: { kind: "worldLoad", id: "demo-1" },
  worldExport: { kind: "worldExport", mods: [{ id: "player", values: { size: 32 } }, { id: "coins", values: {} }] },
  restyle: { kind: "restyle", mood: "spooky", keys: ["ninja", "mug-photo"] },
  feedback: { kind: "feedback", modId: "player", entityType: "player", vote: "down", note: "too slow", fixNow: true },
  tester: { kind: "tester", n: 2, ev: "landed", cid: 3 },
  timelineRestore: { kind: "timelineRestore", n: 4 },
  sketch: { kind: "sketch", image: PNG, strokes: [STROKE], prompt: "a stair", view: { x: 0, y: 0, w: 800, h: 600 } },
};

/** Every valid sample as a raw frame, for gateMessage. */
const VALID_FRAMES = Object.entries(VALID).map(([kind, msg]) => ({ kind, raw: JSON.stringify(msg) }));

function settle(raw: string): { valid: boolean; kinds: string[]; replies: string[]; threw: boolean } {
  const kinds: string[] = [];
  const replies: string[] = [];
  let valid = false;
  let threw = false;
  try {
    valid = gateMessage(raw, (msg) => kinds.push(msg.kind), (reply) => replies.push(reply));
  } catch {
    threw = true;
  }
  return { valid, kinds, replies, threw };
}

describe("wire validation: the happy path", () => {
  it("accepts one well-formed message per ClientMsg kind", () => {
    // The typed table above already proves coverage at compile time; this asserts every kind passes.
    expect(new Set(Object.keys(VALID))).toEqual(KNOWN_KINDS);
    for (const [kind, msg] of Object.entries(VALID)) {
      const v = validateClientMsg(msg);
      expect(v.ok, kind).toBe(true);
      if (v.ok) expect(v.msg.kind, kind).toBe(kind);
    }
  });

  it("dispatches each valid frame exactly once and never replies", () => {
    for (const { kind, raw } of VALID_FRAMES) {
      const r = settle(raw);
      expect(r.threw, kind).toBe(false);
      expect(r.valid, kind).toBe(true);
      expect(r.kinds, kind).toEqual([kind]);
      expect(r.replies, kind).toEqual([]);
    }
  });

  it("rebuilds messages from known fields only, dropping extras", () => {
    const v = validateClientMsg({ kind: "command", text: "add a ninja", evil: 1, __weird: { a: 1 } });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.msg).toEqual({ kind: "command", text: "add a ninja" });

    const world = validateClientMsg({ kind: "worldState", mods: [{ id: "player", values: { size: 4 }, extra: "no" }] });
    expect(world.ok).toBe(true);
    if (world.ok) expect(world.msg).toEqual({ kind: "worldState", mods: [{ id: "player", values: { size: 4 } }] });
  });

  it("accepts an empty world list, extra optional fields left out, and falsy knob values", () => {
    expect(validateClientMsg({ kind: "worldState", mods: [] }).ok).toBe(true);
    expect(validateClientMsg({ kind: "knob", modId: "m", knob: "on", value: false }).ok).toBe(true);
    expect(validateClientMsg({ kind: "knob", modId: "m", knob: "n", value: 0 }).ok).toBe(true);
    expect(validateClientMsg({ kind: "voiceEnd" }).ok).toBe(true);
    expect(validateClientMsg({ kind: "sketch", image: PNG, strokes: [] , prompt: "just a hint" }).ok).toBe(true);
  });

  it("accepts the ids Wonder actually writes (spaces, unicode) but never a prototype key", () => {
    const v = validateClientMsg({ kind: "worldState", mods: [{ id: "Rain Cloud ✨", values: { "Jump Power": 1.5 } }, { id: "rain", values: {} }] });
    expect(v.ok).toBe(true);
    if (v.ok && v.msg.kind === "worldState") expect(v.msg.mods.map((m) => m.id)).toEqual(["Rain Cloud ✨", "rain"]);
    expect(validateClientMsg({ kind: "knob", modId: "Rain Cloud ✨", knob: "Jump Power", value: 2 }).ok).toBe(true);
    expect(validateClientMsg({ kind: "undo", modId: "constructor" }).ok).toBe(false);
  });
});

/** Every malformed shape the gate must refuse. Shared by the shape table and the no-spend fuzz. */
const BAD: [label: string, value: unknown][] = [
    ["null", null],
    ["undefined", undefined],
    ["number", 7],
    ["string", "command"],
    ["array", [{ kind: "command", text: "hi" }]],
    ["empty object", {}],
    ["numeric kind", { kind: 1, text: "hi" }],
    ["wrong-case kind", { kind: "Command", text: "hi" }],
    ["unknown kind", { kind: "explode" }],
    ["empty kind", { kind: "" }],
    ["command with no text", { kind: "command" }],
    ["command with numeric text", { kind: "command", text: 12 }],
    ["command with empty text", { kind: "command", text: "" }],
    ["command with whitespace text", { kind: "command", text: "   " }],
    ["command past the cap", { kind: "command", text: "a".repeat(MAX_TEXT + 1) }],
    ["undo with no id", { kind: "undo" }],
    ["undo with a control character id", { kind: "undo", modId: "a\u0000b" }],
    ["undo with an empty id", { kind: "undo", modId: "" }],
    ["undo with an oversized id", { kind: "undo", modId: "a".repeat(MAX_KEY + 1) }],
    ["undo with a dangerous id", JSON.parse('{"kind":"undo","modId":"__proto__"}')],
    ["knob with no mod", { kind: "knob", knob: "size", value: 1 }],
    ["knob with no knob name", { kind: "knob", modId: "m", value: 1 }],
    ["knob with NaN", { kind: "knob", modId: "m", knob: "size", value: NaN }],
    ["knob with Infinity", { kind: "knob", modId: "m", knob: "size", value: Infinity }],
    ["knob with an object value", { kind: "knob", modId: "m", knob: "size", value: { n: 1 } }],
    ["knob with a dangerous knob name", { kind: "knob", modId: "m", knob: "__proto__", value: 1 }],
    ["photo without a data URL", { kind: "photo", key: "k", image: "https://example.com/a.png", prompt: "" }],
    ["photo with no image", { kind: "photo", key: "k", prompt: "" }],
    ["photo with an oversized image", { kind: "photo", key: "k", image: `data:image/png;base64,${"A".repeat(MAX_IMAGE)}`, prompt: "" }],
    ["photo with a numeric prompt", { kind: "photo", key: "k", image: PNG, prompt: 3 }],
    ["photoFind with no key", { kind: "photoFind", image: PNG, prompt: "" }],
    ["photoBring with no key", { kind: "photoBring" }],
    ["photoBringLocal with aspect 0", { kind: "photoBringLocal", key: "k", prompt: "", aspect: 0 }],
    ["photoBringLocal with a huge aspect", { kind: "photoBringLocal", key: "k", prompt: "", aspect: 1000 }],
    ["photoBringLocal with Infinity", { kind: "photoBringLocal", key: "k", prompt: "", aspect: Infinity }],
    ["photoBringLocal with a string aspect", { kind: "photoBringLocal", key: "k", prompt: "", aspect: "1.5" }],
    ["worldState without an array", { kind: "worldState", mods: { player: {} } }],
    ["worldState with too many mods", { kind: "worldState", mods: Array.from({ length: MAX_MODS + 1 }, (_, i) => ({ id: `m${i}`, values: {} })) }],
    ["worldSave with too many mods", { kind: "worldSave", mods: Array.from({ length: MAX_MODS + 1 }, (_, i) => ({ id: `m${i}`, values: {} })) }],
    ["worldExport with too many mods", { kind: "worldExport", mods: Array.from({ length: MAX_MODS + 1 }, (_, i) => ({ id: `m${i}`, values: {} })) }],
    ["worldLoad with no id", { kind: "worldLoad" }],
    ["worldLoad with a traversal id", { kind: "worldLoad", id: "../worlds/x" }],
    ["voiceEnd with a non-boolean cancel", { kind: "voiceEnd", cancel: "yes" }],
    ["restyle with a numeric mood", { kind: "restyle", mood: 7, keys: [] }],
    ["restyle without keys", { kind: "restyle", mood: "spooky" }],
    ["restyle with too many keys", { kind: "restyle", mood: "spooky", keys: Array.from({ length: MAX_SHEET_KEYS + 1 }, (_, i) => `k${i}`) }],
    ["restyle with a non-array keys", { kind: "restyle", mood: "spooky", keys: "ninja" }],
    ["feedback with an unknown vote", { kind: "feedback", modId: "m", vote: "meh", note: "" }],
    ["feedback with a numeric note", { kind: "feedback", modId: "m", vote: "up", note: 1 }],
    ["feedback with boolean overload", { kind: "feedback", modId: "m", vote: "down", note: "", fixNow: "yes" }],
    ["sketch without an image", { kind: "sketch", strokes: [STROKE] }],
    ["sketch with a non-array strokes", { kind: "sketch", image: PNG, strokes: "lots" }],
    ["sketch with too many strokes", { kind: "sketch", image: PNG, strokes: Array.from({ length: MAX_STROKES + 1 }, () => STROKE) }],
    ["sketch with too many points", { kind: "sketch", image: PNG, strokes: [{ ...STROKE, points: Array.from({ length: MAX_POINTS + 1 }, () => ({ x: 0, y: 0 })) }] }],
    ["sketch with a NaN bbox", { kind: "sketch", image: PNG, strokes: [{ ...STROKE, bbox: { x: 0, y: 0, w: NaN, h: 1 } }] }],
    ["sketch with a missing bbox", { kind: "sketch", image: PNG, strokes: [{ points: [] }] }],
    ["sketch with a non-finite point", { kind: "sketch", image: PNG, strokes: [{ ...STROKE, points: [{ x: Infinity, y: 0 }] }] }],
    ["sketch with an empty view box", { kind: "sketch", image: PNG, strokes: [STROKE], view: { x: 0, y: 0, w: 0, h: 10 } }],
    ["sketch with a numeric view", { kind: "sketch", image: PNG, strokes: [STROKE], view: 42 }],
    ["sketch with a numeric prompt", { kind: "sketch", image: PNG, strokes: [STROKE], prompt: 9 }],
];

describe("wire validation: rejects bad shape, wrong kinds, ranges and caps", () => {
  it("rejects every malformed shape and replies with one plain sentence", () => {
    for (const [label, value] of BAD) {
      const v = validateClientMsg(value);
      expect(v.ok, label).toBe(false);
      if (!v.ok) {
        expect(v.reply.length, label).toBeGreaterThan(5);
        expect(v.reply.length, label).toBeLessThan(120);
        expect(v.reply, label).not.toContain("\n");
        expect(v.reply, label).not.toMatch(/\bat [\w$.]+:\d+/);
        expect(v.reply, label).not.toContain("TypeError");
      }
    }
  });

  it("refuses a frame bigger than the socket's payload cap before parsing", () => {
    const r = settle(`{"kind":"command","text":"${"a".repeat(MAX_FRAME)}"}`);
    expect(r.threw).toBe(false);
    expect(r.valid).toBe(false);
    expect(r.kinds).toEqual([]);
    expect(r.replies).toEqual(["That message was too big — try something smaller."]);
  });

  it("sanitizes the world list instead of failing the whole status report", () => {
    // A world list is a status report: one unusable entry or knob value must not cost the frame,
    // or a session loses its playtest world copy over a single odd value.
    const v = validateClientMsg({
      kind: "worldState",
      mods: [
        { id: 7, values: {} },
        null,
        { id: "player", values: { size: NaN, label: 42, on: true, name: "ok", nested: { n: 1 } } },
        { id: "rain", values: "not a record" },
      ],
    });
    expect(v.ok).toBe(true);
    if (v.ok && v.msg.kind === "worldState") {
      expect(v.msg.mods.map((m) => m.id)).toEqual(["player", "rain"]);
      expect(v.msg.mods[0].values).toEqual({ label: 42, on: true, name: "ok" });
      expect(v.msg.mods[1].values).toEqual({});
    }
  });

  it("keeps the sprite keys it was sent (the handler skips unknown sheets) and drops non-strings", () => {
    const v = validateClientMsg({ kind: "restyle", mood: "spooky", keys: ["ninja", 7, "", "bad key!", "ninja"] });
    expect(v.ok).toBe(true);
    if (v.ok && v.msg.kind === "restyle") expect(v.msg.keys).toEqual(["ninja", "bad key!"]);
  });
});

describe("wire validation: prototype pollution", () => {
  /** Frames the gate must refuse outright. */
  const REFUSED = [
    '{"__proto__":{"polluted":true},"kind":"command","text":"hi"}',
    '{"kind":"command","text":"hi","__proto__":{"polluted":true}}',
    '{"kind":"knob","modId":"player","knob":"__proto__","value":1}',
    '{"kind":"knob","modId":"__proto__","knob":"size","value":1}',
    '{"kind":"undo","modId":"constructor"}',
    '{"kind":"sketch","image":"' + PNG + '","strokes":[{"__proto__":{"polluted":true},"color":"#fff","tag":"terrain","points":[],"bbox":{"x":0,"y":0,"w":1,"h":1}}]}',
    '{"kind":"feedback","modId":"__proto__","vote":"up","note":""}',
  ];

  /** Frames that stay usable but must arrive with the poisoned parts stripped. */
  const STRIPPED = [
    '{"kind":"worldState","mods":[{"id":"player","values":{"__proto__":{"polluted":true}}}]}',
    '{"kind":"worldSave","mods":[{"id":"player","values":{"constructor":1,"prototype":2,"size":4}}]}',
    '{"kind":"worldState","mods":[{"__proto__":{"polluted":true},"id":"player","values":{}},{"id":"rain","values":{}}]}',
  ];

  it("refuses prototype keys outright and never touches Object.prototype", () => {
    for (const raw of REFUSED) {
      const r = settle(raw);
      expect(r.threw, raw).toBe(false);
      expect(r.valid, raw).toBe(false);
      expect(r.kinds, raw).toEqual([]);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("polluted");
    expect(([] as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getOwnPropertyNames(Object.prototype)).not.toContain("polluted");
  });

  it("strips prototype keys out of a world list and keeps the rest usable", () => {
    for (const raw of STRIPPED) {
      const r = settle(raw);
      expect(r.threw, raw).toBe(false);
      expect(r.valid, raw).toBe(true);
      expect(r.kinds, raw).toHaveLength(1);
    }
    const v = parseClientMessage(STRIPPED[1]);
    expect(v.ok).toBe(true);
    if (v.ok && v.msg.kind === "worldSave") {
      expect(v.msg.mods[0].values).toEqual({ size: 4 });
      expect(Object.keys(v.msg.mods[0].values)).toEqual(["size"]);
    }
    const dropped = parseClientMessage(STRIPPED[2]);
    expect(dropped.ok).toBe(true);
    if (dropped.ok && dropped.msg.kind === "worldState") expect(dropped.msg.mods.map((m) => m.id)).toEqual(["rain"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("keeps a sanitized message free of inherited/own prototype keys", () => {
    const v = validateClientMsg({ kind: "worldState", mods: [{ id: "player", values: { size: 4 } }] });
    expect(v.ok).toBe(true);
    if (v.ok && v.msg.kind === "worldState") {
      const values = v.msg.mods[0].values;
      expect(Object.keys(values)).toEqual(["size"]);
      expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
      expect(values).not.toHaveProperty("__proto__");
    }
  });
});

// Deterministic PRNG (mulberry32): the fuzz runs are reproducible from a seed.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(next: () => number, xs: readonly T[]): T => xs[Math.floor(next() * xs.length) % xs.length];
const CHARS = "ab{}[]\",:\\/<>.%-_0123456789 \n\t\u0000é🚀'`$";
const NASTY_KEYS = ["kind", "text", "__proto__", "constructor", "prototype", "mods", "id", "values", "knob", "value", "image", "strokes", "bbox", "points", "key", "aspect", "note", "vote", "mood", "keys", "view", "", "a".repeat(80)];
const NASTY_VALUES = [null, true, false, 0, -1, 1e308, -1e308, NaN, Infinity, -Infinity, "", "x", "add a player", "__proto__", PNG, [], {}];

function randomString(next: () => number, max: number): string {
  const n = Math.floor(next() * max);
  let s = "";
  for (let i = 0; i < n; i++) s += pick(next, CHARS.split(""));
  return s;
}

function randomValue(next: () => number, depth: number): unknown {
  const roll = next();
  if (depth <= 0 || roll < 0.4) return pick(next, NASTY_VALUES);
  if (roll < 0.55) return randomString(next, 40);
  if (roll < 0.7) return next() * 1e6 - 5e5;
  if (roll < 0.85) {
    const n = Math.floor(next() * 4);
    return Array.from({ length: n }, () => randomValue(next, depth - 1));
  }
  const out: Record<string, unknown> = {};
  const n = Math.floor(next() * 5);
  for (let i = 0; i < n; i++) out[pick(next, NASTY_KEYS)] = randomValue(next, depth - 1);
  return out;
}

function randomFrame(next: () => number): string {
  const roll = next();
  if (roll < 0.15) {
    // Mutate a legit frame: truncate, splice, or duplicate a slice.
    const base = pick(next, VALID_FRAMES).raw;
    const at = Math.floor(next() * base.length);
    if (next() < 0.34) return base.slice(0, at);
    if (next() < 0.5) return base + base.slice(at, at + Math.floor(next() * 40));
    return base.slice(0, at) + randomString(next, 12) + base.slice(at);
  }
  if (roll < 0.35) return randomString(next, 200);
  if (roll < 0.5) {
    // Deep nesting: JSON.parse itself has to survive it.
    const depth = Math.floor(next() * 400);
    return "[".repeat(depth) + "]".repeat(depth);
  }
  if (roll < 0.6) {
    // Almost-valid shape with a poisoned/oversized field.
    const obj: Record<string, unknown> = { kind: pick(next, [...KNOWN_KINDS, "nope", "", "Command"]) };
    for (let i = 0; i < 4; i++) obj[pick(next, NASTY_KEYS)] = randomValue(next, 2);
    return JSON.stringify(obj);
  }
  return JSON.stringify(randomValue(next, 4));
}

describe("wire validation: fuzz (no throw, no dispatch, no spend)", () => {
  it("survives 3000 generated frames and blocks every rejected one", () => {
    const next = rng(0x5eed);
    const problems: string[] = [];
    let accepted = 0;
    for (let i = 0; i < 3000; i++) {
      const raw = randomFrame(next);
      let dispatched = 0;
      let replies = 0;
      let valid = false;
      try {
        valid = gateMessage(raw, () => { dispatched++; }, (reply) => {
          replies++;
          if (typeof reply !== "string" || reply.length < 6 || reply.length > 120) problems.push(`bad reply #${i}`);
        });
      } catch {
        problems.push(`threw on frame #${i}: ${raw.slice(0, 60)}`);
        continue;
      }
      if (valid && !KNOWN_KINDS.has(JSON.parse(raw)?.kind)) problems.push(`dispatched unknown kind #${i}`);
      if (valid) {
        accepted++;
        if (dispatched !== 1 || replies !== 0) problems.push(`valid frame #${i} dispatched ${dispatched} / replied ${replies}`);
      } else if (dispatched !== 0 || replies !== 1) {
        problems.push(`rejected frame #${i} dispatched ${dispatched} / replied ${replies}`);
      }
    }
    expect(problems).toEqual([]);
    expect(accepted).toBeLessThan(300); // fuzz should mostly be refused, not mostly accepted
  });

  it("no rejected frame ever reaches a handler or the budget, and a real command spends exactly one build", () => {
    // The handlers are the only code that touches the budget; the gate is the only way in.
    const limits: Limits = { build: 2, image: 2, sam: 2, voice: 60 };
    const budget = new Budget({ session: limits, global: limits });
    const kinds: string[] = [];
    const replies: string[] = [];
    const dispatch = (msg: ClientMsg): void => {
      kinds.push(msg.kind);
      if (msg.kind === "command" || msg.kind === "sketch" || msg.kind === "feedback") budget.take("visitor", "build");
      if (msg.kind === "photo" || msg.kind === "photoFind") budget.take("visitor", "sam");
      if (msg.kind === "restyle") budget.take("visitor", "image");
      if (msg.kind === "voiceWarm" || msg.kind === "voiceStart") budget.take("visitor", "voice", 30);
    };

    // A corpus that is almost entirely hostile: random frames, every hand-written bad shape,
    // raw junk and near-miss kinds. Nothing here is meant to validate.
    const next = rng(0xbadc0de);
    const frames: string[] = [];
    for (let i = 0; i < 400; i++) frames.push(randomFrame(next));
    for (const [, value] of BAD) {
      const raw = JSON.stringify(value);
      if (typeof raw === "string") frames.push(raw);
    }
    frames.push("", " ", "\n", "not json", "{", "}", "[]", "null", "0", "true", '""',
      '{"kind":"explode"}', '{"kind":"Command","text":"x"}', '{"kind":"command"}', '{"kind":null}');

    const problems: string[] = [];
    let rejected = 0;
    for (const raw of frames) {
      const before = { ...budget.snapshot().global };
      let valid: boolean;
      try {
        valid = gateMessage(raw, dispatch, (reply) => replies.push(reply));
      } catch {
        problems.push(`threw on ${JSON.stringify(raw).slice(0, 50)}`);
        continue;
      }
      if (valid) continue;
      rejected++;
      const after = budget.snapshot().global;
      if (after.build !== before.build || after.image !== before.image || after.sam !== before.sam || after.voice !== before.voice) {
        problems.push(`rejected frame spent budget: ${JSON.stringify(raw).slice(0, 50)}`);
      }
    }
    expect(problems).toEqual([]);
    expect(rejected).toBeGreaterThan(frames.length * 0.85);
    expect(kinds.every((k) => KNOWN_KINDS.has(k))).toBe(true);
    expect(replies.every((r) => typeof r === "string" && r.length > 5 && r.length < 120)).toBe(true);

    // The legitimate path still works, and spends exactly once: proof the gate is a filter, not a wall.
    const fresh = new Budget({ session: limits, global: limits });
    const seen: string[] = [];
    expect(gateMessage('{"kind":"command","text":"add a player"}', (msg) => { seen.push(msg.kind); fresh.take("visitor", "build"); }, () => seen.push("reply"))).toBe(true);
    expect(seen).toEqual(["command"]);
    expect(fresh.snapshot().global.build).toBe(1);
    fresh.stop();
    budget.stop();
  });

  it("never throws on garbage bytes, broken JSON and odd escapes", () => {
    const next = rng(0xfeed);
    const problems: string[] = [];
    const payloads = [0xff, 0x00, 0x7b, 0xc3];
    for (let i = 0; i < 500; i++) {
      const junk = String.fromCharCode(...Array.from({ length: Math.floor(next() * 64) }, () => pick(next, payloads)));
      const frames = [junk, `{${junk}`, `${junk}}`, `{"a":${junk}}`, `"\\u${Math.floor(next() * 0x10000).toString(16)}"`, `{"kind":"${junk}"}`];
      for (const raw of frames) {
        try {
          const v = parseClientMessage(raw);
          if (!v.ok && (typeof v.reply !== "string" || v.reply.length === 0)) problems.push(`empty reply for ${JSON.stringify(raw).slice(0, 40)}`);
          if (v.ok && !KNOWN_KINDS.has(v.msg.kind)) problems.push(`unknown kind past the gate: ${v.msg.kind}`);
        } catch {
          problems.push(`threw on ${JSON.stringify(raw).slice(0, 40)}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("knob clamping", () => {
  it("clamps numbers into the knob's declared range and leaves the rest alone", () => {
    expect(clampKnobValue({ value: 64, min: 24, max: 160 }, 1e9)).toBe(160);
    expect(clampKnobValue({ value: 64, min: 24, max: 160 }, -5)).toBe(24);
    expect(clampKnobValue({ value: 64, min: 24, max: 160 }, 80)).toBe(80);
    expect(clampKnobValue({ value: 64 }, 1e9)).toBe(1e9);
    expect(clampKnobValue({ value: "red", min: 0, max: 1 }, "red")).toBe("red");
    expect(clampKnobValue({ value: true, min: 0, max: 1 }, true)).toBe(true);
    expect(clampKnobValue(undefined, 42)).toBe(42);
  });
});
