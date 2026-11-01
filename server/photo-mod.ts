// The mod source for a photo object, one template per role (ADR 0082). Server-generated, then
// compiled and verified like any mod; no model call. Pure so tests can import it.
import { parsePhotoRole, photoName, type PhotoRole } from "../src/photo-role";

/** The mod's title: the spoken name with a capital, so Spark's routing and Wonder's manifest can read it. */
export function photoTitle(prompt: string): string {
  const n = photoName(prompt);
  return n === "object" && !String(prompt ?? "").trim() ? "Object" : n.charAt(0).toUpperCase() + n.slice(1);
}

const J = (v: unknown): string => JSON.stringify(v);

export function buildPhotoModSource(key: string, prompt: string, aspect: number, roleIn: PhotoRole | string = "prop", slugIn?: string): string {
  const role = parsePhotoRole(roleIn);
  const aspectLit = String(Number((Number.isFinite(aspect) && aspect > 0 ? aspect : 1).toFixed(4)));
  const idLit = J(key);
  const T = J(slugIn && slugIn.length > 0 ? slugIn : key); // the entity type: the readable slug when the client gave one
  const name = photoName(prompt);
  const titleLit = J(photoTitle(prompt));
  const nameLit = J(name);

  const knobs: Record<PhotoRole, string> = {
    prop: `size: { value: 64, min: 24, max: 160, label: "Size" }, jump: { value: 240, min: 80, max: 520, label: "Jump height" }`,
    collectible: `size: { value: 40, min: 20, max: 120, label: "Size" }`,
    enemy: `size: { value: 64, min: 24, max: 160, label: "Size" }, speed: { value: 70, min: 20, max: 220, label: "Chase speed" }`,
    friendly: `size: { value: 64, min: 24, max: 160, label: "Size" }, speed: { value: 110, min: 30, max: 260, label: "Follow speed" }`,
  };

  const common = [
    `    const h = Number(knobs.size);`,
    `    const aspect = ${aspectLit};`,
    `    const w = Math.min(220, Math.max(16, h * aspect));`,
  ];

  let setup: string[];
  let test: string[];
  if (role === "collectible") {
    setup = [
      ...common,
      `    const baseY = 400 - h - 6;`,
      `    api.spawn({ type: ${T}, x: 420, y: baseY, w: w, h: h, color: 0xffd76a, solid: false, gravityScale: 0, data: { collectible: true, value: 1, name: ${nameLit}, baseY: baseY } });`,
      `    api.onTick(() => {`,
      `      for (const e of api.byType(${T})) e.y = Number(e.data.baseY) + Math.round(Math.sin(api.tick() / 18) * 3);`,
      `    });`,
    ];
    test = [
      `    t.api.spawn({ type: "ground", x: -200, y: 400, w: 1400, h: 48, solid: true, gravityScale: 0 });`,
      `    const c = t.api.byType(${T})[0];`,
      `    t.expect(!!c && c.data.collectible === true, "it is a collectible");`,
      `    t.api.spawn({ type: "player", x: c.x, y: c.y, w: 26, h: 34, color: 0xffffff, gravityScale: 0 });`,
      `    t.step(3);`,
      `    t.expect(t.api.byType(${T}).length === 0, "touching it collects it");`,
      `    t.expect(t.api.hud("score")?.value === 1, "the score counts it");`,
    ];
  } else if (role === "enemy") {
    setup = [
      ...common,
      `    const speed = Number(knobs.speed);`,
      `    api.spawn({ type: ${T}, x: 600, y: 400 - h, w: w, h: h, color: 0xe2483d, solid: false, gravityScale: 1, health: 30, data: { hostile: true, damage: 10, name: ${nameLit} } });`,
      `    api.onTick(() => {`,
      `      const p = api.player();`,
      `      if (!p) return;`,
      `      for (const e of api.byType(${T})) {`,
      `        const dx = (p.x + p.w / 2) - (e.x + e.w / 2);`,
      `        if (Math.abs(dx) > 4) { e.facing = dx > 0 ? 1 : -1; e.vx = e.facing * speed; } else { e.vx = 0; }`,
      `      }`,
      `    });`,
    ];
    test = [
      `    t.api.spawn({ type: "ground", x: -200, y: 400, w: 1400, h: 48, solid: true, gravityScale: 0 });`,
      `    const e = t.api.byType(${T})[0];`,
      `    t.expect(!!e && e.data.hostile === true, "it is hostile");`,
      `    const p = t.api.spawn({ type: "player", x: 200, y: 366, w: 26, h: 34, color: 0xffffff, gravityScale: 1 });`,
      `    const gap = Math.abs(e.x - p.x);`,
      `    t.step(30);`,
      `    t.expect(Math.abs(e.x - p.x) < gap, "it chases the player");`,
      `    t.api.damage(e.id, 1000);`,
      `    t.step(2);`,
      `    t.expect(t.api.byType(${T}).length === 0, "damage defeats it");`,
    ];
  } else if (role === "friendly") {
    setup = [
      ...common,
      `    const speed = Number(knobs.speed);`,
      `    api.spawn({ type: ${T}, x: 260, y: 400 - h, w: w, h: h, color: 0x7ad7a0, solid: false, gravityScale: 1, data: { friendly: true, pet: true, name: ${nameLit} } });`,
      `    api.onTick(() => {`,
      `      const p = api.player();`,
      `      if (!p) return;`,
      `      for (const e of api.byType(${T})) {`,
      `        const dx = (p.x + p.w / 2) - (e.x + e.w / 2);`,
      `        if (Math.abs(dx) > 70) { e.facing = dx > 0 ? 1 : -1; e.vx = e.facing * speed; } else { e.vx = 0; }`,
      `      }`,
      `    });`,
    ];
    test = [
      `    t.api.spawn({ type: "ground", x: -200, y: 400, w: 1400, h: 48, solid: true, gravityScale: 0 });`,
      `    const f = t.api.byType(${T})[0];`,
      `    t.expect(!!f && f.data.friendly === true, "it is friendly");`,
      `    const p = t.api.spawn({ type: "player", x: 700, y: 366, w: 26, h: 34, color: 0xffffff, gravityScale: 1 });`,
      `    const gap = Math.abs(f.x - p.x);`,
      `    t.step(40);`,
      `    t.expect(Math.abs(f.x - p.x) < gap, "it follows the player");`,
    ];
  } else {
    setup = [
      ...common,
      `    const jump = Number(knobs.jump);`,
      `    api.spawn({ type: ${T}, x: 260, y: 400 - h, w: w, h: h, color: 0xffd76a, solid: false, gravityScale: 1, data: { name: ${nameLit} } });`,
      `    api.onTick(() => {`,
      `      if (api.tick() % 200 !== 0) return;`,
      `      for (const e of api.byType(${T})) {`,
      `        if (e.onGround) e.vy = -jump;`,
      `      }`,
      `    });`,
    ];
    test = [
      `    t.step(5);`,
      `    t.expect(t.api.byType(${T}).length === 1, "exactly one photo entity");`,
    ];
  }

  return [
    `export default {`,
    `  id: ${idLit},`,
    `  title: ${titleLit},`,
    `  knobs: { ${knobs[role]} },`,
    `  setup(api, knobs) {`,
    ...setup,
    `  },`,
    `  dispose(api) {`,
    `    for (const e of api.byType(${T})) api.despawn(e.id);`,
    `  },`,
    `  test(t) {`,
    ...test,
    `  },`,
    `};`,
    ``,
  ].join("\n");
}
