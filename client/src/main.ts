import "./styles.css";
import { apiUrl } from "./config";
import { gameSocket } from "./net/socket";
import { InputController } from "./game/input";
import { PitchRenderer } from "./game/renderer";
import { UI } from "./ui/screens";
import type { ServerMessage, Side } from "./shared/protocol";

const TOKEN_KEY = "pitchDuelToken";

const app = document.querySelector("#app") as HTMLElement;
const ui = new UI(app);
const input = new InputController();

let renderer: PitchRenderer | null = null;
let mySide: Side | null = null;
let inputInterval: ReturnType<typeof setInterval> | null = null;
let token = localStorage.getItem(TOKEN_KEY) || "";
let sessionUser = "";

async function ensureConnected(): Promise<boolean> {
  try {
    if (!gameSocket.isOpen()) {
      await gameSocket.connect();
    }
    return true;
  } catch {
    ui.setPlayError("Cannot reach game server.");
    return false;
  }
}

function startMatchRendering(side: Side): void {
  stopMatchRendering();
  const canvas = ui.getCanvas();
  renderer = new PitchRenderer(canvas);
  renderer.setMySide(side);
  renderer.start();
  input.start();
  input.attachCanvas(canvas);
  inputInterval = setInterval(() => {
    const sample = input.sample();
    gameSocket.sendInput(sample);
    renderer?.setLocalAim(sample.aimX, sample.aimY, sample.charge);
  }, 1000 / 30);
}

function stopMatchRendering(): void {
  input.stop();
  if (inputInterval) {
    clearInterval(inputInterval);
    inputInterval = null;
  }
  renderer?.stop();
  renderer = null;
}

function saveToken(next: string): void {
  token = next;
  if (next) localStorage.setItem(TOKEN_KEY, next);
  else localStorage.removeItem(TOKEN_KEY);
}

async function refreshSession(): Promise<boolean> {
  if (!token) {
    sessionUser = "";
    ui.setSession(null);
    return false;
  }
  try {
    const res = await fetch(apiUrl(`/api/me?token=${encodeURIComponent(token)}`));
    if (!res.ok) {
      saveToken("");
      sessionUser = "";
      ui.setSession(null);
      return false;
    }
    const data = (await res.json()) as {
      profile: { name: string; elo: number };
    };
    sessionUser = data.profile.name;
    ui.setSession({ username: data.profile.name, elo: data.profile.elo });
    return true;
  } catch {
    return false;
  }
}

async function authRequest(
  path: "/api/login" | "/api/register",
  username: string,
  password: string
): Promise<void> {
  ui.setAccountError("");
  try {
    const res = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = (await res.json()) as {
      error?: string;
      token?: string;
      profile?: { name: string; elo: number };
    };
    if (!res.ok || !data.token || !data.profile) {
      ui.setAccountError(data.error || "Request failed");
      return;
    }
    saveToken(data.token);
    sessionUser = data.profile.name;
    ui.setSession({ username: data.profile.name, elo: data.profile.elo });
    ui.setAccountError("");
    ui.show("menu");
  } catch {
    ui.setAccountError("Cannot reach server");
  }
}

gameSocket.onMessage((msg: ServerMessage) => {
  switch (msg.type) {
    case "queueJoined":
      ui.setPlayError("");
      ui.setQueueElo(msg.elo, msg.name);
      ui.show("queue");
      break;

    case "queueLeft":
      ui.show("menu");
      break;

    case "matchFound":
      mySide = msg.side;
      ui.setupMatchHud({
        youName: msg.you.name,
        youElo: msg.you.elo,
        youSide: msg.side,
        oppName: msg.opponent.name,
        oppElo: msg.opponent.elo,
      });
      ui.show("match");
      startMatchRendering(msg.side);
      break;

    case "state":
      renderer?.pushState(msg);
      {
        let myRole: "shooter" | "keeper" | null = null;
        if (msg.phase === "penalties" && msg.penalties && mySide) {
          myRole =
            msg.penalties.shooterSide === mySide ? "shooter" : "keeper";
        }
        ui.updateHud(msg.score.left, msg.score.right, msg.timeLeftMs, {
          phase: msg.phase,
          countdownMs: msg.countdownMs,
          pens: msg.penalties?.pens ?? null,
          prompt: msg.penalties?.prompt,
          myRole,
          penaltyTimeLeftMs:
            msg.phase === "penalties" && msg.penalties?.status === "aiming"
              ? msg.penalties.timeLeftMs
              : undefined,
        });
      }
      break;

    case "matchEnd":
      stopMatchRendering();
      ui.showResults({
        scoreLeft: msg.score.left,
        scoreRight: msg.score.right,
        winner: msg.winner,
        yourSide: mySide ?? "left",
        youElo: msg.you.elo,
        youDelta: msg.you.delta,
        oppName: msg.opponent.name,
        decidedByPens: msg.decidedByPens,
        penaltyLeft: msg.penaltyScore?.left,
        penaltyRight: msg.penaltyScore?.right,
      });
      ui.setSession({ username: msg.you.name, elo: msg.you.elo });
      break;

    case "opponentDisconnected":
      break;

    case "error":
      ui.setPlayError(msg.message);
      break;
  }
});

ui.on({
  findMatch: async () => {
    if (!token) {
      ui.setAccountError("Create an account or log in first");
      ui.show("account");
      return;
    }
    ui.setPlayError("");
    if (!(await ensureConnected())) return;
    gameSocket.joinQueue(token);
  },
  cancelQueue: () => {
    gameSocket.leaveQueue();
    ui.show("menu");
  },
  playAgain: async () => {
    gameSocket.returnToLobby();
    if (!token) {
      ui.show("account");
      return;
    }
    if (!(await ensureConnected())) {
      ui.show("play");
      return;
    }
    gameSocket.joinQueue(token);
  },
  showLeaderboard: async () => {
    stopMatchRendering();
    gameSocket.returnToLobby();
    ui.show("leaderboard");
    await ui.renderLeaderboard();
  },
  backMenu: () => {
    stopMatchRendering();
    gameSocket.returnToLobby();
    ui.show("menu");
  },
  openRanks: () => {
    void refreshSession();
  },
  openPlay: async () => {
    const ok = await refreshSession();
    if (!ok) {
      ui.setAccountError("Log in to play");
      ui.show("account");
      return;
    }
    ui.show("play");
  },
  login: (username, password) => {
    void authRequest("/api/login", username, password);
  },
  register: (username, password) => {
    void authRequest("/api/register", username, password);
  },
  logout: async () => {
    try {
      await fetch(apiUrl("/api/logout"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
    } catch {
      /* ignore */
    }
    saveToken("");
    sessionUser = "";
    ui.setSession(null);
    ui.show("menu");
  },
});

void refreshSession();
void ensureConnected();

void sessionUser;
