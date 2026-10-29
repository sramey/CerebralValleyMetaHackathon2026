# Diagonal Recycling Rain

- **Slug:** `diagonal-recycling-rain`
- **Keywords:** rain, diagonal, recycle, raindrop
- **Mod:** `rain`
- **Learned:** 2026-10-29T17:08:38.480Z

## Summary
Uses gravityScale:0 with manual vy/vx for consistent diagonal fall and runs despawn every tick via onGround + y-threshold fallback, preventing missed cleanup when onGround only lasts one tick.

## Reference Pattern
```ts
api.onTick(() => {
  for (const d of api.byType("raindrop")) if (d.onGround || d.y > limitY) api.despawn(d.id);
  if (api.tick() % 3 !== 0) return;
  const drop = api.spawn({ type:"raindrop", w:3, h:14, gravityScale:0, x, y });
  drop.vy = 620; drop.vx = -60;
});
```
