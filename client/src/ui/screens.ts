import type { GameSocket } from "../net/socket";
import type { LeaderboardEntry, Side } from "../shared/protocol";
import { apiUrl } from "../config";
import {
  DIVISIONS,
  divisionForElo,
  rankProgress,
  type DivisionDef,
  type RankProgress,
} from "../shared/ranks";

export type ScreenId =
  | "menu"
  | "play"
  | "ranks"
  | "controls"
  | "account"
  | "queue"
  | "match"
  | "results"
  | "leaderboard";

export interface MatchHudInfo {
  youName: string;
  youElo: number;
  youSide: Side;
  oppName: string;
  oppElo: number;
}

export interface ResultsInfo {
  scoreLeft: number;
  scoreRight: number;
  winner: Side;
  yourSide: Side;
  youElo: number;
  youDelta: number;
  oppName: string;
  disconnect?: boolean;
  decidedByPens?: boolean;
  penaltyLeft?: number;
  penaltyRight?: number;
}

export class UI {
  root: HTMLElement;
  private screens = new Map<ScreenId, HTMLElement>();
  private onFindMatch: (() => void) | null = null;
  private onCancelQueue: (() => void) | null = null;
  private onPlayAgain: (() => void) | null = null;
  private onShowLeaderboard: (() => void) | null = null;
  private onBackMenu: (() => void) | null = null;
  private onOpenRanks: (() => void) | null = null;
  private onLogin: ((username: string, password: string) => void) | null = null;
  private onRegister: ((username: string, password: string) => void) | null =
    null;
  private onLogout: (() => void) | null = null;
  private onOpenPlay: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.innerHTML = this.template();
    for (const id of [
      "menu",
      "play",
      "ranks",
      "controls",
      "account",
      "queue",
      "match",
      "results",
      "leaderboard",
    ] as ScreenId[]) {
      const el = this.root.querySelector(`#screen-${id}`) as HTMLElement;
      this.screens.set(id, el);
    }
    this.bind();
  }

  private template(): string {
    return `
      <section class="screen active" id="screen-menu">
        <div class="menu-stage">
          <div class="menu-field" aria-hidden="true"></div>
          <div class="menu-hero">
            <p class="eyebrow">Online · Ranked</p>
            <h1 class="brand">Pitch Duel</h1>
            <p class="tagline">1v1 football. Climb the ladder.</p>
          </div>
          <p class="muted-note" id="menu-user" hidden></p>
          <nav class="menu-nav" aria-label="Main menu">
            <button type="button" class="menu-btn menu-btn-primary" id="btn-menu-play">Play</button>
            <button type="button" class="menu-btn" data-goto="ranks">Ranks</button>
            <button type="button" class="menu-btn" data-goto="controls">Controls</button>
            <button type="button" class="menu-btn" id="btn-menu-leaderboard">Leaderboard</button>
            <button type="button" class="menu-btn" data-goto="account" id="btn-menu-account">Account</button>
          </nav>
        </div>
      </section>

      <section class="screen" id="screen-play">
        <div class="subpage">
          <button type="button" class="back-link" data-goto="menu">← Menu</button>
          <h2 class="subpage-title">Play</h2>
          <p class="subpage-lead" id="play-lead">Queue for a ranked duel with your account.</p>
          <div class="panel play-panel">
            <p id="play-as"></p>
            <div id="play-rank-chip" class="rank-chip-wrap" hidden></div>
            <p class="error" id="play-error"></p>
            <div class="btn-row">
              <button type="button" id="btn-find" class="btn-primary">Find Match</button>
              <button type="button" class="secondary" data-goto="account">Account</button>
            </div>
          </div>
        </div>
      </section>

      <section class="screen screen-ranks" id="screen-ranks">
        <div class="subpage subpage-wide">
          <button type="button" class="back-link" data-goto="menu">← Menu</button>
          <h2 class="subpage-title">Ranks</h2>
          <p class="subpage-lead">Your division and the ladder to climb.</p>
          <div id="ranks-panel" class="ranks-page-panel">
            <p class="muted-note">Log in under Account to load your rank.</p>
          </div>
        </div>
      </section>

      <section class="screen" id="screen-controls">
        <div class="subpage">
          <button type="button" class="back-link" data-goto="menu">← Menu</button>
          <h2 class="subpage-title">Controls</h2>
          <p class="subpage-lead">Learn the pitch before you queue.</p>
          <div class="panel controls-panel">
            <ul class="control-list">
              <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> <span>Move · facing drives your slide</span></li>
              <li><kbd>Click</kbd>+hold <span>Aim with mouse, release to shoot</span></li>
              <li><kbd>Space</kbd> <span>Quick medium power kick</span></li>
              <li><kbd>E</kbd> <span>Slide tackle in facing direction</span></li>
              <li><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd> <span>Emotes: cheer · fire · shock · GG</span></li>
            </ul>
            <p class="controls-note">Draws go to a penalty shootout. Keepers throw to their own teammate. You cannot enter the opponent’s goal box.</p>
          </div>
        </div>
      </section>

      <section class="screen" id="screen-account">
        <div class="subpage">
          <button type="button" class="back-link" data-goto="menu">← Menu</button>
          <h2 class="subpage-title">Account</h2>
          <p class="subpage-lead">Log in or create an account to play ranked.</p>
          <div class="panel" id="account-form">
            <label for="account-user">Username</label>
            <input id="account-user" type="text" maxlength="20" placeholder="Username" autocomplete="username" />
            <label for="account-pass">Password</label>
            <input id="account-pass" type="password" maxlength="64" placeholder="Password" autocomplete="current-password" />
            <p class="error" id="account-error"></p>
            <div class="btn-row">
              <button type="button" id="btn-login" class="btn-primary">Login</button>
              <button type="button" id="btn-register" class="secondary">Create account</button>
            </div>
          </div>
          <div class="panel" id="account-session" hidden>
            <p>Signed in as <strong id="account-name"></strong></p>
            <div id="account-rank-chip" class="rank-chip-wrap"></div>
            <div class="btn-row">
              <button type="button" id="btn-logout" class="secondary">Log out</button>
            </div>
          </div>
        </div>
      </section>

      <section class="screen" id="screen-queue">
        <div class="queue-pulse" aria-hidden="true"></div>
        <h1 class="brand brand-sm">Pitch Duel</h1>
        <p class="queue-dots">···</p>
        <p class="tagline" id="queue-status">Searching for an opponent…</p>
        <div id="queue-rank" class="rank-chip-wrap"></div>
        <div class="btn-row" style="margin-top:1.25rem">
          <button type="button" class="secondary" id="btn-cancel-queue">Cancel</button>
        </div>
      </section>

      <section class="screen" id="screen-match">
        <div class="match-hud">
          <div class="hud-side left">
            <span class="hud-name navy" id="hud-left-name">—</span>
            <span class="hud-elo" id="hud-left-elo"></span>
          </div>
          <div class="hud-center">
            <div class="scoreboard"><span id="score-left">0</span> – <span id="score-right">0</span></div>
            <div class="timer" id="match-timer">2:00</div>
          </div>
          <div class="hud-side right">
            <span class="hud-name amber" id="hud-right-name">—</span>
            <span class="hud-elo" id="hud-right-elo"></span>
          </div>
        </div>
        <div class="pitch-wrap">
          <canvas id="pitch"></canvas>
        </div>
        <div class="match-footer">
          <span id="match-controls"><kbd>WASD</kbd> · <kbd>Click+hold</kbd> shoot · <kbd>E</kbd> slide · <kbd>1–4</kbd> emote</span>
          <span id="match-hint">You are highlighted</span>
        </div>
      </section>

      <section class="screen" id="screen-results">
        <h2 class="result-title" id="result-title">Full Time</h2>
        <div class="result-score" id="result-score">0 – 0</div>
        <div class="panel results-panel">
          <p id="result-summary"></p>
          <div id="result-rank" class="rank-panel"></div>
          <div class="btn-row">
            <button type="button" id="btn-play-again" class="btn-primary">Play Again</button>
            <button type="button" class="secondary" id="btn-results-lb">Leaderboard</button>
            <button type="button" class="secondary" id="btn-results-menu">Menu</button>
          </div>
        </div>
      </section>

      <section class="screen" id="screen-leaderboard">
        <div class="page-header">
          <h2>Leaderboard</h2>
          <button type="button" class="secondary" id="btn-lb-back">← Menu</button>
        </div>
        <table class="leaderboard-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Division</th>
              <th>ELO</th>
              <th>W–L–D</th>
            </tr>
          </thead>
          <tbody id="lb-body">
            <tr><td colspan="5">Loading…</td></tr>
          </tbody>
        </table>
      </section>
    `;
  }

  private bind(): void {
    this.root.querySelector("#btn-find")!.addEventListener("click", () => {
      this.onFindMatch?.();
    });

    this.root.querySelector("#btn-menu-play")!.addEventListener("click", () => {
      this.onOpenPlay?.();
    });

    const submitLogin = () => {
      const username = (
        this.root.querySelector("#account-user") as HTMLInputElement
      ).value.trim();
      const password = (
        this.root.querySelector("#account-pass") as HTMLInputElement
      ).value;
      this.onLogin?.(username, password);
    };

    this.root.querySelector("#btn-login")!.addEventListener("click", submitLogin);

    this.root.querySelector("#btn-register")!.addEventListener("click", () => {
      const username = (
        this.root.querySelector("#account-user") as HTMLInputElement
      ).value.trim();
      const password = (
        this.root.querySelector("#account-pass") as HTMLInputElement
      ).value;
      this.onRegister?.(username, password);
    });

    this.root.querySelector("#btn-logout")!.addEventListener("click", () => {
      this.onLogout?.();
    });

    const passInput = this.root.querySelector(
      "#account-pass"
    ) as HTMLInputElement;
    passInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitLogin();
    });

    this.root.querySelectorAll("[data-goto]").forEach((el) => {
      el.addEventListener("click", () => {
        const target = (el as HTMLElement).dataset.goto as ScreenId | undefined;
        if (!target) return;
        if (target === "ranks") {
          this.onOpenRanks?.();
          this.show("ranks");
          return;
        }
        if (target === "menu") {
          this.onBackMenu?.();
          return;
        }
        this.show(target);
      });
    });

    this.root
      .querySelector("#btn-menu-leaderboard")!
      .addEventListener("click", () => this.onShowLeaderboard?.());

    this.root
      .querySelector("#btn-cancel-queue")!
      .addEventListener("click", () => this.onCancelQueue?.());

    this.root
      .querySelector("#btn-results-lb")!
      .addEventListener("click", () => this.onShowLeaderboard?.());

    this.root
      .querySelector("#btn-play-again")!
      .addEventListener("click", () => this.onPlayAgain?.());

    this.root
      .querySelector("#btn-results-menu")!
      .addEventListener("click", () => this.onBackMenu?.());

    this.root
      .querySelector("#btn-lb-back")!
      .addEventListener("click", () => this.onBackMenu?.());
  }

  on(handlers: {
    findMatch?: () => void;
    cancelQueue?: () => void;
    playAgain?: () => void;
    showLeaderboard?: () => void;
    backMenu?: () => void;
    openRanks?: () => void;
    login?: (username: string, password: string) => void;
    register?: (username: string, password: string) => void;
    logout?: () => void;
    openPlay?: () => void;
  }): void {
    this.onFindMatch = handlers.findMatch ?? null;
    this.onCancelQueue = handlers.cancelQueue ?? null;
    this.onPlayAgain = handlers.playAgain ?? null;
    this.onShowLeaderboard = handlers.showLeaderboard ?? null;
    this.onBackMenu = handlers.backMenu ?? null;
    this.onOpenRanks = handlers.openRanks ?? null;
    this.onLogin = handlers.login ?? null;
    this.onRegister = handlers.register ?? null;
    this.onLogout = handlers.logout ?? null;
    this.onOpenPlay = handlers.openPlay ?? null;
  }

  show(id: ScreenId): void {
    for (const [key, el] of this.screens) {
      el.classList.toggle("active", key === id);
    }
  }

  setSession(session: { username: string; elo: number } | null): void {
    const menuUser = this.root.querySelector("#menu-user") as HTMLElement;
    const accountForm = this.root.querySelector("#account-form") as HTMLElement;
    const accountSession = this.root.querySelector(
      "#account-session"
    ) as HTMLElement;
    const accountName = this.root.querySelector("#account-name") as HTMLElement;
    const playAs = this.root.querySelector("#play-as") as HTMLElement;

    if (!session) {
      menuUser.hidden = true;
      menuUser.textContent = "";
      accountForm.hidden = false;
      accountSession.hidden = true;
      accountName.textContent = "";
      playAs.textContent = "";
      this.setRanksElo(null);
      return;
    }

    menuUser.hidden = false;
    menuUser.textContent = `Signed in as ${session.username}`;
    accountForm.hidden = true;
    accountSession.hidden = false;
    accountName.textContent = session.username;
    playAs.textContent = `Playing as ${session.username}`;
    this.setRanksElo(session.elo);
  }

  setAccountError(msg: string): void {
    const el = this.root.querySelector("#account-error")!;
    el.textContent = msg;
    if (msg) this.show("account");
  }

  /** @deprecated alias — play screen error */
  setLobbyError(msg: string): void {
    this.setPlayError(msg);
  }

  setPlayError(msg: string): void {
    const el = this.root.querySelector("#play-error")!;
    el.textContent = msg;
    if (msg) this.show("play");
  }

  setLobbyElo(elo: number | null): void {
    this.setRanksElo(elo);
  }

  setRanksElo(elo: number | null): void {
    const ranksPanel = this.root.querySelector("#ranks-panel") as HTMLElement;
    const playChip = this.root.querySelector("#play-rank-chip") as HTMLElement;
    const accountChip = this.root.querySelector(
      "#account-rank-chip"
    ) as HTMLElement;
    if (elo == null) {
      ranksPanel.innerHTML = `<p class="muted-note">Log in under Account to load your rank.</p>`;
      playChip.hidden = true;
      playChip.innerHTML = "";
      accountChip.innerHTML = "";
      return;
    }
    ranksPanel.innerHTML = renderRanksPage(rankProgress(elo));
    playChip.hidden = false;
    playChip.innerHTML = renderRankChip(rankProgress(elo));
    accountChip.innerHTML = renderRankChip(rankProgress(elo));
  }

  setQueueElo(elo: number, name: string): void {
    (
      this.root.querySelector("#queue-status") as HTMLElement
    ).textContent = `Searching for an opponent as ${name}… AI joins if no one queues.`;
    const wrap = this.root.querySelector("#queue-rank") as HTMLElement;
    wrap.innerHTML = renderRankChip(rankProgress(elo));
  }

  getCanvas(): HTMLCanvasElement {
    return this.root.querySelector("#pitch") as HTMLCanvasElement;
  }

  setupMatchHud(info: MatchHudInfo): void {
    const leftIsYou = info.youSide === "left";
    const leftName = leftIsYou ? info.youName : info.oppName;
    const rightName = leftIsYou ? info.oppName : info.youName;
    const leftElo = leftIsYou ? info.youElo : info.oppElo;
    const rightElo = leftIsYou ? info.oppElo : info.youElo;
    const leftDiv = divisionForElo(leftElo);
    const rightDiv = divisionForElo(rightElo);

    (this.root.querySelector("#hud-left-name") as HTMLElement).textContent =
      leftName + (leftIsYou ? " (you)" : "");
    (this.root.querySelector("#hud-right-name") as HTMLElement).textContent =
      rightName + (!leftIsYou ? " (you)" : "");
    (this.root.querySelector("#hud-left-elo") as HTMLElement).innerHTML =
      `<span class="hud-div" style="--div-color:${leftDiv.accent}">${escapeHtml(leftDiv.label)}</span> · ${leftElo}`;
    (this.root.querySelector("#hud-right-elo") as HTMLElement).innerHTML =
      `<span class="hud-div" style="--div-color:${rightDiv.accent}">${escapeHtml(rightDiv.label)}</span> · ${rightElo}`;
    (
      this.root.querySelector("#match-hint") as HTMLElement
    ).textContent = `You are ${info.youSide === "left" ? "navy (left)" : "amber (right)"}`;
  }

  updateHud(
    scoreLeft: number,
    scoreRight: number,
    timeLeftMs: number,
    opts?: {
      phase?: "countdown" | "play" | "penalties";
      countdownMs?: number;
      pens?: { left: number; right: number } | null;
      prompt?: string;
      myRole?: "shooter" | "keeper" | null;
      penaltyTimeLeftMs?: number;
    }
  ): void {
    (this.root.querySelector("#score-left") as HTMLElement).textContent =
      String(scoreLeft);
    (this.root.querySelector("#score-right") as HTMLElement).textContent =
      String(scoreRight);

    const timer = this.root.querySelector("#match-timer") as HTMLElement;
    const controls = this.root.querySelector("#match-controls") as HTMLElement;

    if (opts?.phase === "countdown") {
      const sec = Math.max(1, Math.ceil((opts.countdownMs ?? 0) / 1000));
      timer.textContent = `Kickoff ${sec}`;
      controls.innerHTML = `Hold position · match starts soon`;
      (
        this.root.querySelector("#match-hint") as HTMLElement
      ).textContent = "Movement locked until kickoff";
    } else if (opts?.phase === "penalties") {
      const pl = opts.pens?.left ?? 0;
      const pr = opts.pens?.right ?? 0;
      const shotSec =
        opts.penaltyTimeLeftMs != null
          ? Math.max(1, Math.ceil(opts.penaltyTimeLeftMs / 1000))
          : null;
      timer.textContent =
        shotSec != null ? `PEN ${pl}–${pr} · ${shotSec}s` : `PEN ${pl}–${pr}`;
      if (opts.myRole === "shooter") {
        controls.innerHTML =
          `<kbd>WASD</kbd> aim · <kbd>Space</kbd> shoot · timed`;
      } else if (opts.myRole === "keeper") {
        controls.innerHTML =
          `<kbd>WASD</kbd> move/dive · <kbd>E</kbd> dive · aim is hidden`;
      } else {
        controls.innerHTML = `Penalty shootout`;
      }
      if (opts.prompt) {
        (this.root.querySelector("#match-hint") as HTMLElement).textContent =
          opts.prompt;
      }
    } else {
      const totalSec = Math.ceil(timeLeftMs / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      timer.textContent = `${m}:${s.toString().padStart(2, "0")}`;
      controls.innerHTML =
        `<kbd>WASD</kbd> · <kbd>Click+hold</kbd> shoot · <kbd>E</kbd> slide · <kbd>1–4</kbd> emote`;
    }
  }

  showResults(info: ResultsInfo): void {
    const title = this.root.querySelector("#result-title")!;
    const youWon = info.winner === info.yourSide;
    if (info.disconnect) {
      title.textContent = "Opponent Left";
    } else if (youWon) {
      title.textContent = info.decidedByPens ? "Won on Pens" : "Victory";
    } else {
      title.textContent = info.decidedByPens ? "Lost on Pens" : "Defeat";
    }

    const scoreEl = this.root.querySelector("#result-score") as HTMLElement;
    if (
      info.decidedByPens &&
      info.penaltyLeft != null &&
      info.penaltyRight != null
    ) {
      scoreEl.textContent = `${info.scoreLeft}–${info.scoreRight}  (${info.penaltyLeft}–${info.penaltyRight} pens)`;
    } else {
      scoreEl.textContent = `${info.scoreLeft} – ${info.scoreRight}`;
    }

    (
      this.root.querySelector("#result-summary") as HTMLElement
    ).textContent = info.disconnect
      ? `${info.oppName} disconnected. Match awarded.`
      : `vs ${info.oppName}`;

    const rankEl = this.root.querySelector("#result-rank") as HTMLElement;
    rankEl.innerHTML = renderRankCard(rankProgress(info.youElo), {
      showLadder: true,
      delta: info.youDelta,
    });

    this.show("results");
  }

  async renderLeaderboard(): Promise<void> {
    const body = this.root.querySelector("#lb-body") as HTMLElement;
    body.innerHTML = `<tr><td colspan="5">Loading…</td></tr>`;
    try {
      const res = await fetch(apiUrl("/api/leaderboard?limit=20"));
      const data = (await res.json()) as {
        entries: (LeaderboardEntry & { divisionLabel?: string })[];
      };
      if (!data.entries.length) {
        body.innerHTML = `<tr><td colspan="5">No ranked players yet. Play a match!</td></tr>`;
        return;
      }
      body.innerHTML = data.entries
        .map((e, i) => {
          const div = divisionForElo(e.elo);
          const label = e.divisionLabel ?? div.label;
          return `
        <tr>
          <td class="rank">${i + 1}</td>
          <td>${escapeHtml(e.name)}</td>
          <td>
            <span class="lb-div" style="--div-color:${div.color};--div-accent:${div.accent}">
              <span class="lb-div-gem" aria-hidden="true"></span>
              ${escapeHtml(label)}
            </span>
          </td>
          <td>${e.elo}</td>
          <td>${e.wins}–${e.losses}–${e.draws}</td>
        </tr>`;
        })
        .join("");
    } catch {
      body.innerHTML = `<tr><td colspan="5">Could not load leaderboard.</td></tr>`;
    }
  }

  getName(): string {
    return (
      this.root.querySelector("#account-name") as HTMLElement
    ).textContent?.trim() ?? "";
  }
}

