import type WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import { rankingStore } from "./ranking.js";
import { GameRoom, type RoomPlayer } from "./game/room.js";
import { aiOpponentFor } from "./game/ai.js";
import type { ClientMessage, ServerMessage } from "./shared/protocol.js";

/** Wait this long alone in queue before matching an AI. */
const AI_FALLBACK_MS = 5_000;

interface QueuedPlayer {
  id: string;
  name: string;
  elo: number;
  ws: WebSocket;
  aiTimer: ReturnType<typeof setTimeout> | null;
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export class Matchmaking {
  private queue: QueuedPlayer[] = [];
  private rooms = new Map<string, GameRoom>();
  private wsToPlayerId = new Map<WebSocket, string>();
  private playerToRoom = new Map<string, string>();

  handleConnection(ws: WebSocket): void {
    const playerId = uuidv4();
    this.wsToPlayerId.set(ws, playerId);

    ws.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        send(ws, { type: "error", message: "Invalid message" });
        return;
      }
      this.handleMessage(ws, playerId, msg);
    });

    ws.on("close", () => this.handleDisconnect(ws, playerId));
  }

  private handleMessage(
    ws: WebSocket,
    playerId: string,
    msg: ClientMessage
  ): void {
    switch (msg.type) {
      case "joinQueue":
        this.joinQueue(ws, playerId, msg.token);
        break;
      case "leaveQueue":
        this.leaveQueue(playerId);
        send(ws, { type: "queueLeft" });
        break;
      case "input": {
        const roomId = this.playerToRoom.get(playerId);
        if (!roomId) return;
        const room = this.rooms.get(roomId);
        room?.handleInput(playerId, msg.input);
        break;
      }
      case "returnToLobby": {
        const roomId = this.playerToRoom.get(playerId);
        if (roomId) {
          const room = this.rooms.get(roomId);
          room?.removePlayer(playerId);
          this.playerToRoom.delete(playerId);
        }
        break;
      }
      default:
        send(ws, { type: "error", message: "Unknown message type" });
    }
  }

  private joinQueue(ws: WebSocket, playerId: string, token: string): void {
    const profile = rankingStore.getByToken(token);
    if (!profile) {
      send(ws, { type: "error", message: "Log in to play" });
      return;
    }

    const existingRoom = this.playerToRoom.get(playerId);
    if (existingRoom) {
      if (this.rooms.has(existingRoom)) {
        send(ws, { type: "error", message: "Already in a match" });
        return;
      }
      this.playerToRoom.delete(playerId);
    }

    if (this.queue.some((q) => q.id === playerId)) {
      return;
    }

    if (
      this.queue.some(
        (q) => q.name.toLowerCase() === profile.name.toLowerCase()
      )
    ) {
      send(ws, {
        type: "error",
        message: "That account is already waiting in queue",
      });
      return;
    }

    const entry: QueuedPlayer = {
      id: playerId,
      name: profile.name,
      elo: profile.elo,
      ws,
      aiTimer: null,
    };

    this.queue.push(entry);

    send(ws, {
      type: "queueJoined",
      name: profile.name,
      elo: profile.elo,
    });

    this.tryMatch();

    // If still alone after the wait, fight an AI of similar rank
    if (this.queue.some((q) => q.id === playerId)) {
      entry.aiTimer = setTimeout(() => {
        this.matchWithAi(playerId);
      }, AI_FALLBACK_MS);
    }
  }

  private clearAiTimer(entry: QueuedPlayer): void {
    if (entry.aiTimer) {
      clearTimeout(entry.aiTimer);
      entry.aiTimer = null;
    }
  }

  private leaveQueue(playerId: string): void {
    const entry = this.queue.find((q) => q.id === playerId);
    if (entry) this.clearAiTimer(entry);
    this.queue = this.queue.filter((q) => q.id !== playerId);
  }

  private tryMatch(): void {
    while (this.queue.length >= 2) {
      const a = this.queue.shift()!;
      const b = this.queue.shift()!;
      this.clearAiTimer(a);
      this.clearAiTimer(b);
      this.startRoom(a, b);
    }
  }

  private matchWithAi(playerId: string): void {
    const idx = this.queue.findIndex((q) => q.id === playerId);
    if (idx < 0) return;
    // Someone else may have joined — prefer human
    if (this.queue.length >= 2) {
      this.tryMatch();
      return;
    }

    const human = this.queue.splice(idx, 1)[0];
    this.clearAiTimer(human);

    const aiInfo = aiOpponentFor(human.elo);
    const humanSide = Math.random() < 0.5 ? "left" : "right";
    const aiSide = humanSide === "left" ? "right" : "left";

    const humanPlayer: RoomPlayer = {
      id: human.id,
      name: human.name,
      side: humanSide,
      ws: human.ws,
      elo: human.elo,
    };
    const aiPlayer: RoomPlayer = {
      id: uuidv4(),
      name: aiInfo.name,
      side: aiSide,
      ws: null,
      elo: aiInfo.elo,
      isAi: true,
    };

    const left = humanSide === "left" ? humanPlayer : aiPlayer;
    const right = humanSide === "left" ? aiPlayer : humanPlayer;

    const room = new GameRoom(left, right, (roomId) => {
      this.rooms.delete(roomId);
    });

    this.rooms.set(room.id, room);
    this.playerToRoom.set(human.id, room.id);
  }

  private startRoom(a: QueuedPlayer, b: QueuedPlayer): void {
    const left: RoomPlayer = {
      id: a.id,
      name: a.name,
      side: "left",
      ws: a.ws,
      elo: a.elo,
    };
    const right: RoomPlayer = {
      id: b.id,
      name: b.name,
      side: "right",
      ws: b.ws,
      elo: b.elo,
    };

    const room = new GameRoom(left, right, (roomId) => {
      this.rooms.delete(roomId);
    });

    this.rooms.set(room.id, room);
    this.playerToRoom.set(a.id, room.id);
    this.playerToRoom.set(b.id, room.id);
  }

  private handleDisconnect(ws: WebSocket, playerId: string): void {
    this.leaveQueue(playerId);
    this.wsToPlayerId.delete(ws);

    const roomId = this.playerToRoom.get(playerId);
    if (roomId) {
      const room = this.rooms.get(roomId);
      room?.handleDisconnect(playerId);
      this.playerToRoom.delete(playerId);
    }
  }
}

export const matchmaking = new Matchmaking();
