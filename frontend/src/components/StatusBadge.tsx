type Status = "ok" | "degraded" | "up" | "down" | "unknown";

const STYLES: Record<Status, string> = {
  ok: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]",
  up: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]",
  degraded: "bg-amber-500/10 text-amber-400 border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.2)]",
  down: "bg-rose-500/10 text-rose-400 border-rose-500/30 shadow-[0_0_10px_rgba(244,63,94,0.2)]",
  unknown: "bg-slate-500/10 text-slate-400 border-slate-500/30",
};

export function StatusBadge({ status, label }: { status: Status; label?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${STYLES[status] ?? STYLES.unknown}`}
    >
      <span className="h-2 w-2 rounded-full bg-current animate-pulse" />
      {label ?? status.toUpperCase()}
    </span>
  );
}

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNSCORED";

const RISK_STYLES: Record<RiskLevel, { badge: string; dot: string }> = {
  LOW: {
    badge: "bg-emerald-950/60 text-emerald-400 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.2)]",
    dot: "bg-emerald-400",
  },
  MEDIUM: {
    badge: "bg-amber-950/60 text-amber-300 border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.2)]",
    dot: "bg-amber-400",
  },
  HIGH: {
    badge: "bg-orange-950/60 text-orange-400 border-orange-500/40 shadow-[0_0_12px_rgba(249,115,22,0.2)]",
    dot: "bg-orange-400 animate-ping",
  },
  CRITICAL: {
    badge: "bg-rose-950/80 text-rose-300 border-rose-500/60 shadow-[0_0_15px_rgba(244,63,94,0.35)] font-bold",
    dot: "bg-rose-400 animate-pulse",
  },
  UNSCORED: {
    badge: "bg-slate-800/60 text-slate-400 border-slate-700",
    dot: "bg-slate-500",
  },
};

export function RiskBadge({ level }: { level: string }) {
  const normalizedLevel = (level?.toUpperCase() as RiskLevel) || "UNSCORED";
  const style = RISK_STYLES[normalizedLevel] ?? RISK_STYLES.UNSCORED;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs tracking-wide ${style.badge}`}>
      <span className={`h-2 w-2 rounded-full ${style.dot}`} />
      {normalizedLevel}
    </span>
  );
}
