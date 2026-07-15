import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { LeaderboardEntry, PlayerProfile } from "./shared/protocol.js";
import { rankProgress, type RankProgress } from "./shared/ranks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", ".data");
const DB_PATH = join(DATA_DIR, "rankings.json");

const DEFAULT_ELO = 1000;
const K_FACTOR = 32;

interface StoredAccount extends PlayerProfile {
  passwordHash: string;
}

interface DbShape {
  players: Record<string, StoredAccount>;
  /** token → username key */
  sessions: Record<string, string>;
}

function normalizeName(name: string): string {
  return name.trim().slice(0, 20);
}

function keyFor(name: string): string {
  return normalizeName(name).toLowerCase();
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  try {
    const next = scryptSync(password, salt, 32);
    const prev = Buffer.from(hash, "hex");
    if (prev.length !== next.length) return false;
    return timingSafeEqual(prev, next);
  } catch {
    return false;
  }
}

function publicProfile(account: StoredAccount): PlayerProfile {
  return {
    name: account.name,
    elo: account.elo,
    wins: account.wins,
    losses: account.losses,
    draws: account.draws,
  };
}

function newToken(): string {
  return randomBytes(24).toString("hex");
}

export class RankingStore {
  private db: DbShape = { players: {}, sessions: {} };

  constructor() {
    mkdirSync(DATA_DIR, { recursive: true });
    this.load();
  }

  private load(): void {
    if (!existsSync(DB_PATH)) {
      this.save();
      return;
    }
    try {
      const raw = readFileSync(DB_PATH, "utf8");
      const parsed = JSON.parse(raw) as Partial<DbShape>;
      this.db = {
        players: parsed.players ?? {},
        sessions: parsed.sessions ?? {},
      };
    } catch {
      this.db = { players: {}, sessions: {} };
      this.save();
    }
  }

  private save(): void {
    writeFileSync(DB_PATH, JSON.stringify(this.db, null, 2), "utf8");
  }

  private issueSession(usernameKey: string): string {
    // Drop old sessions for this user to keep the file small
    for (const [tok, key] of Object.entries(this.db.sessions)) {
      if (key === usernameKey) delete this.db.sessions[tok];
    }
    const token = newToken();
    this.db.sessions[token] = usernameKey;
    this.save();
    return token;
  }

  register(
    username: string,
    password: string
  ): { profile: PlayerProfile; token: string } {
    const display = normalizeName(username);
    if (!display) throw new Error("Username is required");
    if (!/^[a-zA-Z0-9_\- ]{2,20}$/.test(display)) {
      throw new Error("Username: 2–20 letters, numbers, spaces, _ or -");
    }
    if (typeof password !== "string" || password.length < 3) {
      throw new Error("Password must be at least 3 characters");
    }
    if (password.length > 64) {
      throw new Error("Password is too long");
    }

    const key = keyFor(display);
    if (this.db.players[key]) {
      throw new Error("Username already taken");
    }

    const account: StoredAccount = {
      name: display,
      elo: DEFAULT_ELO,
      wins: 0,
      losses: 0,
      draws: 0,
      passwordHash: hashPassword(password),
    };
    this.db.players[key] = account;
    const token = this.issueSession(key);
    return { profile: publicProfile(account), token };
  }

  login(
    username: string,
    password: string
  ): { profile: PlayerProfile; token: string } {
    const key = keyFor(username);
    const account = this.db.players[key];
    if (!account || !verifyPassword(password, account.passwordHash)) {
      throw new Error("Invalid username or password");
    }
    const token = this.issueSession(key);
    return { profile: publicProfile(account), token };
  }

  getByToken(token: string): PlayerProfile | null {
    if (!token) return null;
    const key = this.db.sessions[token];
    if (!key) return null;
    const account = this.db.players[key];
    if (!account) return null;
    return publicProfile(account);
  }

  logout(token: string): void {
    if (token && this.db.sessions[token]) {
      delete this.db.sessions[token];
      this.save();
    }
  }

