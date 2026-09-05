import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { apiClient } from "@/lib/apiClient";
import { RiskBadge } from "@/components/StatusBadge";
import { useAuth } from "@/lib/AuthContext";

interface RiskSummary {
  totalTransactions: number;
  byRiskLevel: { LOW: number; MEDIUM: number; HIGH: number; CRITICAL: number; UNSCORED: number };
  simulatedExposure: { amount: number; transactionCount: number; note: string };
  mlCoverage: { scoredWithMl: number; rulesOnlyFallback: number };
  fraudScenarios: Record<string, number>;
  openAlertsCount: number;
  totalCasesCount: number;
  ruleEngineVersion: string;
}

async function fetchSummary(): Promise<RiskSummary> {
  const { data } = await apiClient.get<RiskSummary>("/risk/summary");
  return data;
}

export function DashboardPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [seedSuccess, setSeedSuccess] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["risk-summary"], queryFn: fetchSummary });

  const seedMutation = useMutation({
    mutationFn: async () => {
      await apiClient.post("/transactions/generate-sample", {
        transactionCount: 200,
        suspiciousRate: 0.25,
      });
      await apiClient.post("/risk/analyze-batch", { reanalyzeAll: true });
    },
    onSuccess: () => {
      setSeedSuccess(true);
      queryClient.invalidateQueries({ queryKey: ["risk-summary"] });
      setTimeout(() => setSeedSuccess(false), 5000);
    },
  });

  const barChartData = data
    ? [
        { level: "Low Risk", count: data.byRiskLevel.LOW, fill: "#10b981" },
        { level: "Medium Risk", count: data.byRiskLevel.MEDIUM, fill: "#f59e0b" },
        { level: "High Risk", count: data.byRiskLevel.HIGH, fill: "#f97316" },
        { level: "Critical Threat", count: data.byRiskLevel.CRITICAL, fill: "#ef4444" },
      ]
    : [];

  const pieData = data
    ? [
        { name: "Low", value: data.byRiskLevel.LOW, color: "#10b981" },
        { name: "Medium", value: data.byRiskLevel.MEDIUM, color: "#f59e0b" },
        { name: "High", value: data.byRiskLevel.HIGH, color: "#f97316" },
        { name: "Critical", value: data.byRiskLevel.CRITICAL, color: "#ef4444" },
      ].filter((item) => item.value > 0)
    : [];

  const highCriticalCount = data ? data.byRiskLevel.HIGH + data.byRiskLevel.CRITICAL : 0;

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-8">
      {/* Header section with quick action */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight text-white">Risk Intelligence Dashboard</h1>
            <span className="rounded-full bg-indigo-500/10 border border-indigo-500/30 px-3 py-0.5 text-xs font-bold text-indigo-400">
              Live Engine v{data?.ruleEngineVersion || "1.0.0"}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            Real-time explainable risk assessment across 200 ingested payment transactions, merchant anomalies, and fraud networks.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => refetch()}
            className="rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition"
          >
            🔄 Refresh Metrics
          </button>
          {(user?.role === "admin" || user?.role === "analyst") && (
            <button
              onClick={() => seedMutation.mutate()}
              disabled={seedMutation.isPending}
              className="rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 px-4 py-2 text-xs font-bold text-white shadow-glow hover:opacity-90 transition disabled:opacity-50"
            >
              {seedMutation.isPending ? "⏳ Re-seeding Data..." : "⚡ Seed 200 Transactions"}
            </button>
          )}
        </div>
      </div>

      {seedSuccess && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/50 p-4 text-sm font-semibold text-emerald-300 shadow-glow">
          🎉 Successfully seeded and scored 200 sample transactions!
        </div>
      )}

      {isLoading && (
        <div className="flex h-64 items-center justify-center">
          <div className="flex items-center gap-3 text-indigo-400 font-semibold text-sm">
            <span className="h-5 w-5 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
            Loading risk intelligence metrics...
          </div>
        </div>
      )}

      {isError && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/50 p-6 text-sm text-rose-300">
          ⚠️ Could not load risk summary. Ensure backend server and MongoDB are running.
        </div>
      )}

      {data && (
        <>
          {/* Top Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <MetricCard
              title="Total Transactions"
              value={data.totalTransactions.toLocaleString()}
              subtitle="200 Seeded & Scored"
              accentColor="from-indigo-500/20 to-purple-500/10 border-indigo-500/30"
              icon="💳"
            />
            <MetricCard
              title="High + Critical Threats"
              value={highCriticalCount.toLocaleString()}
              subtitle={`${data.openAlertsCount ?? 0} Open Alerts`}
              accentColor="from-rose-500/20 to-orange-500/10 border-rose-500/40 shadow-glow-red"
              icon="🚨"
              valueColor="text-rose-400"
            />
            <MetricCard
              title="Simulated Exposure"
              value={`₹${data.simulatedExposure.amount.toLocaleString()}`}
              subtitle="High risk exposure aggregate"
              accentColor="from-amber-500/20 to-yellow-500/10 border-amber-500/30"
              icon="💰"
              valueColor="text-amber-300"
            />
            <MetricCard
              title="Active Cases & ML Coverage"
              value={`${data.totalCasesCount ?? 0} Cases`}
              subtitle={`${data.mlCoverage.scoredWithMl.toLocaleString()} Scored with ML`}
              accentColor="from-emerald-500/20 to-teal-500/10 border-emerald-500/30"
              icon="🤖"
              valueColor="text-emerald-400"
            />
          </div>

          {/* Scenarios & Attack Pattern Breakdown */}
          {data.fraudScenarios && Object.keys(data.fraudScenarios).length > 0 && (
            <div className="glass-card rounded-2xl p-6 border border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-white">Detected Fraud Attack Scenarios</h2>
                  <p className="text-xs text-slate-400">Breakdown across 10 real-world fraud pattern categories</p>
                </div>
                <span className="rounded-full bg-indigo-500/10 border border-indigo-500/30 px-3 py-1 text-xs font-bold text-indigo-300">
                  {Object.values(data.fraudScenarios).reduce((a, b) => a + b, 0)} Attack Signals Triggered
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                {Object.entries(data.fraudScenarios).map(([scenario, count]) => (
                  <div key={scenario} className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 text-center">
                    <p className="text-xl font-black text-indigo-400">{count}</p>
                    <p className="text-[11px] font-bold text-slate-300 uppercase tracking-wider mt-1">
                      {scenario.replace(/_/g, " ")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Bar Chart */}
            <div className="lg:col-span-2 glass-card rounded-2xl p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-base font-bold text-white">Risk Level Distribution</h2>
                  <p className="text-xs text-slate-400">Categorized count of scored transactions</p>
                </div>
                <div className="flex items-center gap-2">
                  <RiskBadge level="CRITICAL" />
                  <RiskBadge level="HIGH" />
                </div>
              </div>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="level" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                    <YAxis stroke="#94a3b8" tick={{ fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", borderRadius: "12px", color: "#fff" }}
                    />
                    <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                      {barChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Donut Chart */}
            <div className="glass-card rounded-2xl p-6 flex flex-col justify-between">
              <div>
                <h2 className="text-base font-bold text-white">Risk Proportion</h2>
                <p className="text-xs text-slate-400">Share of critical vs normal volume</p>
              </div>

              <div className="h-56 w-full my-2">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={4} dataKey="value">
                      {pieData.map((entry, index) => (
                        <Cell key={`pie-cell-${index}`} fill={entry.color} stroke="#0f172a" strokeWidth={2} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", borderRadius: "12px", color: "#fff" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                {pieData.map((item) => (
                  <div key={item.name} className="flex items-center gap-2 rounded-lg bg-slate-900/60 p-2 border border-slate-800">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-slate-300 font-medium">{item.name}:</span>
                    <span className="text-white font-bold">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Role Permissions & Access Control Matrix Table */}
          <div className="glass-card rounded-2xl p-6 border border-slate-800 space-y-4">
            <div>
              <h2 className="text-base font-bold text-white">Security & Role Access Control Matrix</h2>
              <p className="text-xs text-slate-400">Permission privileges for current user: <strong className="text-indigo-400 uppercase">{user?.role}</strong></p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-900/90 uppercase font-bold tracking-wider text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-4 py-3">System Action / Feature</th>
                    <th className="px-4 py-3 text-center">Viewer</th>
                    <th className="px-4 py-3 text-center">Analyst</th>
                    <th className="px-4 py-3 text-center">Admin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium">
                  <tr className="hover:bg-slate-800/30">
                    <td className="px-4 py-2.5">View Dashboard & Risk Metrics</td>
                    <td className="px-4 py-2.5 text-center text-emerald-400 font-bold">✅ Allowed</td>
                    <td className="px-4 py-2.5 text-center text-emerald-400 font-bold">✅ Allowed</td>
                    <td className="px-4 py-2.5 text-center text-emerald-400 font-bold">✅ Allowed</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30">
                    <td className="px-4 py-2.5">View Transactions, Alerts, Cases, Audit Logs</td>
                    <td className="px-4 py-2.5 text-center text-emerald-400 font-bold">✅ Allowed</td>
                    <td className="px-4 py-2.5 text-center text-emerald-400 font-bold">✅ Allowed</td>
                    <td className="px-4 py-2.5 text-center text-emerald-400 font-bold">✅ Allowed</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30">
                    <td className="px-4 py-2.5">Upload CSV/JSON Datasets & Generate Synthetic Data</td>
                    <td className="px-4 py-2.5 text-center text-rose-400 font-bold">❌ Blocked</td>
                    <td className="px-4 py-2.5 text-center text-emerald-400 font-bold">✅ Allowed</td>
                    <td className="px-4 py-2.5 text-center text-emerald-400 font-bold">✅ Allowed</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30">
                    <td className="px-4 py-2.5">Run Manual & Batch Risk Analysis</td>
                    <td className="px-4 py-2.5 text-center text-rose-400 font-bold">❌ Blocked</td>
                    <td className="px-4 py-2.5 text-center text-emerald-400 font-bold">✅ Allowed</td>
                    <td className="px-4 py-2.5 text-center text-emerald-400 font-bold">✅ Allowed</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30">
                    <td className="px-4 py-2.5">Create Cases & Record Analyst Decisions</td>
                    <td className="px-4 py-2.5 text-center text-rose-400 font-bold">❌ Blocked</td>
                    <td className="px-4 py-2.5 text-center text-emerald-400 font-bold">✅ Allowed</td>
                    <td className="px-4 py-2.5 text-center text-emerald-400 font-bold">✅ Allowed</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30">
                    <td className="px-4 py-2.5">Verify Cryptographic Audit Hash Chain</td>
                    <td className="px-4 py-2.5 text-center text-rose-400 font-bold">❌ Blocked</td>
                    <td className="px-4 py-2.5 text-center text-rose-400 font-bold">❌ Blocked</td>
                    <td className="px-4 py-2.5 text-center text-indigo-400 font-bold shadow-glow">👑 Admin Only</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({
  title,
  value,
  subtitle,
  accentColor,
  icon,
  valueColor = "text-white",
}: {
  title: string;
  value: string;
  subtitle: string;
  accentColor: string;
  icon: string;
  valueColor?: string;
}) {
  return (
    <div className={`glass-card rounded-2xl p-5 bg-gradient-to-br ${accentColor} transition-all duration-200 hover:scale-[1.02]`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</span>
        <span className="text-xl">{icon}</span>
      </div>
      <p className={`mt-3 text-3xl font-black tracking-tight ${valueColor}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-400 font-medium">{subtitle}</p>
    </div>
  );
}
