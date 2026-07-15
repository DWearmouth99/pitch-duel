import {
  BALL_RADIUS,
  PITCH_HEIGHT,
  PITCH_WIDTH,
  PLAYER_RADIUS,
  type PlayerInput,
  type Side,
} from "../shared/protocol.js";
import { divisionForElo } from "../shared/ranks.js";
import type { GameSim, SimPlayer } from "./sim.js";

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

/** Skill 0 (weak bronze) → 1 (champion). */
export function skillFromElo(elo: number): number {
  return clamp((elo - 750) / 1650, 0, 1);
}

export function aiOpponentFor(playerElo: number): {
  elo: number;
  name: string;
  skill: number;
} {
  const jitter = Math.round((Math.random() - 0.5) * 80);
  const elo = Math.max(100, Math.round(playerElo + jitter));
  const div = divisionForElo(elo);
  return {
    elo,
    name: `AI ${div.label}`,
    skill: skillFromElo(elo),
  };
}

/**
 * ELO-scaled outfield AI.
 * Lower ranks: delayed reactions, noisy aiming, soft shots, rare slides.
 * Higher ranks: tighter chase, better shooting angles, more decisive tackles.
 */
export class AiController {
  private readonly playerId: string;
  private readonly skill: number;
  private charge = 0;
  private chargeTarget = 0;
  private thinkCd = 0;
  private stickyTx = PITCH_WIDTH / 2;
  private stickyTy = PITCH_HEIGHT / 2;
  private penKickDelay = 0;
  private penDiveBias = 0;

  constructor(playerId: string, skill: number) {
    this.playerId = playerId;
    this.skill = clamp(skill, 0, 1);
  }

  update(sim: GameSim): void {
    const me = sim.players.find((p) => p.id === this.playerId);
    if (!me) return;

    if (sim.phase === "countdown") {
      sim.setInput(this.playerId, emptyInput());
      return;
    }

    if (sim.phase === "penalties") {
      this.updatePenalties(sim, me);
      return;
    }

    this.thinkCd -= 1 / 60;
    const reaction = 0.22 - this.skill * 0.17; // bronze ~0.22s, champ ~0.05s
    if (this.thinkCd <= 0) {
      this.thinkCd = reaction * (0.7 + Math.random() * 0.6);
      this.pickTarget(sim, me);
    }

    const input = this.buildPlayInput(sim, me);
    sim.setInput(this.playerId, input);
  }

  private pickTarget(sim: GameSim, me: SimPlayer): void {
    const hasBall = sim.possessionId === me.id;
    const opp = sim.players.find((p) => p.id !== me.id)!;
    const goalX = me.side === "left" ? PITCH_WIDTH : 0;
    const ownGoalX = me.side === "left" ? 0 : PITCH_WIDTH;
    const outward = me.side === "left" ? 1 : -1;

    const error = (1 - this.skill) * (55 + Math.random() * 40);

    if (hasBall) {
      // Drive toward goal with lateral drift; better AI hugs better lanes
      const lane =
        opp.y > PITCH_HEIGHT / 2
          ? PITCH_HEIGHT * (0.28 + this.skill * 0.08)
          : PITCH_HEIGHT * (0.72 - this.skill * 0.08);
      this.stickyTx = goalX - outward * (120 - this.skill * 40);
      this.stickyTy = lane + (Math.random() - 0.5) * error;
      return;
    }

    // Ball held by opponent → pressure / cut angle
    if (sim.possessionId === opp.id) {
      const cutX = opp.x - outward * (40 + this.skill * 30);
      this.stickyTx = cutX + (Math.random() - 0.5) * error;
      this.stickyTy = opp.y + (Math.random() - 0.5) * error * 0.6;
      return;
    }

    // Loose ball — bronze sometimes jogs mid wrongly
    if (Math.random() > 0.15 + this.skill * 0.7) {
      this.stickyTx = PITCH_WIDTH * 0.5 + outward * 80;
      this.stickyTy = PITCH_HEIGHT / 2 + (Math.random() - 0.5) * 120;
      return;
    }

    const lead = 8 + this.skill * 18;
    const bnx = sim.ball.vx !== 0 || sim.ball.vy !== 0
      ? normalize(sim.ball.vx, sim.ball.vy)
      : { x: 0, y: 0 };
    this.stickyTx = sim.ball.x + bnx.x * lead + (Math.random() - 0.5) * error;
    this.stickyTy = sim.ball.y + bnx.y * lead + (Math.random() - 0.5) * error;

    // Defend own half a bit if losing badly or deep
    const behind =
      (me.side === "left" && me.x > PITCH_WIDTH * 0.55) ||
      (me.side === "right" && me.x < PITCH_WIDTH * 0.45);
    if (behind && Math.random() > this.skill) {
      this.stickyTx = ownGoalX + outward * (180 + this.skill * 40);
      this.stickyTy = sim.ball.y * 0.5 + PITCH_HEIGHT * 0.25;
    }
  }

