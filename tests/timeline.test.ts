import { describe, expect, it } from "vitest";
import { describeChange, fingerprint, MAX_STEPS, Timeline, type Snapshot } from "../server/timeline";
import type { WorldMod } from "../src/contract";

const built = (id: string, source = `// ${id}`): WorldMod => ({ id, title: id.toUpperCase(), source, compiled: source, knobs: {}, values: {} });
const base = (id: string): WorldMod => ({ builtin: true, id, values: {} });
const world = (...mods: WorldMod[]): Snapshot => ({ mods });

describe("timeline", () => {
  it("skips the empty starting world and records each change once", () => {
    const t = new Timeline();
    expect(t.record(world())).toBeNull();
    expect(t.record(world(base("ground")))?.n).toBe(1);
    expect(t.record(world(base("ground")))).toBeNull(); // same world, not a step
    expect(t.record(world(base("ground"), built("rain")))?.label).toBe("Added RAIN");
    expect(t.size).toBe(2);
  });

  it("names a step by the command when there is one, else by the diff", () => {
    const t = new Timeline();
    t.record(world(base("ground")));
    expect(t.record(world(base("ground"), built("a")), "make it rain")?.label).toBe("make it rain");
    const undo = t.record(world(base("ground")));
    expect(undo?.kind).toBe("undo");
    expect(undo?.label).toBe("Removed A");
  });

  it("an edit of a mod's code is a step; a knob value change is not", () => {
    const t = new Timeline();
    t.record(world(built("a", "v1")));
    expect(t.record({ mods: [{ ...built("a", "v1"), values: { speed: 9 } }] })).toBeNull();
    expect(t.record(world(built("a", "v2")))?.label).toBe("Edited a mod");
  });

  it("moods are steps and undoing one says so", () => {
    const t = new Timeline();
    const mood = { name: "spooky" } as Snapshot["mood"];
    t.record(world(base("ground")));
    expect(t.record({ mods: [base("ground")], mood })?.label).toBe("Mood: spooky");
    expect(t.record(world(base("ground")))?.label).toBe("Back to normal");
  });

  it("a forced restore is always a new step and keeps the old ones", () => {
    const t = new Timeline();
    t.record(world(base("ground")));
    t.record(world(base("ground"), built("a")));
    t.record(world(base("ground"), built("a"), built("b")));
    const back = t.get(1)!;
    const r = t.record(back, undefined, { kind: "restore", label: `Restored: ${back.label}` });
    expect(r?.n).toBe(4);
    expect(t.list().map((s) => s.n)).toEqual([1, 2, 3, 4]);
    expect(r?.mods.map((m) => m.id)).toEqual(["ground"]);
  });

  it("scrub back five builds and restore: world matches step, history intact", () => {
    const t = new Timeline();
    const mods: WorldMod[] = [base("ground")];
    t.record(world(...mods));
    for (const id of ["a", "b", "c", "d", "e", "f"]) { mods.push(built(id)); t.record(world(...mods)); }
    expect(t.size).toBe(7);
    const target = t.get(2)!; // ground + a
    expect(target.mods.map((m) => m.id)).toEqual(["ground", "a"]);
    t.record(target, undefined, { kind: "restore", label: "Restored" });
    expect(t.size).toBe(8);
    expect(t.get(7)!.mods).toHaveLength(7); // the newest build before the restore is still there
  });

  it("caps history but keeps the starting point", () => {
    const t = new Timeline();
    const mods: WorldMod[] = [base("ground")];
    for (let i = 0; i < MAX_STEPS + 20; i++) { mods.push(built(`m${i}`)); t.record(world(...mods)); }
    expect(t.size).toBe(MAX_STEPS);
    expect(t.list()[0].n).toBe(1);
    expect(t.list().at(-1)!.n).toBe(MAX_STEPS + 20);
  });

  it("fingerprint ignores order and describeChange handles replace", () => {
    expect(fingerprint(world(built("a"), built("b")))).toBe(fingerprint(world(built("b"), built("a"))));
    expect(describeChange(world(built("a")), world(built("b"))).label).toBe("B replaces 1 mod");
  });
});
