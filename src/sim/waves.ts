// Pure, deterministic wave spawner and swarm archetype (ADR 0052).
// Provides off-screen multi-angle spawning (40% left, 40% right, 20% airborne flyers),
// anti-clumping boid separation, and kill-paced level progression.
import type {
  Entity,
  ModApi,
  SwarmSeparationOptions,
  WaveController as IWaveController,
  WaveControllerOptions,
  WaveSpawnOptions,
} from "../contract";
import { faceToward, type FacingClock } from "./facing";
import { isFlyerType } from "../ontology";

export interface WaveSpawnPosition {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  gravityScale: number;
  side: "left" | "right" | "top";
  isFlyer: boolean;
}

export function computeWaveSpawn(
  api: ModApi,
  options: WaveSpawnOptions = {},
): WaveSpawnPosition {
  const sw = options.screenWidth ?? 960;
  const groundY = options.groundY ?? 400;
  const w = options.w ?? 24;
  const h = options.h ?? 24;
  const speed = options.speed ?? 75;

  let camX = 0;
  let camY = 0;
  if (api.camera) {
    const c = api.camera();
    camX = c.x;
    camY = c.y;
  } else {
    const player = api.player();
    if (player) {
      camX = player.x + player.w / 2 - sw / 2;
      camY = Math.min(0, player.y + player.h / 2 - 270);
    }
  }

  const canFly = options.allowFlyers ?? (
    options.flyerType !== undefined ||
    (options.type === undefined ? true : isFlyerType(options.type))
  );
  let side: "left" | "right" | "top";
  if (options.side) {
    side = options.side;
  } else if (!canFly) {
    // Walker hostiles must stay on the ground and have gravity: flank 50% left, 50% right
    side = api.rand() < 0.5 ? "left" : "right";
  } else {
    // 40% left, 40% right, 20% airborne flyers from top
    const roll = api.rand();
    if (roll < 0.4) {
      side = "left";
    } else if (roll < 0.8) {
      side = "right";
    } else {
      side = "top";
    }
  }

  if (side === "left") {
    // 40% from left (camera.x - 260: clears wide windows, the sim assumes a 960 px view)
    const x = camX - 260;
    const y = groundY - h;
    return {
      x,
      y,
      vx: speed,
      vy: 0,
      facing: 1,
      gravityScale: 1,
      side,
      isFlyer: false,
    };
  }

  if (side === "right") {
    // 40% from right (camera.x + screen.w + 260)
    const x = camX + sw + 260;
    const y = groundY - h;
    return {
      x,
      y,
      vx: -speed,
      vy: 0,
      facing: -1,
      gravityScale: 1,
      side,
      isFlyer: false,
    };
  }

  // 20% airborne flyers/swoopers from top (camera.y - 60)
  const minX = camX + 60;
  const maxX = camX + sw - 60 - w;
  const x = minX + api.rand() * Math.max(0, maxX - minX);
  const y = camY - 60;
  const vx = (api.rand() - 0.5) * speed * 0.8;
  const vy = speed * 0.75;
  return {
    x,
    y,
    vx,
    vy,
    facing: vx >= 0 ? 1 : -1,
    gravityScale: 0,
    side,
    isFlyer: true,
  };
}

export function spawnWaveUnit(api: ModApi, options: WaveSpawnOptions = {}): Entity {
  const pos = computeWaveSpawn(api, options);
  const w = options.w ?? (pos.isFlyer ? 22 : 24);
  const h = options.h ?? (pos.isFlyer ? 18 : 24);
  const type = pos.isFlyer
    ? (options.flyerType ?? (options.type ? `${options.type}-flyer` : "swarm-bat"))
    : (options.type ?? "swarm-crawler");
  const color = pos.isFlyer
    ? (options.flyerColor ?? 0x9b5de5)
    : (options.color ?? 0xe2483d);
  const health = options.health ?? 25;
  const damage = options.damage ?? 10;

  const entity = api.spawn({
    type,
    kind: options.kind ?? "creature",
    x: pos.x,
    y: pos.y,
    w,
    h,
    vx: pos.vx,
    vy: pos.vy,
    color,
    solid: false,
    gravityScale: pos.gravityScale,
    health,
    data: {
      hostile: true,
      enemy: true,
      creature: true,
      swarm: true,
      side: pos.side,
      flying: pos.isFlyer,
      damage,
      speed: options.speed ?? 75,
      ...(options.data ?? {}),
    },
  });
  entity.facing = pos.facing;
  return entity;
}

