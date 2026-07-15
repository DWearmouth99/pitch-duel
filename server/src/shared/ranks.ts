/** Ranked ladder divisions driven by ELO. */

export interface DivisionDef {
  id: string;
  tier: string;
  division: number | null;
  label: string;
  minElo: number;
  color: string;
  accent: string;
}

/** Ordered low → high. */
export const DIVISIONS: DivisionDef[] = [
  { id: "bronze3", tier: "Bronze", division: 3, label: "Bronze III", minElo: 0, color: "#8a5a2b", accent: "#c48a4a" },
  { id: "bronze2", tier: "Bronze", division: 2, label: "Bronze II", minElo: 800, color: "#9a6430", accent: "#d49a58" },
  { id: "bronze1", tier: "Bronze", division: 1, label: "Bronze I", minElo: 900, color: "#ab7038", accent: "#e0a868" },
  { id: "silver3", tier: "Silver", division: 3, label: "Silver III", minElo: 1000, color: "#7a8694", accent: "#c5d0dc" },
  { id: "silver2", tier: "Silver", division: 2, label: "Silver II", minElo: 1100, color: "#8894a2", accent: "#d2dde8" },
  { id: "silver1", tier: "Silver", division: 1, label: "Silver I", minElo: 1200, color: "#96a2b0", accent: "#e8f0f8" },
  { id: "gold3", tier: "Gold", division: 3, label: "Gold III", minElo: 1300, color: "#b8860b", accent: "#f0c040" },
  { id: "gold2", tier: "Gold", division: 2, label: "Gold II", minElo: 1400, color: "#c9960f", accent: "#f5cc50" },
  { id: "gold1", tier: "Gold", division: 1, label: "Gold I", minElo: 1500, color: "#d4a84b", accent: "#ffe08a" },
  { id: "emerald3", tier: "Emerald", division: 3, label: "Emerald III", minElo: 1600, color: "#1f7a4d", accent: "#3dcc7a" },
  { id: "emerald2", tier: "Emerald", division: 2, label: "Emerald II", minElo: 1700, color: "#228a56", accent: "#4adc88" },
  { id: "emerald1", tier: "Emerald", division: 1, label: "Emerald I", minElo: 1800, color: "#259a5f", accent: "#5aec96" },
  { id: "diamond3", tier: "Diamond", division: 3, label: "Diamond III", minElo: 1900, color: "#2a6a9a", accent: "#7ec8ff" },
  { id: "diamond2", tier: "Diamond", division: 2, label: "Diamond II", minElo: 2050, color: "#2f7ab0", accent: "#8ed4ff" },
  { id: "diamond1", tier: "Diamond", division: 1, label: "Diamond I", minElo: 2200, color: "#358ac6", accent: "#a0e0ff" },
  { id: "champion", tier: "Champion", division: null, label: "Champion", minElo: 2400, color: "#6b3fa0", accent: "#d4a0ff" },
];

export interface RankProgress {
  elo: number;
  division: DivisionDef;
  next: DivisionDef | null;
  /** Progress 0–1 toward next division (1 if champion). */
  progress: number;
  eloToNext: number | null;
  ladder: DivisionDef[];
}

export function divisionForElo(elo: number): DivisionDef {
  let current = DIVISIONS[0];
  for (const d of DIVISIONS) {
    if (elo >= d.minElo) current = d;
  }
  return current;
}

export function rankProgress(elo: number): RankProgress {
  const safe = Math.max(0, Math.floor(elo));
  const division = divisionForElo(safe);
  const idx = DIVISIONS.findIndex((d) => d.id === division.id);
  const next = idx >= 0 && idx < DIVISIONS.length - 1 ? DIVISIONS[idx + 1] : null;
  if (!next) {
    return {
      elo: safe,
      division,
      next: null,
      progress: 1,
      eloToNext: null,
      ladder: DIVISIONS,
    };
  }
  const span = next.minElo - division.minElo;
  const into = safe - division.minElo;
  return {
    elo: safe,
    division,
    next,
    progress: span > 0 ? Math.min(1, Math.max(0, into / span)) : 1,
    eloToNext: Math.max(0, next.minElo - safe),
    ladder: DIVISIONS,
  };
}
