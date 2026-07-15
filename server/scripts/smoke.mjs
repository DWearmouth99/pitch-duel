/**
 * Headless smoke test: two WS clients queue, match, exchange state, leave.
 */
import WebSocket from "ws";

const WS_URL = process.env.WS_URL || "ws://localhost:3001/ws";
const API = process.env.API_URL || "http://localhost:3001";

function onceOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

function waitFor(ws, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout waiting for message"));
    }, timeoutMs);

    const onMsg = (raw) => {
      const msg = JSON.parse(String(raw));
      if (predicate(msg)) {
        cleanup();
        resolve(msg);
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMsg);
    };

    ws.on("message", onMsg);
  });
}

async function main() {
  const health = await fetch(`${API}/api/health`);
  if (!health.ok) throw new Error("Health check failed");

  const a = new WebSocket(WS_URL);
  const b = new WebSocket(WS_URL);
  await Promise.all([onceOpen(a), onceOpen(b)]);

  const nameA = `SmokeA_${Date.now().toString(36)}`;
  const nameB = `SmokeB_${Date.now().toString(36)}`;

  a.send(JSON.stringify({ type: "joinQueue", name: nameA }));
  await waitFor(a, (m) => m.type === "queueJoined");

  b.send(JSON.stringify({ type: "joinQueue", name: nameB }));

  const [matchA, matchB] = await Promise.all([
    waitFor(a, (m) => m.type === "matchFound"),
    waitFor(b, (m) => m.type === "matchFound"),
  ]);

  console.log("Matched:", matchA.side, "vs", matchB.side);

  const stateA = await waitFor(a, (m) => m.type === "state", 3000);
  console.log("Got state tick", stateA.tick);

  for (let i = 0; i < 10; i++) {
    a.send(
      JSON.stringify({
        type: "input",
        input: { up: false, down: false, left: false, right: true, kick: false },
      })
    );
    await new Promise((r) => setTimeout(r, 50));
  }

  const profileRes = await fetch(`${API}/api/player`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: nameA }),
  });
  const profile = await profileRes.json();
  console.log("Player profile created, ELO:", profile.profile.elo);

  const lb = await fetch(`${API}/api/leaderboard`);
  const lbJson = await lb.json();
  console.log("Leaderboard entries:", lbJson.entries.length);

  a.close();
  b.close();
  console.log("SMOKE OK");
}

main().catch((err) => {
  console.error("SMOKE FAILED", err);
  process.exit(1);
});
