/**
 * Direct GameSim checks for dribble/slide, keepers, and penalties.
 */
import { GameSim } from "../src/game/sim.ts";
import { PITCH_WIDTH, PITCH_HEIGHT } from "../src/shared/protocol.ts";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function len(x, y) {
  return Math.hypot(x, y);
}

function input(partial = {}) {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    kick: false,
    tackle: false,
    aimX: PITCH_WIDTH / 2,
    aimY: PITCH_HEIGHT / 2,
    charge: 0,
    shoot: false,
    emote: 0,
    ...partial,
  };
}

const left = { id: "L", name: "Lefty" };
const right = { id: "R", name: "Righty" };

function readySim() {
  const sim = new GameSim(left, right);
  sim.phase = "play";
  sim.countdownMs = 0;
  return sim;
}

// --- Countdown ---
{
  const sim = new GameSim(left, right);
  assert(sim.phase === "countdown", "match starts in countdown");
  for (let i = 0; i < 60 * 5 + 5; i++) sim.step();
  assert(sim.phase === "play", "countdown should reach play");
  console.log("OK countdown");
}

// --- Dribble acquire ---
{
  const sim = readySim();
  const p = sim.players[0];
  sim.ball.x = p.x + 20;
  sim.ball.y = p.y;
  sim.ball.vx = 0;
  sim.ball.vy = 0;
  for (let i = 0; i < 5; i++) sim.step();
  assert(sim.possessionId === p.id, "should acquire dribble possession");
  console.log("OK dribble");
}

// --- Slide tackle knocks ball loose (no auto possession) ---
{
  const sim = readySim();
  const a = sim.players[0];
  const b = sim.players[1];
  sim.possessionId = a.id;
  a.x = 400;
  a.y = 300;
  b.x = 360;
  b.y = 300;
  b.facingX = 1;
  b.facingY = 0;
  sim.ball.x = a.x + 20;
  sim.ball.y = a.y;

  sim.setInput(
    b.id,
    input({ tackle: true, aimX: a.x + 40, aimY: a.y })
  );

  let hit = false;
  for (let i = 0; i < 25; i++) {
    sim.step();
    sim.setInput(b.id, input({ aimX: a.x + 40, aimY: a.y }));
    if (sim.possessionId === null && len(sim.ball.vx, sim.ball.vy) > 40) {
      hit = true;
      break;
    }
  }
  assert(hit, "slide should knock ball loose");
  assert(sim.possessionId !== b.id, "tackler must not auto-claim possession");
  console.log("OK slide tackle");
}

// --- Mouse-powered shot ---
{
  const sim = readySim();
  const p = sim.players[0];
  sim.possessionId = p.id;
  p.x = 500;
  p.y = 300;
  sim.setInput(
    p.id,
    input({
      aimX: 900,
      aimY: 250,
      charge: 0.9,
      shoot: true,
    })
  );
  sim.step();
  assert(sim.possessionId === null, "shot releases possession");
  assert(sim.ball.vx > 400, "powered shot should go hard toward aim");
  console.log("OK powered shot", { vx: sim.ball.vx, vy: sim.ball.vy });
}

// --- Keeper pickup + short pass only when teammate is close ---
{
  const sim = readySim();
  // Teammate near the box so short pass is legal
  sim.players[0].x = 140;
  sim.players[0].y = PITCH_HEIGHT * 0.35;
  sim.players[1].x = PITCH_WIDTH * 0.75;
  sim.players[1].y = PITCH_HEIGHT * 0.8;
  const k = sim.keepers[0];
  k.x = 40;
  k.y = PITCH_HEIGHT / 2;
  sim.ball.x = 55;
  sim.ball.y = PITCH_HEIGHT / 2;
  sim.ball.vx = 0;
  sim.ball.vy = 0;

  let picked = false;
  let pickedAt = 0;
  for (let i = 0; i < 60; i++) {
    sim.step();
    if (sim.keeperPossession === "left") {
      picked = true;
      pickedAt = sim.tick;
      break;
    }
  }
  assert(picked, "keeper should pick up ball in box");

  let passedAt = 0;
  for (let i = 0; i < 120; i++) {
    sim.step();
    if (sim.keeperPossession === null) {
      passedAt = sim.tick;
      break;
    }
  }
  assert(passedAt > 0, "keeper should pass when teammate is close");
  assert(sim.ball.vx > 40, "left keeper pass must go upfield");
  console.log("OK keeper short pass", {
    vx: sim.ball.vx,
    holdTicks: passedAt - pickedAt,
  });
}

// --- Keeper will not feed enemy standing in the lane ---
{
  const sim = readySim();
  sim.players[0].x = 200;
  sim.players[0].y = PITCH_HEIGHT / 2;
  // Enemy between GK and teammate
  sim.players[1].x = 120;
  sim.players[1].y = PITCH_HEIGHT / 2;
  const k = sim.keepers[0];
  k.x = 40;
  k.y = PITCH_HEIGHT / 2;
  sim.ball.x = 50;
  sim.ball.y = PITCH_HEIGHT / 2;
  sim.ball.vx = 0;
  sim.ball.vy = 0;
  for (let i = 0; i < 40; i++) sim.step();
  assert(sim.keeperPossession === "left", "should hold");
  // Still holding after min hold because lane blocked (until max hold clearance)
  for (let i = 0; i < 30; i++) sim.step();
  assert(
    sim.keeperPossession === "left",
    "should keep holding while lane is blocked"
  );
  console.log("OK keeper holds when lane blocked");
}