  /** Used for match result updates — account must already exist. */
  getOrCreate(name: string): PlayerProfile {
    const display = normalizeName(name);
    if (!display) throw new Error("Name is required");
    const key = keyFor(display);
    const profile = this.db.players[key];
    if (!profile) {
      throw new Error("Account not found — log in first");
    }
    return publicProfile(profile);
  }

  getAccount(name: string): StoredAccount | null {
    return this.db.players[keyFor(name)] ?? null;
  }

  getLeaderboard(limit = 20): (LeaderboardEntry & { divisionLabel: string })[] {
    return Object.values(this.db.players)
      .map(publicProfile)
      .sort((a, b) => b.elo - a.elo || a.name.localeCompare(b.name))
      .slice(0, limit)
      .map((p) => ({
        ...p,
        divisionLabel: rankProgress(p.elo).division.label,
      }));
  }

  getRank(name: string): {
    rank: number;
    profile: PlayerProfile;
    progress: RankProgress;
  } | null {
    const key = keyFor(name);
    const account = this.db.players[key];
    if (!account) return null;
    const sorted = Object.values(this.db.players)
      .map(publicProfile)
      .sort((a, b) => b.elo - a.elo || a.name.localeCompare(b.name));
    const rank = sorted.findIndex((p) => keyFor(p.name) === key) + 1;
    return {
      rank,
      profile: publicProfile(account),
      progress: rankProgress(account.elo),
    };
  }

  applyMatchResult(
    leftName: string,
    rightName: string,
    winner: "left" | "right" | "draw"
  ): {
    left: PlayerProfile & { delta: number };
    right: PlayerProfile & { delta: number };
  } {
    const leftKey = keyFor(leftName);
    const rightKey = keyFor(rightName);
    const left = this.db.players[leftKey];
    const right = this.db.players[rightKey];
    if (!left || !right) {
      throw new Error("Both players need accounts");
    }

    const expectedLeft =
      1 / (1 + Math.pow(10, (right.elo - left.elo) / 400));
    const expectedRight = 1 - expectedLeft;

    let scoreLeft = 0.5;
    let scoreRight = 0.5;
    if (winner === "left") {
      scoreLeft = 1;
      scoreRight = 0;
      left.wins += 1;
      right.losses += 1;
    } else if (winner === "right") {
      scoreLeft = 0;
      scoreRight = 1;
      right.wins += 1;
      left.losses += 1;
    } else {
      left.draws += 1;
      right.draws += 1;
    }

    const deltaLeft = Math.round(K_FACTOR * (scoreLeft - expectedLeft));
    const deltaRight = Math.round(K_FACTOR * (scoreRight - expectedRight));

    left.elo = Math.max(100, left.elo + deltaLeft);
    right.elo = Math.max(100, right.elo + deltaRight);

    this.db.players[leftKey] = left;
    this.db.players[rightKey] = right;
    this.save();

    return {
      left: { ...publicProfile(left), delta: deltaLeft },
      right: { ...publicProfile(right), delta: deltaRight },
    };
  }

  /**
   * Update a human player's ELO after a match vs AI (AI is not stored).
   */
  applyVsAi(
    humanName: string,
    aiElo: number,
    outcome: "win" | "loss" | "draw"
  ): PlayerProfile & { delta: number } {
    const key = keyFor(humanName);
    const human = this.db.players[key];
    if (!human) throw new Error("Account not found");

    const expected =
      1 / (1 + Math.pow(10, (aiElo - human.elo) / 400));
    let score = 0.5;
    if (outcome === "win") {
      score = 1;
      human.wins += 1;
    } else if (outcome === "loss") {
      score = 0;
      human.losses += 1;
    } else {
      human.draws += 1;
    }

    const delta = Math.round(K_FACTOR * (score - expected));
    human.elo = Math.max(100, human.elo + delta);
    this.db.players[key] = human;
    this.save();
    return { ...publicProfile(human), delta };
  }
}

export const rankingStore = new RankingStore();
