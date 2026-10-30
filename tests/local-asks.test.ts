// Bead 5w1: the client only answers "faster" / "jump higher" itself when the ask is about the player.
import { describe, expect, it } from "vitest";
import { localRelativeAsk } from "../src/client/local-asks";

describe("local relative asks", () => {
  it("answers an explicit player ask locally, server up or not", () => {
    for (const up of [true, false]) {
      expect(localRelativeAsk("make me faster", up)).toBe("speed");
      expect(localRelativeAsk("make my character jump higher", up)).toBe("jump");
      expect(localRelativeAsk("Make the player faster", up)).toBe("speed");
    }
  });

  it("sends named things and pronouns to the server", () => {
    expect(localRelativeAsk("make the slimes faster", true)).toBeNull();
    expect(localRelativeAsk("make the dragon slower and faster", true)).toBeNull();
    expect(localRelativeAsk("make the dragon faster", true)).toBeNull();
    expect(localRelativeAsk("make them jump higher", true)).toBeNull();
    expect(localRelativeAsk("make them faster", true)).toBeNull();
    expect(localRelativeAsk("make them faster", false)).toBeNull();
  });

  it("keeps subject-less asks local", () => {
    expect(localRelativeAsk("jump higher", true)).toBe("jump");
    expect(localRelativeAsk("go faster", true)).toBe("speed");
  });

  it("offline, a named ask is still answered locally (there is no server to read it)", () => {
    expect(localRelativeAsk("make the slimes faster", false)).toBe("speed");
  });

  it("ignores asks that are neither", () => {
    expect(localRelativeAsk("make it rain", true)).toBeNull();
    expect(localRelativeAsk("make the dragon bigger", true)).toBeNull();
  });
});
