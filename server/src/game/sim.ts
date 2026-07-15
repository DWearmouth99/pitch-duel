import {
  BALL_RADIUS,
  GOAL_DEPTH,
  GOAL_WIDTH,
  KEEPER_RADIUS,
  KICKOFF_COUNTDOWN_MS,
  MATCH_DURATION_MS,
  PENALTY_ROUNDS,
  PITCH_HEIGHT,
  PITCH_WIDTH,
  PLAYER_RADIUS,
  TICK_DT,
  type BallState,
  type EmoteId,
  type KeeperState,
  type MatchPhase,
  type PenaltyState,
  type PlayerInput,
  type PlayerState,
  type ScoreState,
  type Side,
} from "../shared/protocol.js";

const PLAYER_SPEED = 280;
const DRIBBLE_SPEED = 240;
const KEEPER_SPEED = 220;
const BALL_FRICTION = 0.991;
const KICK_IMPULSE_MIN = 520;
const KICK_IMPULSE_MAX = 1150;
const KICK_RANGE = PLAYER_RADIUS + BALL_RADIUS + 10;
const DRIBBLE_ACQUIRE = PLAYER_RADIUS + BALL_RADIUS + 16;
const DRIBBLE_MAX_SPEED = 420;
const WALL_BOUNCE = 0.72;
const PLAYER_BALL_PUSH = 0.25;
const GK_PICKUP_RANGE = KEEPER_RADIUS + BALL_RADIUS + 10;
const GK_SAVE_RANGE = KEEPER_RADIUS + BALL_RADIUS + 6;
const GK_BOX_DEPTH = 110;
const STUN_TIME = 0.55;
const GK_HOLD_MIN = 0.45;
const GK_HOLD_MAX = 2.4;
const GK_PASS_RANGE = 230;
const GK_PASS_SPEED = 400;
const PENALTY_SHOT_TIME_MS = 8_000;
const SLIDE_SPEED = 520;
const SLIDE_DURATION = 0.32;
const SLIDE_HIT_RADIUS = PLAYER_RADIUS + BALL_RADIUS + 14;
const SLIDE_COOLDOWN = 0.85;
const SLIDE_RECOVER = 0.28;
const EMOTE_DURATION = 1.6;
const BANNER_DURATION = 1.8;

const EMOTES: EmoteId[] = ["cheer", "fire", "shock", "gg"];

/** World X of the penalty taker — further from goal for a real run-up feel. */
const PEN_SPOT_X = PITCH_WIDTH - 280;
const PEN_GOAL_X = PITCH_WIDTH - PLAYER_RADIUS - 6;
const PEN_SHOT_SPEED = 540;
const DIVE_SPEED = 560;
const DIVE_DURATION = 0.85;
const PEN_SAVE_RADIUS = PLAYER_RADIUS + BALL_RADIUS + 8;
const PEN_DIVE_SAVE_RADIUS = PLAYER_RADIUS + BALL_RADIUS + 20;

export interface SimPlayer {
  id: string;
  name: string;
  side: Side;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facingX: number;
  facingY: number;
  input: PlayerInput;
  kickCooldown: number;
  tackleCooldown: number;
  stunTimer: number;
  slideTimer: number;
  slideRecover: number;
  slideDirX: number;
  slideDirY: number;
  slideConnected: boolean;
  emote: EmoteId;
  emoteTimer: number;
  emoteCooldown: number;
}

export interface SimKeeper {
  side: Side;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hasBall: boolean;
  holdTimer: number;
  homeX: number;
  /** After releasing a pass, ignore saves/pickups briefly. */
  throwCooldown: number;
}

