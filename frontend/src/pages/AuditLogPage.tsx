import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { useAuth } from "@/lib/AuthContext";

interface AuditEntry {
  sequence: number;
  action: string;
  entityType: string;
  entityId: string;
  reason?: string;
  userId?: { name: string; email: string };
  createdAt: string;
}

interface ListResponse {
  items: AuditEntry[];
  pagination: { total: number };
}

async function fetchAuditLogs(): Promise<ListResponse> {
  const { data } = await apiClient.get<ListResponse>("/audit-logs", { params: { limit: "100" } });
  return data;
}

async function verifyChain() {
  const { data } = await apiClient.get("/audit-logs/verify");
  return data as { valid: boolean; brokenAtSequence: number | null; totalEntries: number };
}

export function AuditLogPage() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ["audit-logs"], queryFn: fetchAuditLogs });
  const verifyMutation = useMutation({ mutationFn: verifyChain });

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight text-white">Immutable Audit Trail</h1>
            <span className="rounded-full bg-indigo-500/10 border border-indigo-500/30 px-3 py-0.5 text-xs font-bold text-indigo-400">
              SHA-256 Hash Chain
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            Cryptographically chained ledger recording every analyst decision, case state update, and ingestion event.
          </p>
        </div>

        {user?.role === "admin" && (
          <button
            onClick={() => verifyMutation.mutate()}
            disabled={verifyMutation.isPending}
            className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-xs font-bold text-white shadow-glow hover:opacity-90 transition disabled:opacity-50"
          >
            {verifyMutation.isPending ? "⏳ Verifying Integrity..." : "🔒 Verify Hash Chain Integrity"}
          </button>
        )}
      </div>

      {verifyMutation.data && (
        <div
          className={`rounded-2xl border p-4 text-sm font-semibold shadow-glow ${
            verifyMutation.data.valid
              ? "border-emerald-500/40 bg-emerald-950/50 text-emerald-300"
              : "border-rose-500/40 bg-rose-950/50 text-rose-300"
          }`}
        >
          {verifyMutation.data.valid
            ? `✓ Cryptographic audit chain verified — ${verifyMutation.data.totalEntries} entries checked, zero tampering detected.`
            : `✗ Audit chain integrity break detected at sequence #${verifyMutation.data.brokenAtSequence}!`}
        </div>
      )}

      <div className="glass-card rounded-2xl overflow-hidden border border-slate-800 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-900/90 text-xs uppercase font-bold tracking-wider text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-5 py-4">Seq #</th>
                <th className="px-5 py-4">Action Event</th>
                <th className="px-5 py-4">Target Entity</th>
                <th className="px-5 py-4">Triggered By User</th>
                <th className="px-5 py-4">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-medium">
              {isLoading && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-slate-400">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                      Loading audit logs...
                    </span>
                  </td>
                </tr>
              )}

              {data?.items.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-slate-400 font-normal">
                    No audit records logged yet.
                  </td>
                </tr>
              )}

              {data?.items.map((entry) => (
                <tr key={entry.sequence} className="hover:bg-slate-800/40 transition-colors duration-150">
                  <td className="px-5 py-3.5 font-mono text-xs font-bold text-indigo-400">#{entry.sequence}</td>
                  <td className="px-5 py-3.5">
                    <span className="rounded-lg bg-slate-800 px-2.5 py-1 font-mono text-xs font-semibold text-white">
                      {entry.action}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-xs">
                    <span className="text-slate-400">{entry.entityType}: </span>
                    <span className="font-mono text-slate-200 font-semibold">{entry.entityId}</span>
                  </td>
                  <td className="px-5 py-3.5 text-xs text-slate-300">
                    {entry.userId?.name ? (
                      <span className="font-semibold text-slate-200">{entry.userId.name}</span>
                    ) : (
                      <span className="text-slate-500 italic">System Engine</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-xs text-slate-400 font-mono">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