function renderRankChip(p: RankProgress): string {
  const d = p.division;
  return `
    <div class="rank-chip" style="--div-color:${d.color};--div-accent:${d.accent}">
      <span class="rank-badge rank-badge-sm" aria-hidden="true">
        <span class="rank-badge-shine"></span>
        <span class="rank-badge-mark">${badgeMark(d)}</span>
      </span>
      <div class="rank-chip-text">
        <strong>${escapeHtml(d.label)}</strong>
        <span>${p.elo} ELO</span>
      </div>
    </div>`;
}

function renderRanksPage(p: RankProgress): string {
  const d = p.division;
  const pct = Math.round(p.progress * 100);
  const nextCopy = p.next
    ? `<strong>${p.eloToNext}</strong> ELO to <em>${escapeHtml(p.next.label)}</em>`
    : `<em>Champion</em> — top of the ladder`;

  const currentIdx = DIVISIONS.findIndex((tier) => tier.id === d.id);

  return `
    <div class="ranks-showcase" style="--div-color:${d.color};--div-accent:${d.accent}">
      <div class="ranks-hero">
        <span class="rank-badge rank-badge-xl" aria-hidden="true">
          <span class="rank-badge-shine"></span>
          <span class="rank-badge-ring"></span>
          <span class="rank-badge-mark">${badgeMark(d)}</span>
        </span>
        <div class="ranks-hero-copy">
          <p class="rank-tier">${escapeHtml(d.tier)}${d.division != null ? ` · Division ${roman(d.division)}` : ""}</p>
          <h3 class="ranks-hero-label">${escapeHtml(d.label)}</h3>
          <p class="ranks-hero-elo"><span class="ranks-elo-num">${p.elo}</span> <span class="ranks-elo-unit">ELO</span></p>
        </div>
      </div>

      <div class="ranks-progress-block">
        <div class="rank-progress-track rank-progress-track-lg">
          <div class="rank-progress-fill" style="width:${pct}%"></div>
        </div>
        <div class="ranks-progress-copy">
          <span>${pct}% through ${escapeHtml(d.label)}</span>
          <span>${nextCopy}</span>
        </div>
      </div>

      <div class="ranks-ladder-head">
        <h4>Division ladder</h4>
        <span>${currentIdx + 1} / ${DIVISIONS.length}</span>
      </div>
      <div class="ranks-ladder" role="list" aria-label="Rank ladder">
        ${DIVISIONS.map((tier, i) => {
          const reached = p.elo >= tier.minElo;
          const current = tier.id === d.id;
          const locked = !reached;
          const status = current ? "You" : reached ? "Cleared" : `${tier.minElo}+`;
          return `
            <div class="ranks-rung${reached ? " reached" : ""}${current ? " current" : ""}${locked ? " locked" : ""}"
                 role="listitem"
                 style="--div-color:${tier.color};--div-accent:${tier.accent}">
              <span class="ranks-rung-index">${String(i + 1).padStart(2, "0")}</span>
              <span class="rank-badge rank-badge-md" aria-hidden="true">
                <span class="rank-badge-shine"></span>
                <span class="rank-badge-mark">${badgeMark(tier)}</span>
              </span>
              <div class="ranks-rung-meta">
                <strong>${escapeHtml(tier.label)}</strong>
                <span>${tier.minElo} ELO</span>
              </div>
              <span class="ranks-rung-status">${status}</span>
            </div>`;
        }).join("")}
      </div>
    </div>`;
}