function emptyInput(): PlayerInput {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    kick: false,
    tackle: false,
    aimX: PITCH_WIDTH / 2,
    aimY: PITCH_HEIGHT / 2,
    charge: 0,
    shoot: false,
    emote: 0,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function len(x: number, y: number): number {
  return Math.hypot(x, y);
}

function normalize(x: number, y: number): { x: number; y: number } {
  const l = len(x, y);
  if (l < 1e-6) return { x: 0, y: 0 };
  return { x: x / l, y: y / l };
}

/** True if the segment from (x0,y0)-(x1,y1) comes within radius of (cx,cy). */
function segmentHitsCircle(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  radius: number
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const fx = x0 - cx;
  const fy = y0 - cy;
  const a = dx * dx + dy * dy;
  let t = 0;
  if (a > 1e-8) {
    t = clamp(-((fx * dx + fy * dy) / a), 0, 1);
  }
  const px = x0 + dx * t;
  const py = y0 + dy * t;
  return len(px - cx, py - cy) <= radius;
}

function goalMouth(): { top: number; bottom: number } {
  const top = (PITCH_HEIGHT - GOAL_WIDTH) / 2;
  return { top, bottom: top + GOAL_WIDTH };
}

export class GameSim {
  players: SimPlayer[];
  keepers: SimKeeper[];
  ball: BallState;
  score: ScoreState;
  timeLeftMs: number;
  tick: number;
  finished: boolean;
  phase: MatchPhase = "countdown";
  resetCooldown = 0;
  possessionId: string | null = null;
  keeperPossession: Side | null = null;
  penalties: PenaltyState | null = null;
  countdownMs = KICKOFF_COUNTDOWN_MS;
  banner: string | null = null;
  private bannerTimer = 0;

  private penKickArmed = false;
  private penDiveArmed = false;
  private penResultTimer = 0;
  private penBallTimer = 0;
  private penAimTimerMs = 0;
  private penSecretAimX = 1;
  private penSecretAimY = 0;
  private penSecretDiveX = 0;
  private penSecretDiveY = 0;
  private decidedByPens = false;

  constructor(left: { id: string; name: string }, right: { id: string; name: string }) {
    this.players = [
      this.spawnPlayer(left.id, left.name, "left"),
      this.spawnPlayer(right.id, right.name, "right"),
    ];
    this.keepers = [this.spawnKeeper("left"), this.spawnKeeper("right")];
    this.ball = { x: PITCH_WIDTH / 2, y: PITCH_HEIGHT / 2, vx: 0, vy: 0 };
    this.score = { left: 0, right: 0 };
    this.timeLeftMs = MATCH_DURATION_MS;
    this.tick = 0;
    this.finished = false;
  }

  private spawnPlayer(id: string, name: string, side: Side): SimPlayer {
    const x = side === "left" ? PITCH_WIDTH * 0.25 : PITCH_WIDTH * 0.75;
    return {
      id,
      name,
      side,
      x,
      y: PITCH_HEIGHT / 2,
      vx: 0,
      vy: 0,
      facingX: side === "left" ? 1 : -1,
      facingY: 0,
      input: emptyInput(),
      kickCooldown: 0,
      tackleCooldown: 0,
      stunTimer: 0,
      slideTimer: 0,
      slideRecover: 0,
      slideDirX: side === "left" ? 1 : -1,
      slideDirY: 0,
      slideConnected: false,
      emote: null,
      emoteTimer: 0,
      emoteCooldown: 0,
    };
  }

  private spawnKeeper(side: Side): SimKeeper {
    const homeX = side === "left" ? 36 : PITCH_WIDTH - 36;
    return {
      side,
      x: homeX,
      y: PITCH_HEIGHT / 2,
      vx: 0,
      vy: 0,
      hasBall: false,
      holdTimer: 0,
      homeX,
      throwCooldown: 0,
    };
  }

  setInput(playerId: string, input: PlayerInput): void {
    const p = this.players.find((pl) => pl.id === playerId);
    if (!p || this.finished) return;
    p.input = {
      up: !!input.up,
      down: !!input.down,
      left: !!input.left,
      right: !!input.right,
      kick: !!input.kick,
      tackle: !!input.tackle,
      aimX: Number.isFinite(input.aimX) ? input.aimX : p.x + p.facingX * 40,
      aimY: Number.isFinite(input.aimY) ? input.aimY : p.y + p.facingY * 40,
      charge: clamp(Number(input.charge) || 0, 0, 1),
      shoot: !!input.shoot,
      emote: Number(input.emote) || 0,
    };
  }

  step(): void {
    if (this.finished) return;
    this.tick += 1;
    this.tickEmotesAndBanner();

    if (this.phase === "penalties") {
      this.stepPenalties();
      return;
    }

    if (this.phase === "countdown") {
      this.countdownMs = Math.max(0, this.countdownMs - TICK_DT * 1000);
      // Freeze players — no movement during countdown
      for (const p of this.players) {
        p.vx = 0;
        p.vy = 0;
        p.input = emptyInput();
      }
      this.ball.x = PITCH_WIDTH / 2;
      this.ball.y = PITCH_HEIGHT / 2;
      this.ball.vx = 0;
      this.ball.vy = 0;
      this.clearPossession();
      this.keeperPossession = null;
      for (const k of this.keepers) {
        k.hasBall = false;
        k.x = k.homeX;
        k.y = PITCH_HEIGHT / 2;
      }
      if (this.countdownMs <= 0) {
        this.phase = "play";
        this.banner = "KICK OFF!";
        this.bannerTimer = 1.1;
      }
      return;
    }

    this.timeLeftMs = Math.max(0, this.timeLeftMs - TICK_DT * 1000);

    if (this.resetCooldown > 0) {
      this.resetCooldown -= TICK_DT;
      this.updatePlayersMovement(false);
      this.constrainPlayers();
      this.updateKeepersIdle();
      if (this.resetCooldown <= 0) {
        this.ball.vx = 0;
        this.ball.vy = 0;
      }
      this.checkMatchEnd();
      return;
    }

    this.tickCooldowns();
    this.updatePlayersMovement(true);
    this.constrainPlayers();
    this.handleSlideTackles();
    this.handleKicks();
    this.tryAcquirePossession();
    this.applyPossessionBall();
    this.updateKeepers();
    if (!this.possessionId && !this.keeperPossession) {
      this.resolveLooseBallPush();
      this.integrateBall();
      this.bounceBallWalls();
      this.resolveKeeperSaves();
      // Acquire again after contact / ball movement so running onto the ball sticks
      this.tryAcquirePossession();
    }
    this.checkGoals();
    this.checkMatchEnd();
  }

  private tickEmotesAndBanner(): void {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= TICK_DT;
      if (this.bannerTimer <= 0) this.banner = null;
    }
    for (const p of this.players) {
      if (p.emoteTimer > 0) {
        p.emoteTimer -= TICK_DT;
        if (p.emoteTimer <= 0) p.emote = null;
      }
      if (p.emoteCooldown > 0) p.emoteCooldown -= TICK_DT;
      const idx = Math.floor(p.input.emote);
      if (idx >= 1 && idx <= 4 && p.emoteCooldown <= 0) {
        p.emote = EMOTES[idx - 1] ?? null;
        p.emoteTimer = EMOTE_DURATION;
        p.emoteCooldown = 1.2;
      }
    }
  }

  private tickCooldowns(): void {
    for (const p of this.players) {
      if (p.kickCooldown > 0) p.kickCooldown -= TICK_DT;
      if (p.tackleCooldown > 0) p.tackleCooldown -= TICK_DT;
      if (p.stunTimer > 0) p.stunTimer -= TICK_DT;
      if (p.slideRecover > 0) p.slideRecover -= TICK_DT;
      if (p.slideTimer > 0) {
        p.slideTimer -= TICK_DT;
        if (p.slideTimer <= 0) {
          p.slideTimer = 0;
          if (!p.slideConnected) p.slideRecover = SLIDE_RECOVER;
          p.slideConnected = false;
        }
      }
    }
  }

  private updatePlayersMovement(allowSpeed: boolean): void {
    for (const p of this.players) {
      if (p.stunTimer > 0 || p.slideRecover > 0) {
        p.vx = 0;
        p.vy = 0;
        continue;
      }

      // Face mouse only while charging a shot (not while just holding ball)
      if (p.input.charge > 0.02) {
        const adx = p.input.aimX - p.x;
        const ady = p.input.aimY - p.y;
        if (len(adx, ady) > 4) {
          const an = normalize(adx, ady);
          p.facingX = an.x;
          p.facingY = an.y;
        }
      }

      if (p.slideTimer > 0) {
        p.vx = p.slideDirX * SLIDE_SPEED;
        p.vy = p.slideDirY * SLIDE_SPEED;
        p.x += p.vx * TICK_DT;
        p.y += p.vy * TICK_DT;
        continue;
      }

      let dx = 0;
      let dy = 0;
      if (p.input.left) dx -= 1;
      if (p.input.right) dx += 1;
      if (p.input.up) dy -= 1;
      if (p.input.down) dy += 1;
      const n = normalize(dx, dy);
      const speed =
        allowSpeed && this.possessionId === p.id ? DRIBBLE_SPEED : PLAYER_SPEED;
      p.vx = n.x * speed;
      p.vy = n.y * speed;
      // Facing always follows move direction when walking (slide uses this)
      if (n.x !== 0 || n.y !== 0) {
        if (p.input.charge < 0.02) {
          p.facingX = n.x;
          p.facingY = n.y;
        }
      }
      p.x += p.vx * TICK_DT;
      p.y += p.vy * TICK_DT;
    }

    const [a, b] = this.players;
    if (a.slideTimer <= 0 && b.slideTimer <= 0) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = len(dx, dy);
      const minDist = PLAYER_RADIUS * 2;
      if (dist > 0 && dist < minDist) {
        const push = (minDist - dist) / 2;
        const n = normalize(dx, dy);
        a.x -= n.x * push;
        a.y -= n.y * push;
        b.x += n.x * push;
        b.y += n.y * push;
      }
    }
  }

  private constrainPlayers(): void {
    for (const p of this.players) {
      p.y = clamp(p.y, PLAYER_RADIUS, PITCH_HEIGHT - PLAYER_RADIUS);
      // Cannot enter the opponent's penalty box
      if (p.side === "left") {
        const maxX = PITCH_WIDTH - GK_BOX_DEPTH - PLAYER_RADIUS;
        p.x = clamp(p.x, PLAYER_RADIUS, maxX);
      } else {
        const minX = GK_BOX_DEPTH + PLAYER_RADIUS;
        p.x = clamp(p.x, minX, PITCH_WIDTH - PLAYER_RADIUS);
      }
    }
  }

  private clearPossession(): void {
    this.possessionId = null;
  }

  private givePossession(playerId: string): void {
    this.keeperPossession = null;
    for (const k of this.keepers) k.hasBall = false;
    this.possessionId = playerId;
    this.ball.vx = 0;
    this.ball.vy = 0;
  }

  private tryAcquirePossession(): void {
    if (this.keeperPossession) return;
    if (this.possessionId) {
      const holder = this.players.find((p) => p.id === this.possessionId);
      if (!holder || holder.stunTimer > 0 || holder.slideTimer > 0) {
        this.clearPossession();
      }
      return;
    }

    const ballSpeed = len(this.ball.vx, this.ball.vy);
    if (ballSpeed > DRIBBLE_MAX_SPEED) return;

    // Keepers get priority in their box
    for (const k of this.keepers) {
      if (!this.inKeeperBox(k.side, this.ball.x, this.ball.y)) continue;
      const kd = len(this.ball.x - k.x, this.ball.y - k.y);
      if (kd < GK_PICKUP_RANGE + 8) return;
    }

    let best: SimPlayer | null = null;
    let bestDist = Infinity;
    for (const p of this.players) {
      if (p.stunTimer > 0 || p.slideTimer > 0 || p.slideRecover > 0) continue;
      const d = len(this.ball.x - p.x, this.ball.y - p.y);
      // Prefer players moving toward / already overlapping the ball
      const reach = DRIBBLE_ACQUIRE + (ballSpeed < 80 ? 6 : 0);
      if (d < reach && d < bestDist) {
        best = p;
        bestDist = d;
      }
    }
    if (best) this.givePossession(best.id);
  }

  private applyPossessionBall(): void {
    if (!this.possessionId) return;
    const p = this.players.find((pl) => pl.id === this.possessionId);
    if (!p) {
      this.clearPossession();
      return;
    }
    const offset = PLAYER_RADIUS + BALL_RADIUS - 2;
    this.ball.x = p.x + p.facingX * offset;
    this.ball.y = p.y + p.facingY * offset;
    this.ball.vx = p.vx;
    this.ball.vy = p.vy;
  }

  private handleSlideTackles(): void {
    if (this.keeperPossession) return;

    for (const p of this.players) {
      // Start slide
      if (
        p.input.tackle &&
        p.slideTimer <= 0 &&
        p.tackleCooldown <= 0 &&
        p.stunTimer <= 0 &&
        p.slideRecover <= 0 &&
        this.possessionId !== p.id
      ) {
        let dirX = p.facingX;
        let dirY = p.facingY;
        if (len(dirX, dirY) < 1e-3) {
          dirX = p.side === "left" ? 1 : -1;
          dirY = 0;
        }
        const n = normalize(dirX, dirY);
        p.slideDirX = n.x;
        p.slideDirY = n.y;
        p.facingX = n.x;
        p.facingY = n.y;
        p.slideTimer = SLIDE_DURATION;
        p.slideConnected = false;
        p.tackleCooldown = SLIDE_COOLDOWN;
      }

      // Resolve slide contact — knocks ball loose, never auto-possesses
      if (p.slideTimer <= 0 || p.slideConnected) continue;

      const holder =
        this.possessionId && this.possessionId !== p.id
          ? this.players.find((h) => h.id === this.possessionId) ?? null
          : null;

      const hitHolder =
        !!holder &&
        len(holder.x - p.x, holder.y - p.y) < PLAYER_RADIUS * 2 + 12;
      const hitBall =
        len(this.ball.x - p.x, this.ball.y - p.y) < SLIDE_HIT_RADIUS;

      if (!hitHolder && !hitBall) continue;

      if (holder && hitHolder) {
        holder.stunTimer = STUN_TIME;
      }

      // Knock ball away in slide direction (loose ball)
      this.clearPossession();
      const scatter = ((this.tick % 7) - 3) * 0.08;
      const knock = normalize(p.slideDirX + scatter, p.slideDirY - scatter * 0.5);
      this.ball.vx = knock.x * 340 + p.vx * 0.2;
      this.ball.vy = knock.y * 340 + p.vy * 0.2;
      this.ball.x = p.x + knock.x * (PLAYER_RADIUS + BALL_RADIUS + 4);
      this.ball.y = p.y + knock.y * (PLAYER_RADIUS + BALL_RADIUS + 4);
      p.slideConnected = true;
    }
  }

  private kickDirection(p: SimPlayer): { x: number; y: number } {
    const adx = p.input.aimX - p.x;
    const ady = p.input.aimY - p.y;
    if (len(adx, ady) > 6) return normalize(adx, ady);
    return normalize(p.facingX, p.facingY);
  }

  private kickPower(p: SimPlayer): number {
    const c = clamp(p.input.charge, 0, 1);
    // Space-only kick with no charge = solid medium power
    if (!p.input.shoot && p.input.kick) {
      return KICK_IMPULSE_MIN + (KICK_IMPULSE_MAX - KICK_IMPULSE_MIN) * 0.55;
    }
    // Guarantee usable power even if charge somehow arrives as 0 on release
    const powerT = p.input.shoot ? Math.max(c, 0.35) : c;
    return KICK_IMPULSE_MIN + (KICK_IMPULSE_MAX - KICK_IMPULSE_MIN) * powerT;
  }

  private handleKicks(): void {
    for (const p of this.players) {
      if (p.stunTimer > 0 || p.slideTimer > 0) continue;
      const wantsShot = p.input.shoot || p.input.kick;
      if (!wantsShot || p.kickCooldown > 0) continue;

      const dir = this.kickDirection(p);
      const power = this.kickPower(p);

      if (this.possessionId === p.id) {
        this.ball.vx = dir.x * power;
        this.ball.vy = dir.y * power;
        p.facingX = dir.x;
        p.facingY = dir.y;
        this.clearPossession();
        p.kickCooldown = 0.35;
        continue;
      }

      if (this.keeperPossession || this.possessionId) continue;

      const dx = this.ball.x - p.x;
      const dy = this.ball.y - p.y;
      const dist = len(dx, dy);
      if (dist > KICK_RANGE) continue;

      this.ball.vx += dir.x * power;
      this.ball.vy += dir.y * power;
      p.facingX = dir.x;
      p.facingY = dir.y;
      p.kickCooldown = 0.3;
    }
  }

  private resolveLooseBallPush(): void {
    for (const p of this.players) {
      if (p.stunTimer > 0 || p.slideTimer > 0) continue;
      const dx = this.ball.x - p.x;
      const dy = this.ball.y - p.y;
      const dist = len(dx, dy);
      const minDist = PLAYER_RADIUS + BALL_RADIUS;
      if (dist >= minDist || dist < 1e-6) continue;

      // Running into a controllable ball → claim dribble
      const ballSpeed = len(this.ball.vx, this.ball.vy);
      if (
        !this.possessionId &&
        !this.keeperPossession &&
        ballSpeed < DRIBBLE_MAX_SPEED
      ) {
        this.givePossession(p.id);
        return;
      }

      const n = normalize(dx, dy);
      const overlap = minDist - dist;
      this.ball.x += n.x * overlap;
      this.ball.y += n.y * overlap;

      const relVx = this.ball.vx - p.vx;
      const relVy = this.ball.vy - p.vy;
      const closing = relVx * n.x + relVy * n.y;
      if (closing < 0) {
        this.ball.vx -= closing * n.x * (1 + PLAYER_BALL_PUSH);
        this.ball.vy -= closing * n.y * (1 + PLAYER_BALL_PUSH);
      }
    }
  }

  private integrateBall(): void {
    this.ball.x += this.ball.vx * TICK_DT;
    this.ball.y += this.ball.vy * TICK_DT;
    this.ball.vx *= BALL_FRICTION;
    this.ball.vy *= BALL_FRICTION;
    if (Math.abs(this.ball.vx) < 2) this.ball.vx = 0;
    if (Math.abs(this.ball.vy) < 2) this.ball.vy = 0;
  }

  private bounceBallWalls(): void {
    const { top: goalTop, bottom: goalBottom } = goalMouth();

    if (this.ball.y < BALL_RADIUS) {
      this.ball.y = BALL_RADIUS;
      this.ball.vy = Math.abs(this.ball.vy) * WALL_BOUNCE;
    } else if (this.ball.y > PITCH_HEIGHT - BALL_RADIUS) {
      this.ball.y = PITCH_HEIGHT - BALL_RADIUS;
      this.ball.vy = -Math.abs(this.ball.vy) * WALL_BOUNCE;
    }

    if (this.ball.x < BALL_RADIUS) {
      const inGoalMouth = this.ball.y > goalTop && this.ball.y < goalBottom;
      if (!inGoalMouth) {
        this.ball.x = BALL_RADIUS;
        this.ball.vx = Math.abs(this.ball.vx) * WALL_BOUNCE;
      }
    }

    if (this.ball.x > PITCH_WIDTH - BALL_RADIUS) {
      const inGoalMouth = this.ball.y > goalTop && this.ball.y < goalBottom;
      if (!inGoalMouth) {
        this.ball.x = PITCH_WIDTH - BALL_RADIUS;
        this.ball.vx = -Math.abs(this.ball.vx) * WALL_BOUNCE;
      }
    }
  }

  private inKeeperBox(side: Side, x: number, y: number): boolean {
    const { top, bottom } = goalMouth();
    const paddedTop = top - 40;
    const paddedBottom = bottom + 40;
    if (y < paddedTop || y > paddedBottom) return false;
    if (side === "left") return x < GK_BOX_DEPTH;
    return x > PITCH_WIDTH - GK_BOX_DEPTH;
  }

  private updateKeepersIdle(): void {
    for (const k of this.keepers) {
      k.hasBall = false;
      k.holdTimer = 0;
      k.y += (PITCH_HEIGHT / 2 - k.y) * 0.08;
      k.x += (k.homeX - k.x) * 0.08;
    }
    this.keeperPossession = null;
  }

  private teammateOf(side: Side): SimPlayer | undefined {
    return this.players.find((p) => p.side === side);
  }

  private updateKeepers(): void {
    for (const k of this.keepers) {
      if (k.throwCooldown > 0) k.throwCooldown -= TICK_DT;

      if (this.keeperPossession === k.side && k.hasBall) {
        this.updateKeeperWithBall(k);
        continue;
      }

      const inBox = this.inKeeperBox(k.side, this.ball.x, this.ball.y);
      const closingHard =
        k.side === "left"
          ? this.ball.x < PITCH_WIDTH * 0.4 && this.ball.vx < -80
          : this.ball.x > PITCH_WIDTH * 0.6 && this.ball.vx > 80;
      const threat = inBox || closingHard;

      const targetY = threat
        ? clamp(this.ball.y, KEEPER_RADIUS + 8, PITCH_HEIGHT - KEEPER_RADIUS - 8)
        : PITCH_HEIGHT / 2;
      const targetX = threat
        ? k.side === "left"
          ? clamp(Math.min(k.homeX + 24, this.ball.x - 8), 28, GK_BOX_DEPTH - 12)
          : clamp(
              Math.max(k.homeX - 24, this.ball.x + 8),
              PITCH_WIDTH - GK_BOX_DEPTH + 12,
              PITCH_WIDTH - 28
            )
        : k.homeX;

      const dx = targetX - k.x;
      const dy = targetY - k.y;
      const dist = len(dx, dy);
      if (dist > 1) {
        const n = normalize(dx, dy);
        const step = Math.min(KEEPER_SPEED * TICK_DT, dist);
        k.x += n.x * step;
        k.y += n.y * step;
      }

      // Soft collect — skip outbound throws / cooldown so passes don't get reclaimed
      const ballSpeed = len(this.ball.vx, this.ball.vy);
      const outwardVel =
        k.side === "left" ? this.ball.vx : -this.ball.vx;
      if (
        k.throwCooldown <= 0 &&
        outwardVel < 50 &&
        !this.possessionId &&
        !this.keeperPossession &&
        inBox &&
        ballSpeed < 280
      ) {
        const bd = len(this.ball.x - k.x, this.ball.y - k.y);
        if (bd < GK_PICKUP_RANGE) {
          this.keeperCatch(k);
        }
      }
    }
  }

  /** Solid saves: shots that hit the keeper body are caught or parried. */
  private resolveKeeperSaves(): void {
    if (this.possessionId || this.keeperPossession) return;

    const prevX = this.ball.x - this.ball.vx * TICK_DT;
    const prevY = this.ball.y - this.ball.vy * TICK_DT;

    for (const k of this.keepers) {
      if (k.throwCooldown > 0) continue;
      // Ignore balls still leaving after a keeper throw
      const outwardVel =
        k.side === "left" ? this.ball.vx : -this.ball.vx;
      if (outwardVel > 50) continue;

      const hit = segmentHitsCircle(
        prevX,
        prevY,
        this.ball.x,
        this.ball.y,
        k.x,
        k.y,
        GK_SAVE_RANGE
      );
      if (!hit) continue;

      const dx = this.ball.x - k.x;
      const dy = this.ball.y - k.y;
      const dist = Math.max(len(dx, dy), 1e-6);
      const n = normalize(dx, dy);
      const approach = -(this.ball.vx * n.x + this.ball.vy * n.y);
      const towardOwnGoal =
        (k.side === "left" && this.ball.vx < -20) ||
        (k.side === "right" && this.ball.vx > 20);

      if (towardOwnGoal && (approach > 0 || dist < GK_SAVE_RANGE)) {
        this.keeperCatch(k);
        return;
      }

      if (approach > 20) {
        this.ball.x = k.x + n.x * GK_SAVE_RANGE;
        this.ball.y = k.y + n.y * GK_SAVE_RANGE;
        this.ball.vx -= approach * n.x * 1.55;
        this.ball.vy -= approach * n.y * 1.55;
      }
    }
  }

  private keeperCatch(k: SimKeeper): void {
    k.hasBall = true;
    k.holdTimer = 0;
    k.throwCooldown = 0;
    this.keeperPossession = k.side;
    this.clearPossession();
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.x = k.x + (k.side === "left" ? 14 : -14);
    this.ball.y = k.y;
  }

  private releaseKeeperPass(
    k: SimKeeper,
    dirX: number,
    dirY: number,
    speed: number
  ): void {
    const outward = k.side === "left" ? 1 : -1;
    let n = normalize(dirX, dirY);
    // Always eject with a strong upfield component so the ball clears the box
    if (n.x * outward < 0.55) {
      n = normalize(outward * 1.0, n.y * 0.55);
    }
    this.ball.x = k.x + outward * (KEEPER_RADIUS + BALL_RADIUS + 22);
    this.ball.y = clamp(k.y + n.y * 12, BALL_RADIUS + 8, PITCH_HEIGHT - BALL_RADIUS - 8);
    const throwSpeed = clamp(speed, 280, GK_PASS_SPEED);
    this.ball.vx = n.x * throwSpeed;
    this.ball.vy = n.y * throwSpeed;
    k.hasBall = false;
    k.holdTimer = 0;
    k.throwCooldown = 1.35;
    this.keeperPossession = null;
  }

  private passLaneClear(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    allyId: string
  ): boolean {
    const opponent = this.players.find((p) => p.id !== allyId);
    if (!opponent) return true;
    for (let t = 0.12; t <= 0.95; t += 0.08) {
      const px = fromX + (toX - fromX) * t;
      const py = fromY + (toY - fromY) * t;
      if (len(opponent.x - px, opponent.y - py) < 48) return false;
    }
    const oppToTarget = len(opponent.x - toX, opponent.y - toY);
    if (oppToTarget < 36) return false;
    return true;
  }

  private updateKeeperWithBall(k: SimKeeper): void {
    const outward = k.side === "left" ? 1 : -1;
    // Steady posture on the goal line side of the box
    k.x = k.homeX + outward * 4;
    this.ball.x = k.x + outward * 16;
    this.ball.y = k.y;
    this.ball.vx = 0;
    this.ball.vy = 0;
    k.holdTimer += TICK_DT;

    const teammate = this.teammateOf(k.side);
    if (!teammate) return;

    // Ease toward teammate lane but stay across the box, not stuck in the net mouth
    const desiredY = clamp(
      teammate.y,
      KEEPER_RADIUS + 24,
      PITCH_HEIGHT - KEEPER_RADIUS - 24
    );
    k.y += (desiredY - k.y) * 0.05;

    if (k.holdTimer < GK_HOLD_MIN) return;

    // Lead pass ahead of the teammate so they can run onto it
    const receiveX = teammate.x + outward * 55;
    const receiveY = clamp(teammate.y, 40, PITCH_HEIGHT - 40);
    const distToMate = len(teammate.x - k.x, teammate.y - k.y);
    const upfieldEnough = (teammate.x - k.x) * outward > 35;
    const canShortPass =
      distToMate <= GK_PASS_RANGE &&
      upfieldEnough &&
      this.passLaneClear(this.ball.x, this.ball.y, receiveX, receiveY, teammate.id);

    if (canShortPass) {
      let n = normalize(receiveX - this.ball.x, receiveY - this.ball.y);
      if (n.x * outward < 0.55) {
        n = normalize(outward * 0.95, n.y * 0.45);
      }
      const speed = clamp(260 + distToMate * 0.7, 300, GK_PASS_SPEED);
      this.releaseKeeperPass(k, n.x, n.y, speed);
      return;
    }

    if (k.holdTimer < GK_HOLD_MAX) return;

    // Forced clearance to the open wing
    const enemy = this.players.find((p) => p.side !== k.side);
    let clearY = PITCH_HEIGHT * 0.28;
    if (enemy) {
      clearY =
        enemy.y > PITCH_HEIGHT / 2 ? PITCH_HEIGHT * 0.22 : PITCH_HEIGHT * 0.78;
    } else if (teammate.y > PITCH_HEIGHT / 2) {
      clearY = PITCH_HEIGHT * 0.72;
    }
    const n = normalize(outward * 120, clearY - k.y);
    this.releaseKeeperPass(k, n.x, n.y, 340);
  }

  private checkGoals(): void {
    if (this.possessionId || this.keeperPossession) return;
    const { top: goalTop, bottom: goalBottom } = goalMouth();
    const inMouth = this.ball.y > goalTop && this.ball.y < goalBottom;

    if (inMouth && this.ball.x < -GOAL_DEPTH + BALL_RADIUS) {
      this.score.right += 1;
      this.banner = "GOAL!";
      this.bannerTimer = BANNER_DURATION;
      this.resetAfterGoal();
    } else if (inMouth && this.ball.x > PITCH_WIDTH + GOAL_DEPTH - BALL_RADIUS) {
      this.score.left += 1;
      this.banner = "GOAL!";
      this.bannerTimer = BANNER_DURATION;
      this.resetAfterGoal();
    }
  }

  private resetAfterGoal(): void {
    this.clearPossession();
    this.keeperPossession = null;
    this.ball = { x: PITCH_WIDTH / 2, y: PITCH_HEIGHT / 2, vx: 0, vy: 0 };
    for (const p of this.players) {
      p.x = p.side === "left" ? PITCH_WIDTH * 0.25 : PITCH_WIDTH * 0.75;
      p.y = PITCH_HEIGHT / 2;
      p.vx = 0;
      p.vy = 0;
      p.facingX = p.side === "left" ? 1 : -1;
      p.facingY = 0;
      p.input = emptyInput();
      p.kickCooldown = 0;
      p.tackleCooldown = 0;
      p.stunTimer = 0;
      p.slideTimer = 0;
      p.slideRecover = 0;
      p.slideConnected = false;
      p.emote = null;
      p.emoteTimer = 0;
    }
    for (const k of this.keepers) {
      k.x = k.homeX;
      k.y = PITCH_HEIGHT / 2;
      k.hasBall = false;
      k.holdTimer = 0;
      k.throwCooldown = 0;
    }
    this.resetCooldown = 1.2;
  }

  private checkMatchEnd(): void {
    if (this.phase !== "play") return;

    // Mercy rule: 5-goal lead ends the match immediately
    if (Math.abs(this.score.left - this.score.right) >= 5) {
      this.finished = true;
      this.banner = "MERCY RULE!";
      this.bannerTimer = 1.6;
      return;
    }

    if (this.timeLeftMs > 0) return;
    if (this.score.left === this.score.right) {
      this.beginPenalties();
    } else {
      this.finished = true;
    }
  }

  private beginPenalties(): void {
    this.phase = "penalties";
    this.decidedByPens = true;
    this.clearPossession();
    this.keeperPossession = null;
    for (const k of this.keepers) {
      k.hasBall = false;
      k.x = k.side === "left" ? -80 : PITCH_WIDTH + 80;
      k.y = PITCH_HEIGHT / 2;
    }
    this.penalties = {
      active: true,
      shooterSide: "left",
      taken: { left: 0, right: 0 },
      pens: { left: 0, right: 0 },
      round: 1,
      status: "ready",
      prompt: "Penalties — get ready",
      aimX: 1,
      aimY: 0,
      diving: false,
      diveX: 0,
      diveY: 0,
      timeLeftMs: PENALTY_SHOT_TIME_MS,
      showAim: false,
    };
    this.penResultTimer = 1.2;
    this.setupPenaltyKick();
  }

  private setupPenaltyKick(): void {
    if (!this.penalties) return;
    const shooterSide = this.penalties.shooterSide;
    const keeperSide: Side = shooterSide === "left" ? "right" : "left";
    const shooter = this.players.find((p) => p.side === shooterSide)!;
    const keeper = this.players.find((p) => p.side === keeperSide)!;

    shooter.x = PEN_SPOT_X;
    shooter.y = PITCH_HEIGHT / 2;
    shooter.vx = 0;
    shooter.vy = 0;
    shooter.facingX = 1;
    shooter.facingY = 0;
    shooter.stunTimer = 0;
    shooter.input = emptyInput();

    keeper.x = PEN_GOAL_X;
    keeper.y = PITCH_HEIGHT / 2;
    keeper.vx = 0;
    keeper.vy = 0;
    keeper.facingX = -1;
    keeper.facingY = 0;
    keeper.stunTimer = 0;
    keeper.input = emptyInput();

    this.ball.x = PEN_SPOT_X + PLAYER_RADIUS + BALL_RADIUS;
    this.ball.y = PITCH_HEIGHT / 2;
    this.ball.vx = 0;
    this.ball.vy = 0;

    this.penSecretAimX = 1;
    this.penSecretAimY = 0;
    this.penSecretDiveX = 0;
    this.penSecretDiveY = 0;
    this.penAimTimerMs = PENALTY_SHOT_TIME_MS;
    this.penalties.aimX = 1;
    this.penalties.aimY = 0;
    this.penalties.diving = false;
    this.penalties.diveX = 0;
    this.penalties.diveY = 0;
    this.penalties.timeLeftMs = PENALTY_SHOT_TIME_MS;
    this.penalties.showAim = false;
    this.penalties.status = "aiming";
    this.penalties.prompt =
      shooter.name + " to shoot · " + Math.ceil(PENALTY_SHOT_TIME_MS / 1000) + "s";
    this.penKickArmed = false;
    this.penDiveArmed = false;
    this.penBallTimer = 0;
  }

  private stepPenalties(): void {
    if (!this.penalties) return;

    if (this.penalties.status === "ready") {
      this.penResultTimer -= TICK_DT;
      if (this.penResultTimer <= 0) {
        this.setupPenaltyKick();
      }
      return;
    }

    if (this.penalties.status === "result") {
      this.penResultTimer -= TICK_DT;
      if (this.penResultTimer <= 0) {
        if (this.evaluatePenaltiesFinished()) {
          this.finished = true;
          return;
        }
        this.advancePenaltyTurn();
        this.penalties.status = "ready";
        this.penalties.prompt = "Next penalty…";
        this.penResultTimer = 0.9;
      }
      return;
    }

    const shooterSide = this.penalties.shooterSide;
    const keeperSide: Side = shooterSide === "left" ? "right" : "left";
    const shooter = this.players.find((p) => p.side === shooterSide)!;
    const keeper = this.players.find((p) => p.side === keeperSide)!;

    if (this.penalties.status === "aiming") {
      this.penAimTimerMs = Math.max(0, this.penAimTimerMs - TICK_DT * 1000);
      this.penalties.timeLeftMs = this.penAimTimerMs;

      let ay = this.penSecretAimY;
      let curl = 0;
      if (shooter.input.up) ay -= 1.8 * TICK_DT;
      if (shooter.input.down) ay += 1.8 * TICK_DT;
      if (shooter.input.left) curl -= 0.35;
      if (shooter.input.right) curl += 0.35;
      ay = clamp(ay, -0.9, 0.9);
      const aim = normalize(1 + curl * 0.08, ay);
      this.penSecretAimX = aim.x;
      this.penSecretAimY = aim.y;

      shooter.x = PEN_SPOT_X;
      shooter.y = PITCH_HEIGHT / 2;
      // Anonymous facing so opponent cannot read aim
      shooter.facingX = 1;
      shooter.facingY = 0;

      let kdy = 0;
      if (keeper.input.up) kdy -= 1;
      if (keeper.input.down) kdy += 1;
      keeper.y = clamp(
        keeper.y + kdy * PLAYER_SPEED * 0.85 * TICK_DT,
        goalMouth().top + 8,
        goalMouth().bottom - 8
      );
      keeper.x = PEN_GOAL_X;
      keeper.facingX = -1;
      keeper.facingY = 0;

      let ddx = 0;
      let ddy = 0;
      if (keeper.input.left) ddx -= 1;
      if (keeper.input.right) ddx += 1;
      if (keeper.input.up) ddy -= 1;
      if (keeper.input.down) ddy += 1;
      if (ddx !== 0 || ddy !== 0) {
        const n = normalize(ddx, ddy);
        this.penSecretDiveX = n.x;
        this.penSecretDiveY = n.y;
      }

      this.penalties.prompt =
        shooter.name +
        " to shoot · " +
        Math.max(1, Math.ceil(this.penAimTimerMs / 1000)) +
        "s";

      if (shooter.input.kick && !this.penKickArmed) {
        this.penKickArmed = true;
        this.firePenaltyShot(shooter);
      }
      if (!shooter.input.kick) this.penKickArmed = false;

      if (
        (keeper.input.tackle || keeper.input.kick) &&
        !this.penDiveArmed &&
        this.penalties.status === "aiming"
      ) {
        this.penDiveArmed = true;
      }

      if (this.penalties.status === "aiming" && this.penAimTimerMs <= 0) {
        this.firePenaltyShot(shooter);
      }

      this.ball.x = PEN_SPOT_X + PLAYER_RADIUS + BALL_RADIUS;
      this.ball.y = shooter.y;
      return;
    }

    if (this.penalties.status === "inflight") {
      this.penBallTimer += TICK_DT;

      // Keep positioning during the shot so standing saves are possible
      let kdy = 0;
      if (keeper.input.up) kdy -= 1;
      if (keeper.input.down) kdy += 1;
      if (!this.penalties.diving) {
        keeper.y = clamp(
          keeper.y + kdy * PLAYER_SPEED * 0.75 * TICK_DT,
          goalMouth().top + 4,
          goalMouth().bottom - 4
        );
        keeper.x = PEN_GOAL_X;
      }

      if (!this.penalties.diving) {
        if (this.penDiveArmed || keeper.input.tackle || keeper.input.kick) {
          this.penalties.diving = true;
          if (
            Math.abs(this.penSecretDiveX) < 0.01 &&
            Math.abs(this.penSecretDiveY) < 0.01
          ) {
            // Auto-dive toward the ball if no direction was chosen
            this.penSecretDiveX = -0.15;
            this.penSecretDiveY = Math.sign(this.ball.y - keeper.y) || 0;
            const n = normalize(this.penSecretDiveX, this.penSecretDiveY);
            this.penSecretDiveX = n.x;
            this.penSecretDiveY = n.y;
          }
        }
      }

      if (this.penalties.diving && this.penBallTimer < DIVE_DURATION) {
        keeper.x += this.penSecretDiveX * DIVE_SPEED * TICK_DT;
        keeper.y += this.penSecretDiveY * DIVE_SPEED * TICK_DT;
        keeper.y = clamp(
          keeper.y,
          goalMouth().top - 20,
          goalMouth().bottom + 20
        );
        keeper.x = clamp(keeper.x, PITCH_WIDTH * 0.72, PITCH_WIDTH - 6);
      }

      const prevX = this.ball.x;
      const prevY = this.ball.y;
      this.integrateBall();

      // Swept collision so fast shots cannot tunnel through the keeper
      const saveR = this.penalties.diving
        ? PEN_DIVE_SAVE_RADIUS
        : PEN_SAVE_RADIUS;
      if (
        segmentHitsCircle(
          prevX,
          prevY,
          this.ball.x,
          this.ball.y,
          keeper.x,
          keeper.y,
          saveR
        )
      ) {
        this.ball.x = keeper.x - 12;
        this.ball.y = keeper.y;
        this.ball.vx = 0;
        this.ball.vy = 0;
        this.resolvePenaltyKick(false, "Saved!");
        return;
      }

      const { top, bottom } = goalMouth();
      if (this.ball.x > PITCH_WIDTH + GOAL_DEPTH - BALL_RADIUS) {
        if (this.ball.y > top && this.ball.y < bottom) {
          this.resolvePenaltyKick(true, "Goal!");
        } else {
          this.resolvePenaltyKick(false, "Missed!");
        }
        return;
      }

      if (
        this.ball.y < -20 ||
        this.ball.y > PITCH_HEIGHT + 20 ||
        this.penBallTimer > 2.8
      ) {
        this.resolvePenaltyKick(false, "Missed!");
      }
    }
  }

  private firePenaltyShot(shooter: SimPlayer): void {
    if (!this.penalties || this.penalties.status !== "aiming") return;
    const aimX = this.penSecretAimX;
    const aimY = this.penSecretAimY;
    this.ball.vx = aimX * PEN_SHOT_SPEED;
    this.ball.vy = aimY * PEN_SHOT_SPEED;
    this.ball.x = shooter.x + aimX * (PLAYER_RADIUS + BALL_RADIUS);
    this.ball.y = shooter.y + aimY * (PLAYER_RADIUS + BALL_RADIUS);
    this.penalties.status = "inflight";
    this.penalties.prompt = "Shot away!";
    this.penalties.timeLeftMs = 0;
    this.penBallTimer = 0;
    this.clearPossession();
  }

  private resolvePenaltyKick(scored: boolean, prompt: string): void {
    if (!this.penalties) return;
    const side = this.penalties.shooterSide;
    if (scored) {
      this.penalties.pens[side] += 1;
    }
    this.penalties.taken[side] += 1;
    this.penalties.status = "result";
    this.penalties.prompt = prompt;
    this.penResultTimer = 1.35;
    this.ball.vx *= 0.15;
    this.ball.vy *= 0.15;
  }

  private advancePenaltyTurn(): void {
    if (!this.penalties) return;
    this.penalties.shooterSide =
      this.penalties.shooterSide === "left" ? "right" : "left";
    if (this.penalties.shooterSide === "left") {
      this.penalties.round += 1;
    }
  }

  private evaluatePenaltiesFinished(): boolean {
    if (!this.penalties) return true;
    const { taken, pens } = this.penalties;
    const bothTakenAtLeast = Math.min(taken.left, taken.right);

    // Best of 5: after equal kicks, check insurmountable lead
    if (bothTakenAtLeast < PENALTY_ROUNDS) {
      const leftRemain = PENALTY_ROUNDS - taken.left;
      const rightRemain = PENALTY_ROUNDS - taken.right;
      if (pens.left > pens.right + rightRemain) return true;
      if (pens.right > pens.left + leftRemain) return true;
      return false;
    }

    // Sudden death: need equal taken and one ahead
    if (taken.left === taken.right && pens.left !== pens.right) {
      return true;
    }
    return false;
  }

  getWinner(): Side {
    if (this.phase === "penalties" && this.penalties) {
      if (this.penalties.pens.left > this.penalties.pens.right) return "left";
      return "right";
    }
    if (this.score.left > this.score.right) return "left";
    return "right";
  }

  wasDecidedByPens(): boolean {
    return this.decidedByPens;
  }

  getPenaltyScore(): ScoreState | null {
    return this.penalties ? { ...this.penalties.pens } : null;
  }

  snapshotPlayers(): PlayerState[] {
    return this.players.map((p) => ({
      id: p.id,
      name: p.name,
      side: p.side,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      facingX: p.facingX,
      facingY: p.facingY,
      hasBall: this.possessionId === p.id,
      stunned: p.stunTimer > 0 || p.slideRecover > 0,
      sliding: p.slideTimer > 0,
      charge: p.input.charge,
      emote: p.emote,
    }));
  }

  snapshotKeepers(): KeeperState[] {
    return this.keepers.map((k) => ({
      side: k.side,
      x: k.x,
      y: k.y,
      hasBall: k.hasBall,
    }));
  }

  snapshotPenalties(viewerSide?: Side): PenaltyState | null {
    if (!this.penalties) return null;
    const isShooter = viewerSide === this.penalties.shooterSide;
    return {
      ...this.penalties,
      pens: { ...this.penalties.pens },
      taken: { ...this.penalties.taken },
      aimX: isShooter ? this.penSecretAimX : 1,
      aimY: isShooter ? this.penSecretAimY : 0,
      diveX: 0,
      diveY: 0,
      showAim: isShooter && this.penalties.status === "aiming",
      timeLeftMs: this.penalties.timeLeftMs ?? this.penAimTimerMs,
    };
  }
}
