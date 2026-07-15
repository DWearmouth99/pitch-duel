/** Shared pitch dimensions (world units). */
export const PITCH_WIDTH = 1000;
export const PITCH_HEIGHT = 600;
export const GOAL_WIDTH = 168;
export const GOAL_DEPTH = 24;
export const PLAYER_RADIUS = 18;
export const KEEPER_RADIUS = 16;
export const BALL_RADIUS = 10;
export const MATCH_DURATION_MS = 120_000;
export const KICKOFF_COUNTDOWN_MS = 5_000;
export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;
export const PENALTY_ROUNDS = 5;

export type Side = "left" | "right";
export type MatchPhase = "countdown" | "play" | "penalties";
export type EmoteId = "cheer" | "fire" | "shock" | "gg" | null;

export interface Vec2 {
  x: number;
  y: number;
}

export interface PlayerInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  /** Space quick-kick (uses facing / aim). */
  kick: boolean;
  /** Start a slide tackle (E). Also dive in penalties. */
  tackle: boolean;
  /** World-space aim point (mouse). */
  aimX: number;
  aimY: number;
  /** Hold-to-power charge 0–1. */
  charge: number;
  /** True on the frame the mouse button is released to shoot. */
  shoot: boolean;
  /** Emote press this frame (1–4), or 0. */
  emote: number;
}

export interface PlayerState {
  id: string;
  name: string;
  side: Side;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facingX: number;
  facingY: number;
  hasBall: boolean;
  stunned: boolean;
  sliding: boolean;
  charge: number;
  emote: EmoteId;
}

export interface KeeperState {
  side: Side;
  x: number;
  y: number;
  hasBall: boolean;
}

export interface BallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface ScoreState {
  left: number;
  right: number;
}

export interface PenaltyState {
  active: boolean;
  shooterSide: Side;
  /** Kicks attempted by each side (completed). */
  taken: ScoreState;
  /** Goals scored in the shootout. */
  pens: ScoreState;
  round: number;
  status: "ready" | "aiming" | "inflight" | "result";
  /** UI prompt for current role. */
  prompt: string;
  /** Aim vector — only meaningful for the shooter client. */
  aimX: number;
  aimY: number;
  diving: boolean;
  diveX: number;
  diveY: number;
  /** Remaining time to take the kick while aiming (ms). */
  timeLeftMs: number;
  /** True if this snapshot includes your private aim for drawing. */
  showAim: boolean;
}

export interface GameSnapshot {
  type: "state";
  tick: number;
  timeLeftMs: number;
  countdownMs: number;
  phase: MatchPhase;
  score: ScoreState;
  ball: BallState;
  players: PlayerState[];
  keepers: KeeperState[];
  possessionId: string | null;
  /** Keeper side holding ball, if any. */
  keeperPossession: Side | null;
  penalties: PenaltyState | null;
  /** Brief banner after a goal, e.g. "GOAL!". */
  banner: string | null;
}

export type ClientMessage =
  | { type: "joinQueue"; token: string }
  | { type: "leaveQueue" }
  | { type: "input"; input: PlayerInput }
  | { type: "returnToLobby" };

export type ServerMessage =
  | { type: "queueJoined"; name: string; elo: number }
  | { type: "queueLeft" }
  | {
      type: "matchFound";
      roomId: string;
      side: Side;
      you: { id: string; name: string; elo: number };
      opponent: { id: string; name: string; elo: number };
    }
  | GameSnapshot
  | {
      type: "matchEnd";
      score: ScoreState;
      penaltyScore: ScoreState | null;
      winner: Side;
      decidedByPens: boolean;
      you: { name: string; elo: number; delta: number };
      opponent: { name: string; elo: number; delta: number };
    }
  | { type: "opponentDisconnected"; score: ScoreState }
  | { type: "error"; message: string };

export interface LeaderboardEntry {
  name: string;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  divisionLabel?: string;
}

export interface PlayerProfile {
  name: string;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
}
