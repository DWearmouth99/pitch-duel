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
import { rankingStore } from "../ranking.js";

export interface RoomPlayer {
  id: string;
  name: string;
  side: Side;
  ws: WebSocket;
  elo: number;
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
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

    for (const p of [left, right]) {
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

  private tick(): void {
    if (this.ended) return;
    this.sim.step();

    for (const p of this.players.values()) {
      send(p.ws, this.buildSnapshot(p.side));
    }

    if (this.sim.finished) {
      this.finishMatch();
    }
  }

  handleInput(playerId: string, input: PlayerInput): void {
    this.sim.setInput(playerId, input);
  }

  handleDisconnect(playerId: string): void {
    const disconnected = this.players.get(playerId);
    if (!disconnected) return;
    this.players.delete(playerId);

    if (this.ended) {
      if (this.players.size === 0) this.cleanup();
      return;
    }

    this.ended = true;
    this.stopInterval();

    const remaining = [...this.players.values()][0];
    if (remaining) {
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

      const youResult =
        remaining.side === "left" ? result.left : result.right;
      const oppResult =
        remaining.side === "left" ? result.right : result.left;

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
    }

    this.cleanup();
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

    const result = rankingStore.applyMatchResult(
      left.name,
      right.name,
      winner
    );

    const penaltyScore = this.sim.getPenaltyScore();
    const decidedByPens = this.sim.wasDecidedByPens();

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
    if (this.players.size === 0) this.cleanup();
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
