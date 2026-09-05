import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { StatusBadge, RiskBadge } from "@/components/StatusBadge";

interface TransactionRow {
  transactionId: string;
  merchantId: string;
  customerId: string;
  amount: number;
  currency: string;
  status: string;
  riskScore?: number;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  confidence?: string;
  timestamp: string;
}

interface ListResponse {
  items: TransactionRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

async function fetchTransactions(page: number, riskLevel?: string): Promise<ListResponse> {
  const params: Record<string, string> = { page: String(page), limit: "25" };
  if (riskLevel) params.riskLevel = riskLevel;
  const { data } = await apiClient.get<ListResponse>("/transactions", { params });
  return data;
}

export function TransactionsPage() {
  const [page, setPage] = useState(1);
  const [riskLevel, setRiskLevel] = useState<string>("");

  const { data, isLoading } = useQuery({
    queryKey: ["transactions", page, riskLevel],
    queryFn: () => fetchTransactions(page, riskLevel || undefined),
  });

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white">Transaction Explorer</h1>
          <p className="mt-1 text-sm text-slate-400">
            Real-time granular audit of ingested payments, risk scores, and AI confidence parameters.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold uppercase text-slate-400">Filter Risk:</label>
          <select
            value={riskLevel}
            onChange={(e) => {
              setRiskLevel(e.target.value);
              setPage(1);
            }}
            className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-bold text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Risk Levels</option>
            <option value="LOW">🟢 Low Risk</option>
            <option value="MEDIUM">🟡 Medium Risk</option>
            <option value="HIGH">🟠 High Risk</option>
            <option value="CRITICAL">🔴 Critical Threat</option>
          </select>
        </div>
      </div>

      <div className="glass-card rounded-2xl overflow-hidden border border-slate-800 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-900/90 text-xs uppercase font-bold tracking-wider text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-5 py-4">Transaction ID</th>
                <th className="px-5 py-4">Merchant / Customer</th>
                <th className="px-5 py-4">Amount</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4">Risk Rating</th>
                <th className="px-5 py-4">AI Confidence</th>
                <th className="px-5 py-4">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-medium">
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-slate-400">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                      Loading transactions...
                    </span>
                  </td>
                </tr>
              )}

              {data?.items.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-slate-400 font-normal">
                    No transactions found matching your criteria.
                  </td>
                </tr>
              )}

              {data?.items.map((t) => (
                <tr key={t.transactionId} className="hover:bg-slate-800/40 transition-colors duration-150">
                  <td className="px-5 py-3.5 font-mono text-xs font-semibold text-indigo-300">{t.transactionId}</td>
                  <td className="px-5 py-3.5">
                    <div className="text-xs font-semibold text-white">{t.merchantId}</div>
                    <div className="text-[11px] text-slate-400">{t.customerId}</div>
                  </td>
                  <td className="px-5 py-3.5 font-bold text-white">
                    {t.currency} {t.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge
                      status={t.status === "success" ? "up" : t.status === "failed" ? "down" : "unknown"}
                      label={t.status}
                    />
                  </td>
                  <td className="px-5 py-3.5">
                    {t.riskLevel ? (
                      <div className="flex items-center gap-2">
                        <RiskBadge level={t.riskLevel} />
                        <span className="font-mono text-xs font-bold text-slate-300">({t.riskScore})</span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500 font-mono">Unscored</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-xs text-slate-400 font-semibold">{t.confidence ?? "—"}</td>
                  <td className="px-5 py-3.5 text-xs text-slate-400 font-mono">
                    {new Date(t.timestamp).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data && data.pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 bg-slate-900/80 border-t border-slate-800 text-xs font-medium text-slate-400">
            <span>
              Showing page <strong className="text-white">{data.pagination.page}</strong> of{" "}
              <strong className="text-white">{data.pagination.totalPages}</strong> ({data.pagination.total.toLocaleString()}{" "}
              total records)
            </span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-1.5 font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40 transition"
              >
                Previous
              </button>
              <button
                disabled={data.pagination.page >= data.pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-1.5 font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40 transition"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
