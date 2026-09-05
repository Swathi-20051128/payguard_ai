import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "@/lib/apiClient";
import { RiskBadge } from "@/components/StatusBadge";

interface CaseRow {
  id: string;
  merchantId: string;
  riskScore: number;
  riskLevel: string;
  status: string;
  transactionIds: string[];
  createdAt: string;
  assignedTo?: { name: string } | null;
}

interface ListResponse {
  items: CaseRow[];
  pagination: { page: number; total: number; totalPages: number };
}

async function fetchCases(status: string): Promise<ListResponse> {
  const params: Record<string, string> = { limit: "50" };
  if (status) params.status = status;
  const { data } = await apiClient.get<ListResponse>("/cases", { params });
  return data;
}

const STATUS_BADGES: Record<string, { style: string; label: string }> = {
  OPEN: { style: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30", label: "Open" },
  UNDER_REVIEW: { style: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30", label: "Under Review" },
  CONFIRMED_SUSPICIOUS: { style: "bg-rose-500/15 text-rose-300 border-rose-500/40 shadow-glow-red font-bold", label: "Confirmed Fraud" },
  DISMISSED: { style: "bg-slate-700/40 text-slate-400 border-slate-700", label: "Dismissed" },
  ESCALATED: { style: "bg-orange-500/10 text-orange-400 border-orange-500/30", label: "Escalated" },
  RESOLVED: { style: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30", label: "Resolved" },
};

export function CasesPage() {
  const [status, setStatus] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["cases", status], queryFn: () => fetchCases(status) });

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white">Investigation Cases</h1>
          <p className="mt-1 text-sm text-slate-400">
            Analyst workflow workspace for reviewing evidence, assigning cases, and taking action.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold uppercase text-slate-400">Filter Status:</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-bold text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Workflow Statuses</option>
            <option value="OPEN">🔵 Open</option>
            <option value="UNDER_REVIEW">🟡 Under Review</option>
            <option value="CONFIRMED_SUSPICIOUS">🔴 Confirmed Suspicious</option>
            <option value="ESCALATED">🟠 Escalated</option>
            <option value="RESOLVED">🟢 Resolved</option>
            <option value="DISMISSED">⚪ Dismissed</option>
          </select>
        </div>
      </div>

      <div className="glass-card rounded-2xl overflow-hidden border border-slate-800 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-900/90 text-xs uppercase font-bold tracking-wider text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-5 py-4">Case ID</th>
                <th className="px-5 py-4">Merchant ID</th>
                <th className="px-5 py-4">Risk Rating</th>
                <th className="px-5 py-4">Workflow Status</th>
                <th className="px-5 py-4">Assigned Analyst</th>
                <th className="px-5 py-4">Linked Txns</th>
                <th className="px-5 py-4">Created Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-medium">
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-slate-400">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                      Loading cases...
                    </span>
                  </td>
                </tr>
              )}

              {data?.items.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-slate-400 font-normal">
                    No investigation cases found matching the criteria.
                  </td>
                </tr>
              )}

              {data?.items.map((c) => {
                const statusMeta = STATUS_BADGES[c.status] || {
                  style: "bg-slate-800 text-slate-400 border-slate-700",
                  label: c.status,
                };

                return (
                  <tr key={c.id} className="hover:bg-slate-800/40 transition-colors duration-150">
                    <td className="px-5 py-3.5">
                      <Link
                        to={`/cases/${c.id}`}
                        className="font-mono text-xs font-bold text-indigo-400 hover:text-indigo-300 hover:underline"
                      >
                        🔍 {c.id}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 font-medium text-white">{c.merchantId}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <RiskBadge level={c.riskLevel} />
                        <span className="font-mono text-xs font-bold text-slate-300">({c.riskScore})</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-semibold ${statusMeta.style}`}>
                        {statusMeta.label}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-slate-300">
                      {c.assignedTo?.name ? (
                        <span className="flex items-center gap-1.5 font-semibold text-slate-200">
                          👤 {c.assignedTo.name}
                        </span>
                      ) : (
                        <span className="text-slate-500 italic">Unassigned</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="rounded-full bg-slate-800 px-2.5 py-0.5 font-mono text-xs font-bold text-indigo-300">
                        {c.transactionIds.length} txns
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-slate-400 font-mono">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