  private buildPlayInput(sim: GameSim, me: SimPlayer): PlayerInput {
    const input = emptyInput();
    const hasBall = sim.possessionId === me.id;
    const opp = sim.players.find((p) => p.id !== me.id)!;
    const goalX = me.side === "left" ? PITCH_WIDTH + 20 : -20;
    const goalY = PITCH_HEIGHT / 2;
    const outward = me.side === "left" ? 1 : -1;

    const dx = this.stickyTx - me.x;
    const dy = this.stickyTy - me.y;
    const dead = 14 - this.skill * 6;
    if (dx < -dead) input.left = true;
    if (dx > dead) input.right = true;
    if (dy < -dead) input.up = true;
    if (dy > dead) input.down = true;

    // Slide tackle when close to opponent with ball
    const distOpp = len(opp.x - me.x, opp.y - me.y);
    const tackleChance = 0.008 + this.skill * 0.035;
    if (
      !hasBall &&
      sim.possessionId === opp.id &&
      distOpp < 52 + this.skill * 18 &&
      me.tackleCooldown <= 0 &&
      Math.random() < tackleChance
    ) {
      input.tackle = true;
    }

    // Shooting / kicking
    if (hasBall) {
      const toGoal = len(goalX - me.x, goalY - me.y);
      const advancing =
        (me.side === "left" && me.x > PITCH_WIDTH * (0.55 - this.skill * 0.08)) ||
        (me.side === "right" && me.x < PITCH_WIDTH * (0.45 + this.skill * 0.08));

      const noise = (1 - this.skill) * (90 - this.skill * 20);
      const aimJitterY = (Math.random() - 0.5) * noise;
      // Aim toward a corner more as skill rises
      const corner =
        Math.random() > 0.5
          ? goalY - (40 + this.skill * 35)
          : goalY + (40 + this.skill * 35);
      input.aimX = goalX;
      input.aimY = clamp(corner + aimJitterY, 40, PITCH_HEIGHT - 40);

      const shouldShoot =
        advancing &&
        toGoal < 320 - this.skill * 40 &&
        Math.random() < 0.02 + this.skill * 0.05;

      if (shouldShoot || this.charge > 0) {
        this.chargeTarget = 0.35 + this.skill * 0.5 + Math.random() * 0.15;
        this.charge = Math.min(1, this.charge + (0.028 + this.skill * 0.025));
        input.charge = this.charge;
        if (this.charge >= this.chargeTarget) {
          input.shoot = true;
          // Bronze sometimes "misses release" as a soft kick instead
          if (this.skill < 0.35 && Math.random() > 0.55 + this.skill) {
            input.shoot = false;
            input.kick = true;
            input.charge = 0;
          }
          this.charge = 0;
          this.chargeTarget = 0;
        }
      } else if (
        Math.random() < 0.004 + this.skill * 0.01 &&
        toGoal < 380
      ) {
        input.kick = true;
        input.aimX = goalX;
        input.aimY = goalY + (Math.random() - 0.5) * noise;
      }
    } else {
      this.charge = 0;
      // Clear / poke loose ball upfield
      const distBall = len(sim.ball.x - me.x, sim.ball.y - me.y);
      if (
        distBall < PLAYER_RADIUS + BALL_RADIUS + 18 &&
        !sim.possessionId &&
        Math.random() < 0.04 + this.skill * 0.08
      ) {
        input.kick = true;
        input.aimX = me.x + outward * 200;
        input.aimY = me.y + (Math.random() - 0.5) * 80;
      }
    }

    return input;
  }

  private updatePenalties(sim: GameSim, me: SimPlayer): void {
    const pens = sim.penalties;
    if (!pens) {
      sim.setInput(this.playerId, emptyInput());
      return;
    }

    const input = emptyInput();
    const isShooter = pens.shooterSide === me.side;

    if (pens.status === "aiming") {
      if (isShooter) {
        if (this.penKickDelay <= 0) {
          this.penKickDelay = 0.6 + (1 - this.skill) * 1.8 + Math.random() * 0.8;
          // Choose a side once
          this.penDiveBias = Math.random() > 0.5 ? 1 : -1;
        }
        this.penKickDelay -= 1 / 60;
        const cornerY =
          PITCH_HEIGHT / 2 +
          this.penDiveBias * (55 + this.skill * 40) +
          (Math.random() - 0.5) * (1 - this.skill) * 70;
        if (cornerY < me.y - 8) input.up = true;
        if (cornerY > me.y + 8) input.down = true;
        if (this.penKickDelay <= 0) {
          input.kick = true;
          this.penKickDelay = 99;
        }
      } else {
        // Keeper: track phantom / random dive preparation
        if (this.penDiveBias === 0) {
          this.penDiveBias = Math.random() > 0.5 ? 1 : -1;
        }
        const guessY =
          PITCH_HEIGHT / 2 +
          this.penDiveBias * (30 + this.skill * 50) +
          (Math.random() - 0.5) * (1 - this.skill) * 90;
        if (guessY < me.y - 10) input.up = true;
        if (guessY > me.y + 10) input.down = true;
        // Prefire dive often for better AI
        if (Math.random() < 0.01 + this.skill * 0.025) {
          input.tackle = true;
          if (this.penDiveBias < 0) input.up = true;
          else input.down = true;
        }
      }
    } else if (pens.status === "inflight" && !isShooter) {
      if (sim.ball.y < me.y - 6) input.up = true;
      if (sim.ball.y > me.y + 6) input.down = true;
      if (!pens.diving && Math.random() < 0.08 + this.skill * 0.2) {
        input.tackle = true;
      }
    }

    if (pens.status !== "aiming") {
      this.penKickDelay = 0;
      if (pens.status === "ready" || pens.status === "result") {
        this.penDiveBias = 0;
      }
    }

    sim.setInput(this.playerId, input);
  }
}