export function applySwarmSeparation(
  entities: Entity[] | readonly Entity[],
  options?: SwarmSeparationOptions,
): void {
  const radius = options?.radius ?? 40;
  const strength = options?.strength ?? 35;
  const swarm = entities.filter(
    (e) => !(e as any).dead && !(e as any).despawned && (e.data.swarm === true || e.data.hostile === true || e.data.enemy === true),
  );
  const count = swarm.length;
  if (count < 2) return;

  for (let i = 0; i < count; i++) {
    const a = swarm[i];
    let sepX = 0;
    let sepY = 0;

    for (let j = 0; j < count; j++) {
      if (i === j) continue;
      const b = swarm[j];
      let dx = (a.x + a.w / 2) - (b.x + b.w / 2);
      let dy = (a.y + a.h / 2) - (b.y + b.h / 2);
      let dist = Math.hypot(dx, dy);

      if (dist < 0.001) {
        dx = a.id > b.id ? 1 : -1;
        dy = (a.id % 2 === 0 ? 1 : -1) * 0.5;
        dist = Math.hypot(dx, dy);
      }

      if (dist < radius) {
        const factor = 1 - dist / radius;
        sepX += (dx / dist) * factor * strength;
        if (a.gravityScale === 0 || a.data.flying === true) {
          sepY += (dy / dist) * factor * strength;
        }
      }
    }

    a.vx += sepX;
    if (a.gravityScale === 0 || a.data.flying === true) {
      a.vy += sepY;
    }
  }
}

export class WaveController implements IWaveController {
  level = 1;
  kills = 0;
  totalKills = 0;
  killsRequired = 5;
  currentSpeed: number;
  currentWaveSize: number;

  private baseSpeed: number;
  private baseWaveSize: number;
  private killsPerLevel: number;
  private speedScaling: number;
  private waveSizeScaling: number;
  private spawnInterval: number;
  private maxConcurrent: number;
  private spawnTimer = 0;
  private spawnedThisWave = 0;
  private bannerAnnouncedLevel = 0;
  private trackedEnemies = new Map<number, Entity>();
  /** When each enemy last flipped its sprite, so the sprite never strobes (ADR 0071). */
  private facingClock: FacingClock = new Map();
  private disposed = false;
  private onLevelUpCallbacks: Array<(level: number) => void> = [];

  constructor(
    private readonly api: ModApi,
    private readonly options: WaveControllerOptions = {},
  ) {
    this.baseSpeed = options.baseSpeed ?? 75;
    this.currentSpeed = this.baseSpeed;
    this.baseWaveSize = options.baseWaveSize ?? 5;
    this.currentWaveSize = this.baseWaveSize;
    this.killsPerLevel = options.killsPerLevel ?? 5;
    this.killsRequired = this.killsPerLevel;
    // 10-15% increase per level (default 12%)
    this.speedScaling = options.speedScaling ?? 0.12;
    this.waveSizeScaling = options.waveSizeScaling ?? 0.12;
    this.spawnInterval = options.spawnInterval ?? 35;
    this.maxConcurrent = options.maxConcurrent ?? 8;

    this.announceLevelBanner();
    this.updateHudStats();

    if (options.autoTick !== false) {
      api.onTick((dt) => {
        if (!this.disposed) this.step(dt);
      });
    }
  }

  getLevel(): number {
    return this.level;
  }

  getKills(): number {
    return this.kills;
  }

  onLevelUp(cb: (level: number) => void): void {
    this.onLevelUpCallbacks.push(cb);
  }

  recordKill(): void {
    this.kills++;
    this.totalKills++;
    this.checkLevelProgression();
    this.updateHudStats();
  }

  private announceLevelBanner(): void {
    if (this.bannerAnnouncedLevel === this.level) return;
    this.bannerAnnouncedLevel = this.level;
    this.api.setHud("wave", {
      kind: "banner",
      text: `Wave ${this.level}`,
      duration: 2,
      position: "top-center",
      color: 0xffd700,
    });
  }

  private updateHudStats(): void {
    this.api.setHud("wave-level", {
      kind: "stat",
      label: "Level",
      value: this.level,
      icon: "⚔️",
      position: "top-left",
    });
    this.api.setHud("wave-kills", {
      kind: "stat",
      label: "Kills",
      value: `${this.kills}/${this.killsRequired}`,
      icon: "💀",
      position: "top-left",
    });
  }

  private checkLevelProgression(): void {
    if (this.kills >= this.killsRequired) {
      this.levelUp();
    }
  }

  private levelUp(): void {
    this.level++;
    this.kills = 0;
    // Each level increases wave size or enemy speed by 10-15%
    const speedMult = Math.pow(1 + this.speedScaling, this.level - 1);
    const sizeMult = Math.pow(1 + this.waveSizeScaling, this.level - 1);
    this.currentSpeed = Math.round(this.baseSpeed * speedMult);
    this.currentWaveSize = Math.max(5, Math.round(this.baseWaveSize * sizeMult));
    this.killsRequired = Math.max(5, Math.round(this.killsPerLevel * sizeMult));
    this.spawnedThisWave = 0;

    this.announceLevelBanner();
    this.updateHudStats();

    for (const cb of this.onLevelUpCallbacks) {
      cb(this.level);
    }
  }

