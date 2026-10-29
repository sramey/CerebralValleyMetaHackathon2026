# Elastic Bouncing Ball

- **Slug:** `bouncing-ball`
- **Keywords:** ball, bounce, bouncing, orb, sphere
- **Mod:** `bouncing-ball`
- **Learned:** 2026-10-29T00:00:00.000Z

## Summary
Spawns a single non-solid circle entity with gravityScale 1 that reverses vertical velocity on ground contact with configurable bounce height.

## Reference Pattern
```ts
const ball = api.spawn({ type: "ball", x: 240, y: 260, w: 28, h: 28, vx: 90, vy: 0, color: 0xff6b4a, solid: false, gravityScale: 1 });
api.onTick(() => {
  if (ball.onGround) ball.vy = -Number(knobs.bounce ?? 520);
});
```
