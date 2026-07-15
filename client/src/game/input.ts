import type { PlayerInput } from "../shared/protocol";
import { PITCH_HEIGHT, PITCH_WIDTH } from "../shared/protocol";

export class InputController {
  private keys = new Set<string>();
  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;
  private boundMouseDown: (e: MouseEvent) => void;
  private boundMouseUp: (e: MouseEvent) => void;
  private boundMouseMove: (e: MouseEvent) => void;
  private boundContext: (e: Event) => void;
  private active = false;
  private canvas: HTMLCanvasElement | null = null;

  aimX = PITCH_WIDTH / 2;
  aimY = PITCH_HEIGHT / 2;
  private charging = false;
  private shootPulse = false;
  private pendingCharge = 0;
  private chargeStartedAt = 0;
  private emotePulse = 0;

  constructor() {
    this.boundKeyDown = (e) => {
      if (!this.active) return;
      const k = e.key.toLowerCase();
      const relevant = [
        "w",
        "a",
        "s",
        "d",
        "e",
        " ",
        "1",
        "2",
        "3",
        "4",
        "arrowup",
        "arrowdown",
        "arrowleft",
        "arrowright",
        "shift",
      ];
      if (
        relevant.includes(k) ||
        e.code === "Space" ||
        e.code === "ShiftLeft" ||
        e.code === "ShiftRight"
      ) {
        e.preventDefault();
      }
      if (["1", "2", "3", "4"].includes(k) && !e.repeat) {
        this.emotePulse = Number(k);
      }
      this.keys.add(k);
      if (e.code === "Space") this.keys.add(" ");
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.keys.add("shift");
    };
    this.boundKeyUp = (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (e.code === "Space") this.keys.delete(" ");
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
        this.keys.delete("shift");
      }
    };
    this.boundMouseDown = (e) => {
      if (!this.active || !this.canvas) return;
      if (e.button !== 0) return;
      e.preventDefault();
      this.updateAimFromEvent(e);
      this.charging = true;
      this.chargeStartedAt = performance.now();
    };
    this.boundMouseUp = (e) => {
      if (!this.active) return;
      if (e.button !== 0) return;
      e.preventDefault();
      this.updateAimFromEvent(e);
      if (this.charging) {
        this.pendingCharge = this.computeCharge();
        this.shootPulse = true;
      }
      this.charging = false;
    };
    this.boundMouseMove = (e) => {
      if (!this.active) return;
      this.updateAimFromEvent(e);
    };
    this.boundContext = (e) => e.preventDefault();
  }

  attachCanvas(canvas: HTMLCanvasElement): void {
    this.detachCanvas();
    this.canvas = canvas;
    canvas.addEventListener("mousedown", this.boundMouseDown);
    window.addEventListener("mouseup", this.boundMouseUp);
    canvas.addEventListener("mousemove", this.boundMouseMove);
    canvas.addEventListener("contextmenu", this.boundContext);
  }

  detachCanvas(): void {
    if (!this.canvas) return;
    this.canvas.removeEventListener("mousedown", this.boundMouseDown);
    window.removeEventListener("mouseup", this.boundMouseUp);
    this.canvas.removeEventListener("mousemove", this.boundMouseMove);
    this.canvas.removeEventListener("contextmenu", this.boundContext);
    this.canvas = null;
  }

  private updateAimFromEvent(e: MouseEvent): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / Math.max(1, rect.width);
    const ny = (e.clientY - rect.top) / Math.max(1, rect.height);
    this.aimX = nx * PITCH_WIDTH;
    this.aimY = ny * PITCH_HEIGHT;
  }

  private computeCharge(): number {
    const held = (performance.now() - this.chargeStartedAt) / 750;
    return Math.min(1, Math.max(0.2, held));
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    window.addEventListener("keydown", this.boundKeyDown);
    window.addEventListener("keyup", this.boundKeyUp);
  }

  stop(): void {
    this.active = false;
    this.keys.clear();
    this.charging = false;
    this.shootPulse = false;
    this.pendingCharge = 0;
    this.emotePulse = 0;
    this.detachCanvas();
    window.removeEventListener("keydown", this.boundKeyDown);
    window.removeEventListener("keyup", this.boundKeyUp);
  }

  sample(): PlayerInput {
    const shoot = this.shootPulse;
    this.shootPulse = false;

    let charge = this.charging ? this.computeCharge() : 0;
    if (shoot) {
      charge = this.pendingCharge;
      this.pendingCharge = 0;
    }

    const emote = this.emotePulse;
    this.emotePulse = 0;

    return {
      up: this.keys.has("w") || this.keys.has("arrowup"),
      down: this.keys.has("s") || this.keys.has("arrowdown"),
      left: this.keys.has("a") || this.keys.has("arrowleft"),
      right: this.keys.has("d") || this.keys.has("arrowright"),
      kick: this.keys.has(" ") || this.keys.has("space"),
      tackle: this.keys.has("e") || this.keys.has("shift"),
      aimX: this.aimX,
      aimY: this.aimY,
      charge,
      shoot,
      emote,
    };
  }

  getLocalCharge(): number {
    return this.charging ? this.computeCharge() : 0;
  }
}