  spawnWave(): void {
    const toSpawn = Math.min(
      this.currentWaveSize - this.spawnedThisWave,
      this.maxConcurrent - this.trackedEnemies.size,
    );
    for (let i = 0; i < toSpawn; i++) {
      this.spawnOne();
    }
  }

  private spawnOne(): Entity {
    const e = spawnWaveUnit(this.api, {
      speed: this.currentSpeed,
      groundY: this.options.groundY,
      screenWidth: this.options.screenWidth,
      screenHeight: this.options.screenHeight,
      type: this.options.enemyType,
      flyerType: this.options.flyerType,
      allowFlyers: this.options.allowFlyers,
    });
    this.trackedEnemies.set(e.id, e);
    this.spawnedThisWave++;
    return e;
  }

  step(dt = 1 / 60): void {
    if (this.disposed) return;

    // 1. Check defeated enemies
    const liveEntities = this.api.entities();
    const liveIds = new Set(liveEntities.map((e) => e.id));
    let killsGained = 0;

    for (const [id, enemy] of this.trackedEnemies) {
      const isDead =
        !liveIds.has(id) ||
        (enemy as any).dead ||
        (enemy as any).despawned ||
        enemy.health <= 0;
      if (isDead) {
        this.trackedEnemies.delete(id);
        killsGained++;
      }
    }

    if (killsGained > 0) {
      this.kills += killsGained;
      this.totalKills += killsGained;
      this.checkLevelProgression();
      this.updateHudStats();
    }

    // 2. Check stomp damage by player
    const player = this.api.player();
    if (player && player.vy > 0 && !(player as any).dead) {
      for (const [id, enemy] of this.trackedEnemies) {
        if (overlap(player, enemy) && player.y + player.h - enemy.y < 18) {
          this.api.burst(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, enemy.color, 12);
          this.api.damage(id, 100);
          player.vy = -380; // bounce
        }
      }
    }

    // 3. Spawning pace
    if (
      this.trackedEnemies.size < this.maxConcurrent &&
      this.spawnedThisWave < this.currentWaveSize
    ) {
      this.spawnTimer--;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = this.spawnInterval;
        this.spawnOne();
      }
    }

    // 4. If current wave is cleared, prepare next wave
    if (this.trackedEnemies.size === 0 && this.spawnedThisWave >= this.currentWaveSize) {
      this.spawnedThisWave = 0;
      this.spawnTimer = 0;
    }

    // 5. Update swarm enemy movement towards player
    this.updateSwarmMovement(liveEntities);

    // 6. Anti-clumping separation
    applySwarmSeparation(liveEntities, {
      radius: this.options.separationRadius ?? 40,
      strength: this.options.separationStrength ?? 35,
    });
  }

  private updateSwarmMovement(entities: readonly Entity[]): void {
    const player = this.api.player();
    const tick = this.api.tick();

    for (const [, enemy] of this.trackedEnemies) {
      if ((enemy as any).dead || (enemy as any).despawned) continue;
      const isFlyer = enemy.data.flying === true || enemy.gravityScale === 0;

      if (!isFlyer) {
        if (player) {
          const dx = (player.x + player.w / 2) - (enemy.x + enemy.w / 2);
          // Velocity follows the player; only the SPRITE lags, so it cannot strobe when the
          // player stands on the enemy's centre (ADR 0071).
          const dir = dx >= 0 ? 1 : -1;
          faceToward(enemy, dir, this.facingClock, tick);
          enemy.vx = dir * this.currentSpeed;
        } else {
          enemy.vx = enemy.facing * this.currentSpeed;
        }
      } else {
        if (player) {
          const dx = (player.x + player.w / 2) - (enemy.x + enemy.w / 2);
          const dy = (player.y + player.h / 2) - (enemy.y + enemy.h / 2);
          const targetVx = (dx >= 0 ? 1 : -1) * this.currentSpeed * 0.8;
          const wobble = Math.sin(tick * 0.08 + enemy.id) * 30;
          const targetVy = dy > 0 ? Math.min(120, dy * 0.8) : -40 + wobble;
          enemy.vx += (targetVx - enemy.vx) * 0.12;
          enemy.vy += (targetVy - enemy.vy) * 0.12;
          faceToward(enemy, enemy.vx >= 0 ? 1 : -1, this.facingClock, tick);
        } else {
          enemy.vx = enemy.facing * this.currentSpeed * 0.6;
        }
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const [id] of this.trackedEnemies) {
      this.api.despawn(id);
    }
    this.trackedEnemies.clear();
    this.facingClock.clear();
    this.api.removeHud("wave");
    this.api.removeHud("wave-level");
    this.api.removeHud("wave-kills");
  }
}

export function createWaveController(
  api: ModApi,
  options?: WaveControllerOptions,
): WaveController {
  return new WaveController(api, options);
}

function overlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
