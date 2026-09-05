import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { RiskBadge } from "@/components/StatusBadge";

interface AlertRow {
  id: string;
  transactionId: string;
  merchantId: string;
  customerId: string;
  riskScore: number;
  severity: "MEDIUM" | "HIGH" | "CRITICAL";
  confidence: string;
  status: string;
  reasons: string[];
  recommendedAction: string;
  createdAt: string;
}

interface ListResponse {
  items: AlertRow[];
  pagination: { page: number; total: number; totalPages: number };
}

async function fetchAlerts(status: string): Promise<ListResponse> {
  const params: Record<string, string> = { limit: "50" };
  if (status) params.status = status;
  const { data } = await apiClient.get<ListResponse>("/alerts", { params });
  return data;
}

async function createCaseFromAlert(alertId: string) {
  const { data } = await apiClient.post("/cases", { alertIds: [alertId] });
  return data;
}

export function AlertsPage() {
  const [status, setStatus] = useState("OPEN");
  const [expanded, setExpanded] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ["alerts", status], queryFn: () => fetchAlerts(status) });

  const openCaseMutation = useMutation({
    mutationFn: createCaseFromAlert,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      queryClient.invalidateQueries({ queryKey: ["cases"] });
    },
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white">Risk Alerts Queue</h1>
          <p className="mt-1 text-sm text-slate-400">
            Real-time flagged suspicious behavior requiring analyst triage or automated case opening.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold uppercase text-slate-400">Alert Status:</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-bold text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="OPEN">🔴 Open Alerts</option>
            <option value="UNDER_REVIEW">🟡 Under Review</option>
            <option value="ESCALATED">⚡ Escalated</option>
            <option value="RESOLVED">🟢 Resolved</option>
            <option value="DISMISSED">⚪ Dismissed</option>
            <option value="">All Alerts</option>
          </select>
        </div>
      </div>

      {isLoading && (
        <div className="flex h-48 items-center justify-center">
          <div className="flex items-center gap-3 text-indigo-400 font-semibold text-sm">
            <span className="h-5 w-5 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
            Loading risk alerts...
          </div>
        </div>
      )}

      {data && data.items.length === 0 && !isLoading && (
        <div className="glass-card rounded-2xl p-12 text-center text-slate-400 font-medium">
          🎉 No alerts currently in <strong className="text-white">{status || "any"}</strong> status.
        </div>
      )}

      <div className="space-y-4">
        {data?.items.map((alert) => (
          <div
            key={alert.id}
            className={`glass-card rounded-2xl p-5 border transition-all duration-200 ${
              alert.severity === "CRITICAL"
                ? "border-rose-500/50 shadow-glow-red"
                : alert.severity === "HIGH"
                ? "border-orange-500/40"
                : "border-amber-500/30"
            }`}
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <RiskBadge level={alert.severity} />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Score:</span>
                  <span className="font-mono text-sm font-black text-white">{alert.riskScore}/100</span>
                </div>
                <div className="h-4 w-px bg-slate-700 hidden sm:block" />
                <div className="text-xs font-mono text-indigo-300 font-semibold">{alert.transactionId}</div>
                <div className="text-xs text-slate-400">Merchant: <strong className="text-slate-200">{alert.merchantId}</strong></div>
                <div className="text-xs text-slate-400">Confidence: <strong className="text-emerald-400">{alert.confidence}</strong></div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <button
                  onClick={() => setExpanded(expanded === alert.id ? null : alert.id)}
                  className="rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition"
                >
                  {expanded === alert.id ? "Hide Evidence ▲" : "Show Evidence ▼"}
                </button>

                {alert.status === "OPEN" && (
                  <button
                    onClick={() => openCaseMutation.mutate(alert.id)}
                    disabled={openCaseMutation.isPending}
                    className="rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-1.5 text-xs font-bold text-white shadow-glow hover:opacity-90 transition disabled:opacity-50"
                  >
                    🚀 Open Case
                  </button>
                )}
              </div>
            </div>

            {expanded === alert.id && (
              <div className="mt-4 border-t border-slate-800/80 pt-4 space-y-3">
                <div className="rounded-xl bg-slate-950/80 p-4 border border-slate-800">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-400 mb-2">
                    🔍 AI & Rule Trigger Evidence Signals
                  </h4>
                  <ul className="space-y-1.5 text-xs text-slate-300">
                    {alert.reasons.length === 0 && <li className="text-slate-500 italic">No explicit reasons listed.</li>}
                    {alert.reasons.map((r, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-indigo-400 mt-0.5">•</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex items-center justify-between text-xs rounded-xl bg-indigo-950/40 p-3 border border-indigo-500/20">
                  <span className="text-slate-400 font-medium">Recommended Action:</span>
                  <span className="font-bold text-indigo-300">{alert.recommendedAction}</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