// --- Shot that misses the keeper is not scooped from afar ---
{
  const sim = readySim();
  sim.players[0].x = 400;
  sim.players[1].x = 600;
  sim.keepers[0].x = 36;
  sim.keepers[0].y = 100; // off the shot line
  sim.ball.x = 80;
  sim.ball.y = PITCH_HEIGHT / 2;
  sim.ball.vx = -500;
  sim.ball.vy = 0;
  for (let i = 0; i < 8; i++) sim.step();
  assert(
    sim.keeperPossession !== "left",
    "keeper should not scoop a shot that misses them"
  );
  console.log("OK distant miss not scooped");
}

// --- Shot straight at keeper is saved ---
{
  const sim = readySim();
  sim.players[0].x = 500;
  sim.players[1].x = 700;
  const k = sim.keepers[0];
  k.x = 40;
  k.y = PITCH_HEIGHT / 2;
  sim.ball.x = 120;
  sim.ball.y = PITCH_HEIGHT / 2;
  sim.ball.vx = -900;
  sim.ball.vy = 0;
  let saved = false;
  for (let i = 0; i < 40; i++) {
    sim.step();
    if (sim.keeperPossession === "left") {
      saved = true;
      break;
    }
    if (sim.score.right > 0) break;
  }
  assert(saved, "shot straight at keeper must be saved");
  assert(sim.score.right === 0, "ball must not score through keeper");
  console.log("OK keeper body save");
}

// --- Penalties on draw ---
{
  const sim = readySim();
  sim.score.left = 1;
  sim.score.right = 1;
  sim.timeLeftMs = 0;
  sim.step();
  assert(sim.phase === "penalties", "draw should enter penalties");
  console.log("OK penalties start");
}

// --- Standing keeper saves a central penalty (no dive required) ---
{
  const sim = readySim();
  sim.score.left = 1;
  sim.score.right = 1;
  sim.timeLeftMs = 0;
  sim.step();
  assert(sim.phase === "penalties", "in pens");
  // Skip ready pause and get to aiming
  for (let i = 0; i < 90; i++) sim.step();
  assert(sim.penalties?.status === "aiming", "should be aiming");
  const shooter = sim.players[0];
  const keeper = sim.players[1];
  // Center the keeper and shoot straight
  keeper.y = PITCH_HEIGHT / 2;
  sim.setInput(shooter.id, input({ kick: true }));
  sim.step();
  assert(sim.penalties?.status === "inflight", "shot in flight");
  let saved = false;
  for (let i = 0; i < 120; i++) {
    sim.step();
    if (sim.penalties?.prompt === "Saved!") {
      saved = true;
      break;
    }
    if (sim.penalties?.prompt === "Goal!") break;
  }
  assert(saved, "standing keeper must save a central penalty");
  console.log("OK penalty standing save");
}

// --- Mercy rule ends at +5 goals ---
{
  const sim = readySim();
  sim.score.left = 5;
  sim.score.right = 0;
  sim.step();
  assert(sim.finished, "5-goal lead should end the match");
  assert(sim.getWinner() === "left", "leader wins on mercy");
  console.log("OK mercy rule");
}

// --- Own-box camping forces a clear; foe can enter to contest ---
{
  const sim = readySim();
  const left = sim.players[0];
  const right = sim.players[1];

  // Contest access while camping
  left.x = 40;
  left.y = PITCH_HEIGHT / 2;
  sim.possessionId = left.id;
  sim.ball.x = left.x + 16;
  sim.ball.y = left.y;
  right.x = 200;
  right.y = PITCH_HEIGHT / 2;
  for (let i = 0; i < 50; i++) {
    sim.setInput(right.id, input({ left: true }));
    sim.setInput(left.id, input());
    sim.step();
  }
  assert(right.x < 110, "attacker can enter box while holder camps there");

  // Forced clear after lingering in own box
  const sim2 = readySim();
  const camper = sim2.players[0];
  const other = sim2.players[1];
  other.x = 800;
  other.y = 80;
  camper.x = 36;
  camper.y = PITCH_HEIGHT / 2;
  sim2.possessionId = camper.id;
  sim2.ball.x = camper.x + 16;
  sim2.ball.y = camper.y;
  let cleared = false;
  for (let i = 0; i < 90; i++) {
    sim2.setInput(camper.id, input());
    sim2.setInput(other.id, input());
    camper.x = 36;
    camper.y = PITCH_HEIGHT / 2;
    sim2.step();
    if (sim2.possessionId === null) {
      cleared = true;
      break;
    }
  }
  assert(cleared, "camping in own box must force a clear");
  assert(sim2.ball.vx > 40, "forced clear should send ball upfield");
  console.log("OK own-box anti-camp");
}

// --- Slide faces move direction ---
{
  const sim = readySim();
  const b = sim.players[1];
  b.x = 400;
  b.y = 300;
  b.facingX = 0;
  b.facingY = -1;
  sim.setInput(b.id, input({ up: true, tackle: true }));
  sim.step();
  assert(b.slideTimer > 0, "should start slide");
  assert(Math.abs(b.slideDirY + 1) < 0.2, "slide should follow facing/up");
  assert(Math.abs(b.slideDirX) < 0.35, "slide should not use mouse randomly");
  console.log("OK slide facing");
}

console.log("ALL MECHANIC CHECKS OK");