function renderRankCard(
  p: RankProgress,
  opts?: { showLadder?: boolean; delta?: number }
): string {
  const d = p.division;
  const pct = Math.round(p.progress * 100);
  const nextLabel = p.next
    ? `${p.eloToNext} to ${escapeHtml(p.next.label)}`
    : "Peak of the ladder";
  const delta =
    opts?.delta != null
      ? `<span class="${
          opts.delta > 0
            ? "delta-up"
            : opts.delta < 0
              ? "delta-down"
              : "delta-flat"
        }">${opts.delta > 0 ? "+" : ""}${opts.delta}</span>`
      : "";

  const ladder = opts?.showLadder
    ? `<div class="rank-ladder" role="list" aria-label="Rank ladder">
        ${DIVISIONS.map((tier) => {
          const reached = p.elo >= tier.minElo;
          const current = tier.id === d.id;
          return `
            <div class="ladder-rung${reached ? " reached" : ""}${current ? " current" : ""}"
                 role="listitem"
                 style="--div-color:${tier.color};--div-accent:${tier.accent}"
                 title="${escapeHtml(tier.label)} · ${tier.minElo}+">
              <span class="ladder-gem" aria-hidden="true"></span>
              <span class="ladder-label">${escapeHtml(shortLabel(tier.label))}</span>
              <span class="ladder-elo">${tier.minElo}</span>
            </div>`;
        }).join("")}
      </div>`
    : "";

  return `
    <div class="rank-card" style="--div-color:${d.color};--div-accent:${d.accent}">
      <div class="rank-card-top">
        <span class="rank-badge" aria-hidden="true">
          <span class="rank-badge-shine"></span>
          <span class="rank-badge-ring"></span>
          <span class="rank-badge-mark">${badgeMark(d)}</span>
        </span>
        <div class="rank-card-meta">
          <p class="rank-tier">${escapeHtml(d.tier)}${d.division != null ? ` · Div ${roman(d.division)}` : ""}</p>
          <h3 class="rank-label">${escapeHtml(d.label)}</h3>
          <p class="rank-elo">${p.elo} <span>ELO</span> ${delta}</p>
        </div>
      </div>
      <div class="rank-progress">
        <div class="rank-progress-track">
          <div class="rank-progress-fill" style="width:${pct}%"></div>
        </div>
        <div class="rank-progress-meta">
          <span>${escapeHtml(d.label)}</span>
          <span>${nextLabel}</span>
        </div>
      </div>
      ${ladder}
    </div>`;
}

function badgeMark(d: DivisionDef): string {
  if (d.tier === "Champion") return "★";
  if (d.tier === "Diamond") return "◇";
  if (d.tier === "Emerald") return "◆";
  if (d.division === 1) return "I";
  if (d.division === 2) return "II";
  return "III";
}

function shortLabel(label: string): string {
  return label
    .replace("Bronze ", "B")
    .replace("Silver ", "S")
    .replace("Gold ", "G")
    .replace("Emerald ", "E")
    .replace("Diamond ", "D")
    .replace(" III", "3")
    .replace(" II", "2")
    .replace(" I", "1");
}

function roman(n: number): string {
  return n === 1 ? "I" : n === 2 ? "II" : "III";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type { GameSocket };
