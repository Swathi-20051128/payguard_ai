import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { StatusBadge } from "@/components/StatusBadge";

interface HealthResponse {
  status: "ok" | "degraded";
  service: string;
  timestamp: string;
  dependencies: {
    mongodb: "up" | "down";
    mlService: "up" | "down";
  };
}

async function fetchHealth(): Promise<HealthResponse> {
  const { data } = await apiClient.get<HealthResponse>("/health");
  return data;
}

/**
 * Phase 1 landing page. This intentionally does real work — it polls
 * the live backend health endpoint (which itself checks Mongo and the
 * ML service) every 10s, so "docker compose up" + this page is a
 * genuine end-to-end smoke test of the whole stack, not a static shell.
 */
export function SystemStatusPage() {
  const { data, isLoading, isError, error, dataUpdatedAt } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    refetchInterval: 10_000,
  });

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-white font-bold">
          PG
        </div>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">PayGuard AI</h1>
          <p className="text-sm text-slate-500">Explainable AI Risk Manager — test-mode</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          System Status
        </h2>

        {isLoading && <p className="text-sm text-slate-500">Checking system status…</p>}

        {isError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Could not reach the backend API. Is it running on{" "}
            <code className="rounded bg-red-100 px-1">
              {import.meta.env.VITE_API_BASE_URL || "http://localhost:4000/api"}
            </code>
            ? ({(error as Error)?.message})
          </div>
        )}

        {data && (
          <div className="space-y-3">
            <Row label="API server">
              <StatusBadge status={data.status === "ok" ? "ok" : "degraded"} />
            </Row>
            <Row label="MongoDB">
              <StatusBadge status={data.dependencies.mongodb} />
            </Row>
            <Row label="ML service">
              <StatusBadge status={data.dependencies.mlService} />
            </Row>
            <p className="pt-2 text-xs text-slate-400">
              Last checked {new Date(dataUpdatedAt).toLocaleTimeString()}
            </p>
          </div>
        )}
      </div>

      <p className="mt-6 text-center text-xs text-slate-400">
        Defense-only test-mode system. No real payments are processed.
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0 last:pb-0">
      <span className="text-sm text-slate-600">{label}</span>
      {children}
    </div>
  );
}
