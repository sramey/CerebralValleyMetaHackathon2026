// Basketball & hoop (bead z1d). One ball you can pick up and one grounded goal, both plain mods'
// business: the engine only knows how to DRAW a hoop and a ball (src/client/shapes.ts) from the
// geometry in src/sim/hoop.ts. Press the action key (B / X / J / F) near the ball to pick it up,
// press it again to shoot a real arc into the rim.
//
// A built-in mod source must compile with NO imports (server/compile.ts only transforms, it does not
// bundle), so the goal's ratios are repeated here. tests/basketball.test.ts pins them to HOOP and
// rimOf() in src/sim/hoop.ts, which is what the renderer draws with.
import type { ModDefinition } from "../contract";

/** The ground surface the prompt gives every mod (y = 400), and the sim's gravity (1500) at dt 1/60. */
const GROUND_Y = 400;
const GRAVITY = 1500;
const DT = 1 / 60;
const BALL = 22;

/** The goal box and where its rim mouth is, as fractions of that box (mirrors HOOP). */
export const BASKETBALL_GEOMETRY = { w: 100, h: 200, rimXFrac: 0.18, rimYFrac: 0.52, rimWFrac: 0.34 } as const;

export const basketballMod: ModDefinition = {
  id: "basketball",
  title: "Basketball & hoop",
  knobs: {
    distance: { value: 240, min: 120, max: 600, label: "Hoop distance" },
    arc: { value: 0.62, min: 0.3, max: 1.1, label: "Shot arc (s)" },
    assist: { value: 1, min: 0, max: 1, label: "Aim assist" },
    bounce: { value: 0.45, min: 0, max: 0.9, label: "Ball bounce" },
  },
  setup(api, knobs) {
    const distance = Number(knobs.distance);
    const arc = Number(knobs.arc);
    const assist = Math.min(1, Math.max(0, Number(knobs.assist)));
    const bounce = Math.min(0.9, Math.max(0, Number(knobs.bounce)));
    const G = BASKETBALL_GEOMETRY;

    const player = api.player();
    const fromX = player ? player.x : 120;
    // Start the ball at the player's front foot, inside pickup reach: the first press works.
    const restX = (player ? player.x + player.w + 6 : 220);
    const box = { x: fromX + distance, y: GROUND_Y - G.h, w: G.w, h: G.h };
    const rim = { x: box.x + box.w * G.rimXFrac, y: box.y + box.h * G.rimYFrac, w: box.w * G.rimWFrac };

    api.spawn({
      type: "basketball-hoop",
      x: box.x, y: box.y, w: box.w, h: box.h,
      color: 0xe8702a,
      solid: false,
      gravityScale: 0,
      data: { prop: true, rimY: rim.y },
    });
    const ball = api.spawn({
      type: "basketball",
      x: restX, y: GROUND_Y - BALL, w: BALL, h: BALL,
      color: 0xe8702a,
      solid: false,
      gravityScale: 1,
      data: { restX, restY: GROUND_Y - BALL },
    });

    let held = false;
    let prevPressed = false;
    let prevCy: number | null = null;
    let score = 0;
    let lastScoreTick = -999;
    let returnAt = -1;
    let shownBall = "";

    const setScoreHud = (): void => {
      api.setHud("hoop-score", {
        kind: "stat", icon: "🏀", label: "Baskets", value: score,
        color: 0xffc94d, position: "top-right",
      });
    };
    const setBallHud = (): void => {
      const p = api.player();
      const near = p ? api.touches(p, ball) : false;
      const v = held ? "B to shoot" : near ? "B to pick up" : "walk to the ball";
      if (v === shownBall) return;
      shownBall = v;
      api.setHud("hoop-ball", { kind: "stat", icon: "🏀", label: "Ball", value: v, position: "bottom-right" });
    };
    setScoreHud();
    setBallHud();

    /** Land the ball's centre on the rim after a whole number of frames (deterministic, no aiming luck). */
    const aimedThrow = (): { vx: number; vy: number } => {
      const bx = ball.x + ball.w / 2;
      const by = ball.y + ball.h / 2;
      const dx = rim.x + rim.w / 2 - bx;
      const dy = rim.y - by;
      // The sim integrates vy then y (semi-implicit Euler), so a T-second flight drops
      // 0.5*g*T*(T + dt), not 0.5*g*T*T. Solving for that lands exactly on the rim.
      const frames = Math.max(18, Math.round(arc / DT));
      const T = frames * DT;
      return { vx: dx / T, vy: (dy - 0.5 * GRAVITY * T * (T + DT)) / T };
    };

    const throwBall = (): void => {
      const p = api.player();
      const dir = p ? p.facing : 1;
      const aim = aimedThrow();
      const rawVx = dir * 430;
      const rawVy = -620;
      // Aim assist only helps a shot toward the goal; facing away is a plain pass.
      const facingGoal = Math.sign(rim.x + rim.w / 2 - (ball.x + ball.w / 2)) === dir;
      const a = facingGoal ? assist : 0;
      held = false;
      prevCy = null;
      ball.gravityScale = 1;
      ball.vx = rawVx + (aim.vx - rawVx) * a;
      ball.vy = rawVy + (aim.vy - rawVy) * a;
      api.burst(ball.x + ball.w / 2, ball.y + ball.h / 2, 0xffc94d, 5);
      setBallHud();
    };

    /** Back in the player's reach (or where it started): a made basket should not need a chase. */
    const resetBall = (): void => {
      held = false;
      prevCy = null;
      ball.gravityScale = 1;
      ball.vx = 0;
      ball.vy = 0;
      const p = api.player();
      if (p) {
        ball.x = p.facing > 0 ? p.x + p.w + 6 : p.x - ball.w - 6;
        ball.y = GROUND_Y - ball.h;
        ball.data.restX = ball.x;
        ball.data.restY = ball.y;
      } else {
        ball.x = Number(ball.data.restX);
        ball.y = Number(ball.data.restY);
      }
      setBallHud();
    };

    api.onTick(() => {
      const input = api.input();
      const pressed = Boolean(input.shoot || input.use);
      const fresh = pressed && !prevPressed;
      prevPressed = pressed;
      const p = api.player();

      if (returnAt >= 0 && api.tick() >= returnAt) {
        returnAt = -1;
        resetBall();
      }

      if (held) {
        // Carried in the hands: no gravity, anchored to the player, flips with facing.
        ball.gravityScale = 0;
        ball.vx = 0;
        ball.vy = 0;
        if (p) {
          const dir = p.facing;
          ball.facing = dir;
          ball.x = dir > 0 ? p.x + p.w - ball.w * 0.4 : p.x - ball.w * 0.6;
          ball.y = p.y + p.h * 0.26 - ball.h * 0.4;
        }
        if (fresh) throwBall();
      } else {
        if (fresh && p && api.touches(p, ball)) {
          held = true;
          prevCy = null;
          setBallHud();
        }
        // Bounce on the ground plane even in a world with no ground entity (tests, empty worlds).
        if (ball.y + ball.h > GROUND_Y + 1) {
          ball.y = GROUND_Y - ball.h;
          ball.vy = -Math.abs(ball.vy) * bounce;
          ball.vx *= 0.72;
          if (Math.abs(ball.vy) < 55) { ball.vy = 0; ball.vx = 0; }
        }
        // Rolling friction once it is down.
        if (ball.y + ball.h >= GROUND_Y - 1 && Math.abs(ball.vx) < 12) ball.vx = 0;
        // Lost balls come home instead of vanishing off the level.
        if (ball.y > GROUND_Y + 300 || Math.abs(ball.x - Number(ball.data.restX)) > 1400) resetBall();
      }

      // Swish: the ball's centre crosses the rim's plane going down, inside the mouth.
      const cx = ball.x + ball.w / 2;
      const cy = ball.y + ball.h / 2;
      if (!held && prevCy !== null && prevCy <= rim.y && cy > rim.y && ball.vy > 0 &&
        cx > rim.x && cx < rim.x + rim.w && api.tick() - lastScoreTick > 40) {
        lastScoreTick = api.tick();
        score += 2;
        returnAt = api.tick() + 45;
        setScoreHud();
        api.burst(rim.x + rim.w / 2, rim.y, 0xffc94d, 16);
        api.burst(rim.x + rim.w / 2, rim.y + 8, 0xffffff, 10);
        api.setHud("hoop-swish", {
          kind: "banner", text: "SWISH! +2", icon: "🏀", color: 0xffc94d,
          duration: 1.4, position: "center",
        });
      }
      prevCy = held ? null : cy;
      setBallHud();
    });
  },
  dispose(api) {
    for (const e of api.byType("basketball")) api.despawn(e.id);
    for (const e of api.byType("basketball-hoop")) api.despawn(e.id);
    api.removeHud("hoop-score");
    api.removeHud("hoop-ball");
    api.removeHud("hoop-swish");
  },
  test(t) {
    // The verifier runs this mod alone in an empty world (ADR 0003): build the ground first.
    t.api.spawn({ type: "ground", x: -400, y: GROUND_Y, w: 2400, h: 48, solid: true, gravityScale: 0 });

    const hoop = t.api.byType("basketball-hoop")[0];
    t.expect(!!hoop, "setup spawns one hoop");
    t.expect(t.api.byType("basketball").length === 1, "setup spawns one ball");
    t.expect(!!hoop && hoop.w === BASKETBALL_GEOMETRY.w && hoop.h === BASKETBALL_GEOMETRY.h, "hoop uses the shared goal box");

    // The ball settles on the ground, round and unflattened (the sim keeps its box square).
    t.step(10);
    const ball = t.api.byType("basketball")[0];
    t.expect(!!ball && Math.abs(ball.w - ball.h) < 0.001, "ball keeps a square box (a round silhouette)");
    t.expect(!!ball && Math.abs(ball.y + ball.h - GROUND_Y) < 2, "ball rests on the ground");

    // Stand the player next to the ball: the pickup key is the action key (B maps to it).
    const p = t.api.spawn({ type: "player", x: ball.x - 20, y: GROUND_Y - 34, w: 26, h: 34, color: 0xffffff, gravityScale: 0 });
    p.facing = 1;
    t.step(1, { shoot: true });
    t.expect(t.api.hud("hoop-ball")?.value === "B to shoot", "action key picks the ball up");

    // Press again: it leaves the hands on an arc and drops through the rim.
    t.step(1, { shoot: false });
    t.step(1, { shoot: true });
    t.step(60);
    t.expect(t.api.hud("hoop-score")?.value === 2, "a shot through the rim scores");
    t.expect(ball.gravityScale === 1, "the thrown ball is back under gravity");

    // Score once per shot, not once per frame the ball spends below the rim.
    t.step(30);
    t.expect(t.api.hud("hoop-score")?.value === 2, "one swish scores once");

    // A made basket hands the ball back to the player instead of making them chase it.
    t.expect(t.api.hud("hoop-ball")?.value === "B to pick up", "the ball comes back after a swish");

    // Out of reach: pressing the key far away does not pick the ball back up.
    t.api.entities().find((e) => e.type === "player")!.x = ball.x - 400;
    t.step(1, { shoot: false });
    t.step(1, { shoot: true });
    t.expect(t.api.hud("hoop-ball")?.value === "walk to the ball", "pickup needs the ball within reach");
  },
};

export default basketballMod;
