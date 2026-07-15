import {
  BALL_RADIUS,
  GOAL_WIDTH,
  KEEPER_RADIUS,
  PITCH_HEIGHT,
  PITCH_WIDTH,
  PLAYER_RADIUS,
  type BallState,
  type EmoteId,
  type GameSnapshot,
  type KeeperState,
  type PlayerState,
  type Side,
} from "../shared/protocol";

const INTERP_DELAY_MS = 90;

const EMOTE_LABEL: Record<Exclude<EmoteId, null>, string> = {
  cheer: "🎉",
  fire: "🔥",
  shock: "😱",
  gg: "GG!",
};

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export class PitchRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private latest: GameSnapshot | null = null;
  private prev: GameSnapshot | null = null;
  private receivedAt = 0;
  private mySide: Side | null = null;
  private raf = 0;
  private localAimX = PITCH_WIDTH / 2;
  private localAimY = PITCH_HEIGHT / 2;
  private localCharge = 0;
  private particles: Particle[] = [];
  private lastScore = { left: 0, right: 0 };
  private lastBanner: string | null = null;
  private animT = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D not available");
    this.ctx = ctx;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  setMySide(side: Side): void {
    this.mySide = side;
  }

  setLocalAim(x: number, y: number, charge: number): void {
    this.localAimX = x;
    this.localAimY = y;
    this.localCharge = charge;
  }

  pushState(state: GameSnapshot): void {
    if (
      state.score.left !== this.lastScore.left ||
      state.score.right !== this.lastScore.right
    ) {
      this.burst(
        state.ball.x,
        state.ball.y,
        36,
        ["#d4a84b", "#fff8e7", "#7eb6ff", "#ff6b4a"]
      );
      this.lastScore = { ...state.score };
    }
    if (state.banner && state.banner !== this.lastBanner) {
      this.burst(PITCH_WIDTH / 2, PITCH_HEIGHT / 2, 28, [
        "#d4a84b",
        "#9dffb0",
        "#fff",
      ]);
    }
    this.lastBanner = state.banner;
    this.prev = this.latest;
    this.latest = state;
    this.receivedAt = performance.now();
  }

  start(): void {
    const loop = () => {
      this.animT += 1 / 60;
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  private burst(
    x: number,
    y: number,
    count: number,
    colors: string[]
  ): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 180;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.6 + Math.random() * 0.7,
        maxLife: 1,
        color: colors[i % colors.length],
        size: 2 + Math.random() * 3,
      });
    }
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    const maxW = parent?.clientWidth ?? window.innerWidth;
    const maxH = Math.min(window.innerHeight * 0.72, 640);
    const aspect = PITCH_WIDTH / PITCH_HEIGHT;
    let w = maxW;
    let h = w / aspect;
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private getInterpolated(): GameSnapshot | null {
    if (!this.latest) return null;
    if (!this.prev) return this.latest;
    const now = performance.now();
    const elapsed = now - this.receivedAt;
    const t = Math.min(1, elapsed / INTERP_DELAY_MS);
    return lerpSnapshot(this.prev, this.latest, t);
  }

  private draw(): void {
    const state = this.getInterpolated();
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    const sx = cssW / PITCH_WIDTH;
    const sy = cssH / PITCH_HEIGHT;

    this.ctx.clearRect(0, 0, cssW, cssH);
    this.drawPitch(cssW, cssH, sx, sy);

    if (!state) {
      this.ctx.fillStyle = "rgba(255,255,255,0.7)";
      this.ctx.font = "500 18px 'DM Sans', sans-serif";
      this.ctx.textAlign = "center";
      this.ctx.fillText("Waiting for kickoff…", cssW / 2, cssH / 2);
      return;
    }

    for (const k of state.keepers) {
      if (k.x < -20 || k.x > PITCH_WIDTH + 20) continue;
      this.drawKeeper(k, sx, sy);
    }
    for (const p of state.players) {
      this.drawPlayer(p, sx, sy);
    }
    this.drawBall(state.ball, sx, sy);
    this.drawLocalAim(state, sx, sy);
    this.updateParticles(sx, sy);

    if (state.phase === "countdown") {
      this.drawCountdown(state, cssW, cssH);
    }
    if (state.banner) {
      this.drawBanner(state.banner, cssW, cssH);
    }
    if (state.phase === "penalties" && state.penalties) {
      this.drawPenaltyOverlay(state, cssW, cssH, sx, sy);
    }
  }

  private drawPitch(w: number, h: number, sx: number, sy: number): void {
    const g = this.ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#2a6335");
    g.addColorStop(0.5, "#348240");
    g.addColorStop(1, "#265c32");
    this.ctx.fillStyle = g;
    this.ctx.fillRect(0, 0, w, h);

    this.ctx.fillStyle = "rgba(255,255,255,0.035)";
    const stripe = w / 12;
    for (let i = 0; i < 12; i += 2) {
      this.ctx.fillRect(i * stripe, 0, stripe, h);
    }

    // Soft stadium vignette
    const vg = this.ctx.createRadialGradient(
      w / 2,
      h / 2,
      h * 0.2,
      w / 2,
      h / 2,
      h * 0.85
    );
    vg.addColorStop(0, "transparent");
    vg.addColorStop(1, "rgba(0,0,0,0.28)");
    this.ctx.fillStyle = vg;
    this.ctx.fillRect(0, 0, w, h);

    this.ctx.strokeStyle = "rgba(255,255,255,0.6)";
    this.ctx.lineWidth = 2.5;
    this.ctx.strokeRect(3, 3, w - 6, h - 6);

    this.ctx.beginPath();
    this.ctx.moveTo(w / 2, 3);
    this.ctx.lineTo(w / 2, h - 3);
    this.ctx.stroke();

    this.ctx.beginPath();
    this.ctx.arc(w / 2, h / 2, 72 * sx, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.arc(w / 2, h / 2, 4, 0, Math.PI * 2);
    this.ctx.fillStyle = "rgba(255,255,255,0.75)";
    this.ctx.fill();

    const goalH = GOAL_WIDTH * sy;
    const goalY = (h - goalH) / 2;
    this.ctx.fillStyle = "rgba(12, 18, 28, 0.55)";
    this.ctx.fillRect(0, goalY, 12, goalH);
    this.ctx.fillRect(w - 12, goalY, 12, goalH);
    this.ctx.strokeStyle = "rgba(255,255,255,0.75)";
    this.ctx.strokeRect(0, goalY, 20 * sx, goalH);
    this.ctx.strokeRect(w - 20 * sx, goalY, 20 * sx, goalH);

    this.ctx.strokeRect(3, h * 0.22, 95 * sx, h * 0.56);
    this.ctx.strokeRect(w - 3 - 95 * sx, h * 0.22, 95 * sx, h * 0.56);
  }

  private drawKeeper(k: KeeperState, sx: number, sy: number): void {
    const x = k.x * sx;
    const y = k.y * sy;
    const r = KEEPER_RADIUS * sx;
    const isLeft = k.side === "left";

    this.ctx.beginPath();
    this.ctx.arc(x, y, r, 0, Math.PI * 2);
    this.ctx.fillStyle = isLeft ? "#243b55" : "#8a6a28";
    this.ctx.fill();
    this.ctx.lineWidth = 2;
    this.ctx.strokeStyle = k.hasBall ? "#fff8e7" : "rgba(255,255,255,0.45)";
    this.ctx.stroke();

    this.ctx.fillStyle = "rgba(255,255,255,0.55)";
    this.ctx.beginPath();
    this.ctx.arc(
      x + (isLeft ? r * 0.55 : -r * 0.55),
      y,
      r * 0.28,
      0,
      Math.PI * 2
    );
    this.ctx.fill();

    this.ctx.fillStyle = "rgba(255,255,255,0.75)";
    this.ctx.font = `600 ${Math.max(10, 11 * sx)}px 'DM Sans', sans-serif`;
    this.ctx.textAlign = "center";
    this.ctx.fillText("GK", x, y - r - 5);
  }

  private drawPlayer(p: PlayerState, sx: number, sy: number): void {
    const x = p.x * sx;
    const y = p.y * sy;
    const r = PLAYER_RADIUS * sx;
    const isLeft = p.side === "left";
    const isMe = this.mySide === p.side;

    const body = p.stunned ? "#666" : isLeft ? "#1e3a5f" : "#c9892a";
    const rim = isLeft ? "#7eb6ff" : "#ffe0a0";

    if (p.sliding) {
      this.ctx.save();
      this.ctx.translate(x, y);
      this.ctx.rotate(Math.atan2(p.facingY, p.facingX));
      this.ctx.beginPath();
      this.ctx.ellipse(0, 0, r * 1.55, r * 0.55, 0, 0, Math.PI * 2);
      this.ctx.fillStyle = body;
      this.ctx.fill();
      this.ctx.strokeStyle = "#fff8e7";
      this.ctx.lineWidth = 2;
      this.ctx.stroke();
      this.ctx.fillStyle = "rgba(232,239,230,0.25)";
      this.ctx.fillRect(-r * 1.8, r * 0.2, r * 1.2, 3);
      this.ctx.restore();
    } else {
      this.ctx.beginPath();
      this.ctx.arc(x, y, r, 0, Math.PI * 2);
      this.ctx.fillStyle = body;
      this.ctx.fill();
      this.ctx.lineWidth = isMe ? 3 : 1.5;
      this.ctx.strokeStyle = p.hasBall ? "#9dffb0" : isMe ? "#fff8e7" : rim;
      this.ctx.stroke();
    }

    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
    this.ctx.lineTo(x + p.facingX * r * 0.95, y + p.facingY * r * 0.95);
    this.ctx.strokeStyle = "rgba(255,255,255,0.85)";
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    this.ctx.fillStyle = "rgba(255,255,255,0.92)";
    this.ctx.font = `600 ${Math.max(11, 12 * sx)}px 'DM Sans', sans-serif`;
    this.ctx.textAlign = "center";
    this.ctx.fillText(p.name, x, y - r - 6);

    if (p.charge > 0.02) {
      this.drawPowerBar(x, y + r + 12, r * 2.2, p.charge);
    }

    if (p.emote) {
      const label = EMOTE_LABEL[p.emote];
      const float = Math.sin(this.animT * 6) * 3;
      this.ctx.font = `700 ${Math.max(16, 18 * sx)}px 'DM Sans', sans-serif`;
      this.ctx.fillStyle = "#fff8e7";
      this.ctx.strokeStyle = "rgba(0,0,0,0.45)";
      this.ctx.lineWidth = 3;
      this.ctx.strokeText(label, x, y - r - 22 + float);
      this.ctx.fillText(label, x, y - r - 22 + float);
    }
  }

  private drawPowerBar(
    cx: number,
    cy: number,
    width: number,
    charge: number
  ): void {
    const h = 6;
    this.ctx.fillStyle = "rgba(0,0,0,0.45)";
    this.ctx.fillRect(cx - width / 2, cy, width, h);
    const grad = this.ctx.createLinearGradient(cx - width / 2, 0, cx + width / 2, 0);
    grad.addColorStop(0, "#d4a84b");
    grad.addColorStop(1, charge > 0.85 ? "#ff6b4a" : "#ffe0a0");
    this.ctx.fillStyle = grad;
    this.ctx.fillRect(cx - width / 2, cy, width * charge, h);
  }

  private drawLocalAim(state: GameSnapshot, sx: number, sy: number): void {
    if (state.phase !== "play" && state.phase !== "countdown") return;
    const me = state.players.find((p) => p.side === this.mySide);
    if (!me) return;

    const x = me.x * sx;
    const y = me.y * sy;
    const ax = this.localAimX * sx;
    const ay = this.localAimY * sy;

    this.ctx.strokeStyle =
      this.localCharge > 0.02
        ? "rgba(212, 168, 75, 0.95)"
        : "rgba(255,255,255,0.22)";
    this.ctx.lineWidth = this.localCharge > 0.02 ? 2.5 : 1;
    this.ctx.setLineDash(this.localCharge > 0.02 ? [] : [6, 6]);
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
    this.ctx.lineTo(ax, ay);
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    this.ctx.beginPath();
    this.ctx.arc(ax, ay, 4, 0, Math.PI * 2);
    this.ctx.fillStyle =
      this.localCharge > 0.02 ? "#d4a84b" : "rgba(255,255,255,0.35)";
    this.ctx.fill();

    if (this.localCharge > 0.02) {
      this.drawPowerBar(x, y + PLAYER_RADIUS * sy + 12, 52, this.localCharge);
    }
  }

  private drawBall(ball: BallState, sx: number, sy: number): void {
    const x = ball.x * sx;
    const y = ball.y * sy;
    const r = BALL_RADIUS * sx;
    const spin = this.animT * Math.hypot(ball.vx, ball.vy) * 0.01;

    this.ctx.beginPath();
    this.ctx.arc(x + 2, y + 3, r + 2, 0, Math.PI * 2);
    this.ctx.fillStyle = "rgba(0,0,0,0.22)";
    this.ctx.fill();

    this.ctx.beginPath();
    this.ctx.arc(x, y, r, 0, Math.PI * 2);
    this.ctx.fillStyle = "#f4f1ea";
    this.ctx.fill();
    this.ctx.strokeStyle = "#222";
    this.ctx.lineWidth = 1;
    this.ctx.stroke();

    this.ctx.save();
    this.ctx.translate(x, y);
    this.ctx.rotate(spin);
    this.ctx.strokeStyle = "rgba(40,40,40,0.35)";
    this.ctx.beginPath();
    this.ctx.moveTo(-r * 0.6, 0);
    this.ctx.lineTo(r * 0.6, 0);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private updateParticles(sx: number, sy: number): void {
    const dt = 1 / 60;
    this.particles = this.particles.filter((p) => {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 80 * dt;
      if (p.life <= 0) return false;
      const alpha = Math.max(0, p.life / (p.maxLife || 1));
      this.ctx.globalAlpha = alpha;
      this.ctx.fillStyle = p.color;
      this.ctx.beginPath();
      this.ctx.arc(p.x * sx, p.y * sy, p.size, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.globalAlpha = 1;
      return true;
    });
  }

  private drawCountdown(state: GameSnapshot, w: number, h: number): void {
    const sec = Math.max(1, Math.ceil(state.countdownMs / 1000));
    const pulse = 1 + Math.sin(this.animT * 10) * 0.04;
    this.ctx.fillStyle = "rgba(0,0,0,0.35)";
    this.ctx.fillRect(0, 0, w, h);
    this.ctx.save();
    this.ctx.translate(w / 2, h / 2);
    this.ctx.scale(pulse, pulse);
    this.ctx.fillStyle = "#fff8e7";
    this.ctx.font = "800 96px 'Bebas Neue', sans-serif";
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.fillText(String(sec), 0, -8);
    this.ctx.font = "600 18px 'DM Sans', sans-serif";
    this.ctx.fillStyle = "#d4a84b";
    this.ctx.fillText("GET READY", 0, 56);
    this.ctx.restore();
  }

  private drawBanner(text: string, w: number, h: number): void {
    const pulse = 1 + Math.sin(this.animT * 8) * 0.03;
    this.ctx.save();
    this.ctx.translate(w / 2, h * 0.28);
    this.ctx.scale(pulse, pulse);
    this.ctx.fillStyle = "rgba(12,20,14,0.65)";
    this.ctx.fillRect(-160, -36, 320, 72);
    this.ctx.strokeStyle = "#d4a84b";
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(-160, -36, 320, 72);
    this.ctx.fillStyle = "#fff8e7";
    this.ctx.font = "800 42px 'Bebas Neue', sans-serif";
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.fillText(text, 0, 2);
    this.ctx.restore();
  }

  private drawPenaltyOverlay(
    state: GameSnapshot,
    w: number,
    _h: number,
    sx: number,
    sy: number
  ): void {
    const pens = state.penalties!;
    this.ctx.fillStyle = "rgba(0,0,0,0.28)";
    this.ctx.fillRect(0, 0, w, 48);

    this.ctx.fillStyle = "#fff8e7";
    this.ctx.font = "700 16px 'DM Sans', sans-serif";
    this.ctx.textAlign = "center";
    this.ctx.fillText(
      `PENALTIES  ${pens.pens.left} – ${pens.pens.right}   ·   ${pens.prompt}`,
      w / 2,
      30
    );

    if (pens.status === "aiming") {
      const sec = Math.max(1, Math.ceil((pens.timeLeftMs ?? 0) / 1000));
      this.ctx.fillStyle = "#d4a84b";
      this.ctx.font = "700 14px 'DM Sans', sans-serif";
      this.ctx.fillText(`${sec}s to shoot`, w / 2, 46);

      // Aim preview only for the shooter
      if (pens.showAim) {
        const shooter = state.players.find((p) => p.side === pens.shooterSide);
        if (shooter) {
          const ax = shooter.x * sx;
          const ay = shooter.y * sy;
          this.ctx.strokeStyle = "rgba(255, 210, 120, 0.9)";
          this.ctx.lineWidth = 2;
          this.ctx.beginPath();
          this.ctx.moveTo(ax, ay);
          this.ctx.lineTo(ax + pens.aimX * 90 * sx, ay + pens.aimY * 90 * sy);
          this.ctx.stroke();
        }
      }
    }
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpSnapshot(
  from: GameSnapshot,
  to: GameSnapshot,
  t: number
): GameSnapshot {
  const players = to.players.map((tp) => {
    const fp = from.players.find((p) => p.id === tp.id) ?? tp;
    return {
      ...tp,
      x: lerp(fp.x, tp.x, t),
      y: lerp(fp.y, tp.y, t),
      vx: lerp(fp.vx, tp.vx, t),
      vy: lerp(fp.vy, tp.vy, t),
    };
  });
  const keepers = to.keepers.map((tk) => {
    const fk = from.keepers.find((k) => k.side === tk.side) ?? tk;
    return {
      ...tk,
      x: lerp(fk.x, tk.x, t),
      y: lerp(fk.y, tk.y, t),
    };
  });
  return {
    ...to,
    ball: {
      x: lerp(from.ball.x, to.ball.x, t),
      y: lerp(from.ball.y, to.ball.y, t),
      vx: lerp(from.ball.vx, to.ball.vx, t),
      vy: lerp(from.ball.vy, to.ball.vy, t),
    },
    players,
    keepers,
  };
}
