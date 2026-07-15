import type { ClientMessage, PlayerInput, ServerMessage } from "../shared/protocol";

type MessageHandler = (msg: ServerMessage) => void;

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

export class GameSocket {
  private ws: WebSocket | null = null;
  private handler: MessageHandler | null = null;

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      const ws = new WebSocket(wsUrl());
      this.ws = ws;

      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("WebSocket connection failed"));
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as ServerMessage;
          this.handler?.(msg);
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        this.ws = null;
      };
    });
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  joinQueue(token: string): void {
    this.send({ type: "joinQueue", token });
  }

  leaveQueue(): void {
    this.send({ type: "leaveQueue" });
  }

  sendInput(input: PlayerInput): void {
    this.send({ type: "input", input });
  }

  returnToLobby(): void {
    this.send({ type: "returnToLobby" });
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const gameSocket = new GameSocket();
