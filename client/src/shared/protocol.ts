/** Mirrored shared constants/types for the browser client. */

export const PITCH_WIDTH = 1000;
export const PITCH_HEIGHT = 600;
export const GOAL_WIDTH = 168;
export const PLAYER_RADIUS = 18;
export const KEEPER_RADIUS = 16;
export const BALL_RADIUS = 10;
export const MATCH_DURATION_MS = 120_000;
export const KICKOFF_COUNTDOWN_MS = 5_000;

export type Side = "left" | "right";
export type MatchPhase = "countdown" | "play" | "penalties";
export type EmoteId = "cheer" | "fire" | "shock" | "gg" | null;

export interface PlayerInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  kick: boolean;
  tackle: boolean;
  aimX: number;
  aimY: number;
  charge: number;
  shoot: boolean;
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
  taken: ScoreState;
  pens: ScoreState;
  round: number;
  status: "ready" | "aiming" | "inflight" | "result";
  prompt: string;
  aimX: number;
  aimY: number;
  diving: boolean;
  diveX: number;
  diveY: number;
  timeLeftMs: number;
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
  keeperPossession: Side | null;
  penalties: PenaltyState | null;
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
