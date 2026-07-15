import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { matchmaking } from "./matchmaking.js";
import { rankingStore } from "./ranking.js";
import { DIVISIONS } from "./shared/ranks.js";

const PORT = Number(process.env.PORT) || 3001;
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = join(__dirname, "..", "..", "client", "dist");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/leaderboard", (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  res.json({ entries: rankingStore.getLeaderboard(limit) });
});

app.get("/api/ranks", (_req, res) => {
  res.json({ divisions: DIVISIONS });
});

app.post("/api/register", (req, res) => {
  const username = typeof req.body?.username === "string" ? req.body.username : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  try {
    const result = rankingStore.register(username, password);
    const rankInfo = rankingStore.getRank(result.profile.name);
    res.json({
      profile: result.profile,
      token: result.token,
      rank: rankInfo?.rank ?? 1,
      progress: rankInfo?.progress ?? null,
    });
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : "Could not create account",
    });
  }
});

app.post("/api/login", (req, res) => {
  const username = typeof req.body?.username === "string" ? req.body.username : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  try {
    const result = rankingStore.login(username, password);
    const rankInfo = rankingStore.getRank(result.profile.name);
    res.json({
      profile: result.profile,
      token: result.token,
      rank: rankInfo?.rank ?? 1,
      progress: rankInfo?.progress ?? null,
    });
  } catch (e) {
    res.status(401).json({
      error: e instanceof Error ? e.message : "Login failed",
    });
  }
});

app.post("/api/logout", (req, res) => {
  const token =
    typeof req.body?.token === "string"
      ? req.body.token
      : typeof req.headers.authorization === "string"
        ? req.headers.authorization.replace(/^Bearer\s+/i, "")
        : "";
  rankingStore.logout(token);
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  const token =
    typeof req.query.token === "string"
      ? req.query.token
      : typeof req.headers.authorization === "string"
        ? req.headers.authorization.replace(/^Bearer\s+/i, "")
        : "";
  const profile = rankingStore.getByToken(token);
  if (!profile) {
    res.status(401).json({ error: "Not logged in" });
    return;
  }
  const rankInfo = rankingStore.getRank(profile.name);
  res.json({
    profile,
    rank: rankInfo?.rank ?? 1,
    progress: rankInfo?.progress ?? null,
  });
});

app.get("/api/player/:name", (req, res) => {
  const result = rankingStore.getRank(req.params.name);
  if (!result) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  res.json(result);
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  matchmaking.handleConnection(ws);
});

if (existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get(/^(?!\/api)(?!\/ws).*/, (_req, res) => {
    res.sendFile(join(CLIENT_DIST, "index.html"));
  });
  console.log(`Serving client from ${CLIENT_DIST}`);
}

server.listen(PORT, () => {
  console.log(`Pitch Duel server listening on http://localhost:${PORT}`);
});
