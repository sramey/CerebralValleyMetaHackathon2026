// Pure copy shared by the server and the client for a server that has no AI (no key, kill switch).
/** Copy for a server with no AI (no key, kill switch): honest about what is off and what still works. */
export const AI_OFF = {
  placeholder: "AI is off here. Play, or open a demo world (« panel)",
  panelPlaceholder: "AI is off: building is paused",
  orbLabel: "AI off",
  /** The server's greeting when it starts without an AI (also what the first frame says). */
  greeting: "The AI is off on this server (no Meta key), so building is paused. You can still play, draw a level, and open a demo world from the « panel.",
  /** After a demo world opens. */
  worldOpened: (n: number): string => `Opened a world with ${n} mods. The AI is off, so you can play it and tune its knobs, but not build new things.`,
} as const;
