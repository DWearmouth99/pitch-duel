import type WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import {
  TICK_RATE,
  type ClientMessage,
  type PlayerInput,
  type ServerMessage,
  type Side,
} from "../shared/protocol.js";
import { GameSim } from "./sim.js";
import { AiController } from "./ai.js";
import { rankingStore } from "../ranking.js";

export interface RoomPlayer {
  id: string;
  name: string;
  side: Side;
  /** null for AI opponents */
  ws: WebSocket | null;
  elo: number;
  isAi?: boolean;
}

/** Simulate at 60Hz, broadcast ~20Hz to cut bandwidth / lag on hosted deploys. */
const SNAPSHOT_EVERY = 3;

function send(ws: WebSocket | null, msg: ServerMessage): void {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export class GameRoom {
  readonly id: string;
  private players: Map<string, RoomPlayer> = new Map();
  private sim: GameSim;
  private interval: ReturnType<typeof setInterval> | null = null;
  private ended = false;
  private onEmpty: (roomId: string) => void;
  private ai: AiController | null = null;
  private tickCount = 0;
  private lastSentPhase = "";
  private lastSentScore = { left: -1, right: -1 };

  constructor(
    left: RoomPlayer,
    right: RoomPlayer,
    onEmpty: (roomId: string) => void
  ) {
    this.id = uuidv4();
    this.onEmpty = onEmpty;
    this.players.set(left.id, left);
    this.players.set(right.id, right);
    this.sim = new GameSim(
      { id: left.id, name: left.name },
      { id: right.id, name: right.name }
    );

    const aiPlayer = left.isAi ? left : right.isAi ? right : null;
    if (aiPlayer) {
      this.ai = new AiController(
        aiPlayer.id,
        Math.max(0, Math.min(1, (aiPlayer.elo - 750) / 1650))
      );
    }

    for (const p of [left, right]) {
      if (!p.ws) continue;
      const opp = p.side === "left" ? right : left;
      send(p.ws, {
        type: "matchFound",
        roomId: this.id,
        side: p.side,
        you: { id: p.id, name: p.name, elo: p.elo },
        opponent: { id: opp.id, name: opp.name, elo: opp.elo },
      });
    }

    this.start();
  }

  private start(): void {
    this.interval = setInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  private buildSnapshot(viewerSide: Side): ServerMessage {
    return {
      type: "state",
      tick: this.sim.tick,
      timeLeftMs: this.sim.timeLeftMs,
      countdownMs: this.sim.countdownMs,
      phase: this.sim.phase,
      score: { ...this.sim.score },
      ball: { ...this.sim.ball },
      players: this.sim.snapshotPlayers(),
      keepers: this.sim.snapshotKeepers(),
      possessionId: this.sim.possessionId,
      keeperPossession: this.sim.keeperPossession,
      penalties: this.sim.snapshotPenalties(viewerSide),
      banner: this.sim.banner,
    };
  }

  private shouldBroadcast(): boolean {
    this.tickCount += 1;
    const scoreChanged =
      this.sim.score.left !== this.lastSentScore.left ||
      this.sim.score.right !== this.lastSentScore.right;
    const phaseChanged = this.sim.phase !== this.lastSentPhase;
    const due = this.tickCount % SNAPSHOT_EVERY === 0;
    if (scoreChanged || phaseChanged || due || this.sim.finished) {
      this.lastSentScore = { ...this.sim.score };
      this.lastSentPhase = this.sim.phase;
      return true;
    }
    return false;
  }

  private tick(): void {
    if (this.ended) return;
    this.ai?.update(this.sim);
    this.sim.step();

    if (this.shouldBroadcast()) {
      for (const p of this.players.values()) {
        if (!p.ws) continue;
        send(p.ws, this.buildSnapshot(p.side));
      }
    }

    if (this.sim.finished) {
      this.finishMatch();
    }
  }

  handleInput(playerId: string, input: PlayerInput): void {
    const p = this.players.get(playerId);
    if (!p || p.isAi) return;
    this.sim.setInput(playerId, input);
  }

  handleDisconnect(playerId: string): void {
    const disconnected = this.players.get(playerId);
    if (!disconnected) return;
    this.players.delete(playerId);

    if (this.ended) {
      if (this.humanCount() === 0) this.cleanup();
      return;
    }

    // Human left an AI match → award win to the leaver's opponent (AI), human loses
    const remaining = [...this.players.values()][0];
    if (disconnected.isAi) {
      // Shouldn't happen
      this.cleanup();
      return;
    }

    this.ended = true;
    this.stopInterval();

    if (!remaining) {
      this.cleanup();
      return;
    }

    if (remaining.isAi) {
      // Human disconnected vs AI → loss
      try {
        const you = rankingStore.applyVsAi(
          disconnected.name,
          remaining.elo,
          "loss"
        );
        // Can't notify disconnected client reliably
        void you;
      } catch {
        /* ignore */
      }
      this.cleanup();
      return;
    }

    // PvP: remaining human wins
    const winnerSide = remaining.side;
    const leftName =
      remaining.side === "left" ? remaining.name : disconnected.name;
    const rightName =
      remaining.side === "right" ? remaining.name : disconnected.name;

    const result = rankingStore.applyMatchResult(
      leftName,
      rightName,
      winnerSide
    );

    send(remaining.ws, {
      type: "opponentDisconnected",
      score: { ...this.sim.score },
    });

    const youResult = remaining.side === "left" ? result.left : result.right;
    const oppResult = remaining.side === "left" ? result.right : result.left;

    send(remaining.ws, {
      type: "matchEnd",
      score: { ...this.sim.score },
      penaltyScore: this.sim.getPenaltyScore(),
      winner: winnerSide,
      decidedByPens: this.sim.wasDecidedByPens(),
      you: {
        name: youResult.name,
        elo: youResult.elo,
        delta: youResult.delta,
      },
      opponent: {
        name: oppResult.name,
        elo: oppResult.elo,
        delta: oppResult.delta,
      },
    });

    this.cleanup();
  }

  private humanCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (!p.isAi) n += 1;
    return n;
  }

  private finishMatch(): void {
    if (this.ended) return;
    this.ended = true;
    this.stopInterval();

    const winner = this.sim.getWinner();
    const left = [...this.players.values()].find((p) => p.side === "left");
    const right = [...this.players.values()].find((p) => p.side === "right");
    if (!left || !right) {
      this.cleanup();
      return;
    }

    const penaltyScore = this.sim.getPenaltyScore();
    const decidedByPens = this.sim.wasDecidedByPens();

    if (left.isAi || right.isAi) {
      const human = left.isAi ? right : left;
      const ai = left.isAi ? left : right;
      let outcome: "win" | "loss" | "draw" = "draw";
      if (winner === human.side) outcome = "win";
      else if (winner === ai.side) outcome = "loss";

      const you = rankingStore.applyVsAi(human.name, ai.elo, outcome);
      send(human.ws, {
        type: "matchEnd",
        score: { ...this.sim.score },
        penaltyScore,
        winner,
        decidedByPens,
        you: { name: you.name, elo: you.elo, delta: you.delta },
        opponent: { name: ai.name, elo: ai.elo, delta: -you.delta },
      });
      setTimeout(() => this.cleanup(), 500);
      return;
    }

    const result = rankingStore.applyMatchResult(
      left.name,
      right.name,
      winner
    );

    for (const p of this.players.values()) {
      const you = p.side === "left" ? result.left : result.right;
      const opp = p.side === "left" ? result.right : result.left;
      send(p.ws, {
        type: "matchEnd",
        score: { ...this.sim.score },
        penaltyScore,
        winner,
        decidedByPens,
        you: { name: you.name, elo: you.elo, delta: you.delta },
        opponent: { name: opp.name, elo: opp.elo, delta: opp.delta },
      });
    }

    setTimeout(() => this.cleanup(), 500);
  }

  removePlayer(playerId: string): void {
    this.players.delete(playerId);
    if (this.humanCount() === 0) this.cleanup();
  }

  private stopInterval(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private cleanup(): void {
    this.stopInterval();
    this.onEmpty(this.id);
  }
}

export type { ClientMessage };
