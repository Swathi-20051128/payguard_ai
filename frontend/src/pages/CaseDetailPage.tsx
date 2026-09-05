import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { apiClient } from "@/lib/apiClient";

interface CaseDetail {
  id: string;
  merchantId: string;
  riskScore: number;
  riskLevel: string;
  status: string;
  transactionIds: string[];
  recommendedAction: string;
  reviewerDecision?: string;
  reviewerComment?: string;
  reviewHoldActive: boolean;
  assignedTo?: { name: string; email: string } | null;
  createdBy?: { name: string; email: string } | null;
  alertIds: { reasons: string[]; riskScore: number; severity: string }[];
  createdAt: string;
}

async function fetchCase(caseId: string): Promise<CaseDetail> {
  const { data } = await apiClient.get<{ case: CaseDetail }>(`/cases/${caseId}`);
  return data.case;
}

export function CaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState("");
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [watchlistValue, setWatchlistValue] = useState("");
  const [watchlistType, setWatchlistType] = useState("device");

  const { data: caseData, isLoading } = useQuery({
    queryKey: ["case", caseId],
    queryFn: () => fetchCase(caseId!),
    enabled: !!caseId,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["case", caseId] });

  const decideMutation = useMutation({
    mutationFn: (decision: string) => apiClient.patch(`/cases/${caseId}/decision`, { decision, comment }),
    onSuccess: invalidate,
  });

  const actionMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post(`/cases/${caseId}/actions`, body),
    onSuccess: (res) => {
      setActionResult(res.data.result.message);
      invalidate();
    },
  });

  if (isLoading) return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  if (!caseData) return <div className="p-10 text-sm text-red-600">Case not found.</div>;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-xl font-semibold text-slate-900">Case {caseData.id}</h1>
      <p className="mt-1 text-sm text-slate-500">
        Merchant {caseData.merchantId} — {caseData.riskLevel} risk ({caseData.riskScore}/100)
      </p>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Status: {caseData.status.replace(/_/g, " ")}</h2>
        <p className="mt-1 text-sm text-slate-600">{caseData.recommendedAction}</p>
        {caseData.reviewHoldActive && (
          <p className="mt-2 text-xs font-medium text-amber-700">⚠ Simulated review hold is active on this case.</p>
        )}
        {caseData.reviewerDecision && (
          <p className="mt-2 text-xs text-slate-500">
            Decision: <strong>{caseData.reviewerDecision}</strong> — {caseData.reviewerComment}
          </p>
        )}
        <p className="mt-2 text-xs text-slate-400">Transactions: {caseData.transactionIds.join(", ")}</p>
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Evidence</h2>
        {caseData.alertIds.map((alert, i) => (
          <ul key={i} className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-700">
            {alert.reasons.map((r, j) => (
              <li key={j}>{r}</li>
            ))}
          </ul>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Reviewer decision</h2>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add a comment (optional)"
          className="mt-2 w-full rounded-lg border border-slate-300 p-2 text-sm"
          rows={2}
        />
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => decideMutation.mutate("confirmed_suspicious")}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
          >
            Confirm suspicious
          </button>
          <button
            onClick={() => decideMutation.mutate("escalated")}
            className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-700"
          >
            Escalate
          </button>
          <button
            onClick={() => decideMutation.mutate("dismissed")}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Dismiss
          </button>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Test-mode actions</h2>
        <p className="mt-1 text-xs text-slate-400">
          All actions below are simulated. No real payment is blocked, no real customer is contacted.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => actionMutation.mutate({ actionType: "request_verification" })}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50"
          >
            Request verification
          </button>
          <button
            onClick={() => actionMutation.mutate({ actionType: "review_hold" })}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50"
          >
            Place review hold
          </button>
          <button
            onClick={() => actionMutation.mutate({ actionType: "merchant_notification" })}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50"
          >
            Notify merchant
          </button>
          <button
            onClick={() => actionMutation.mutate({ actionType: "generate_report" })}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50"
          >
            Generate report
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <select
            value={watchlistType}
            onChange={(e) => setWatchlistType(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
          >
            <option value="device">Device</option>
            <option value="customer">Customer</option>
            <option value="cardToken">Card token</option>
            <option value="ipHash">IP hash</option>
            <option value="merchant">Merchant</option>
          </select>
          <input
            value={watchlistValue}
            onChange={(e) => setWatchlistValue(e.target.value)}
            placeholder="e.g. device_speci"
            className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
          />
          <button
            onClick={() =>
              actionMutation.mutate({
                actionType: "add_to_watchlist",
                watchlist: { entityType: watchlistType, entityValue: watchlistValue },
              })
            }
            disabled={!watchlistValue}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            Add to watchlist
          </button>
        </div>

        {actionResult && (
          <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-800">
            {actionResult}
          </div>
        )}
      </div>
    </div>
  );
}
