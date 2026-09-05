import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { RiskBadge } from "@/components/StatusBadge";

interface UploadRecord {
  id: string;
  filename: string;
  source: "csv" | "json" | "generated";
  status: "processing" | "completed" | "failed";
  totalRows: number;
  insertedCount: number;
  duplicateCount: number;
  invalidCount: number;
  sampleErrors: { row: number; message: string }[];
  createdAt: string;
  uploadedBy?: { name: string; email: string };
}

interface GenerateResponse {
  upload: UploadRecord;
  scenarioCounts: Record<string, number>;
}

interface BatchAnalyzeResult {
  totalAnalyzed: number;
  byRiskLevel: { LOW: number; MEDIUM: number; HIGH: number; CRITICAL: number };
  failedTransactionIds: string[];
  mlAvailable: boolean;
}

async function fetchUploadHistory(): Promise<UploadRecord[]> {
  const { data } = await apiClient.get<{ uploads: UploadRecord[] }>("/transactions/uploads");
  return data.uploads;
}

async function generateSampleData(transactionCount: number): Promise<GenerateResponse> {
  const { data } = await apiClient.post<GenerateResponse>("/transactions/generate-sample", {
    transactionCount,
  });
  return data;
}

async function uploadFile(file: File): Promise<{ upload: UploadRecord }> {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await apiClient.post<{ upload: UploadRecord }>("/transactions/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

async function analyzeUpload(uploadId: string): Promise<BatchAnalyzeResult> {
  const { data } = await apiClient.post<{ result: BatchAnalyzeResult }>("/risk/analyze-batch", { uploadId });
  return data.result;
}

export function DataIngestionPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [transactionCount, setTransactionCount] = useState(200);
  const [lastResult, setLastResult] = useState<{ kind: "generate" | "upload"; data: UploadRecord } | null>(null);
  const [scenarioCounts, setScenarioCounts] = useState<Record<string, number> | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<BatchAnalyzeResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ["uploads"],
    queryFn: fetchUploadHistory,
  });

  const analyzeMutation = useMutation({
    mutationFn: analyzeUpload,
    onSuccess: (result) => {
      setAnalysisResult(result);
      setAnalysisError(null);
    },
    onError: (err: any) => {
      setAnalysisError(err?.response?.data?.error?.message || "Risk analysis failed.");
    },
  });

  const generateMutation = useMutation({
    mutationFn: () => generateSampleData(transactionCount),
    onSuccess: (data) => {
      setLastResult({ kind: "generate", data: data.upload });
      setScenarioCounts(data.scenarioCounts);
      setUploadError(null);
      setAnalysisResult(null);
      queryClient.invalidateQueries({ queryKey: ["uploads"] });
      analyzeMutation.mutate(data.upload.id);
    },
    onError: (err: any) => {
      setUploadError(err?.response?.data?.error?.message || "Failed to generate sample data.");
    },
  });

  const uploadMutation = useMutation({
    mutationFn: uploadFile,
    onSuccess: (data) => {
      setLastResult({ kind: "upload", data: data.upload });
      setScenarioCounts(null);
      setUploadError(null);
      setAnalysisResult(null);
      queryClient.invalidateQueries({ queryKey: ["uploads"] });
      if (fileInputRef.current) fileInputRef.current.value = "";
      analyzeMutation.mutate(data.upload.id);
    },
    onError: (err: any) => {
      setUploadError(err?.response?.data?.error?.message || "Upload failed.");
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate(file);
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-8">
      <div className="border-b border-slate-800/80 pb-5">
        <h1 className="text-2xl font-black tracking-tight text-white">Data Ingestion & Synthetic Generator</h1>
        <p className="mt-1 text-sm text-slate-400">
          Populate the risk engine with synthetic payment datasets covering 10 real-world fraud scenarios or upload CSV/JSON files.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Synthetic Generator Panel */}
        <div className="glass-card rounded-2xl p-6 flex flex-col justify-between border border-slate-800 shadow-lg">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400 text-lg">
                ⚡
              </span>
              <div>
                <h2 className="text-base font-bold text-white">Synthetic Fraud Generator</h2>
                <p className="text-xs text-slate-400">Generates 10 attack scenarios automatically</p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <label className="block text-xs font-semibold uppercase text-slate-400">Preset Volume</label>
              <div className="grid grid-cols-3 gap-2">
                {[100, 200, 500].map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setTransactionCount(count)}
                    className={`rounded-xl border px-3 py-2 text-xs font-bold transition ${
                      transactionCount === count
                        ? "bg-indigo-600 text-white border-indigo-500 shadow-glow"
                        : "bg-slate-900/80 border-slate-700 text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    {count} Txns
                  </button>
                ))}
              </div>

              <div className="mt-3">
                <label className="block text-xs font-semibold uppercase text-slate-400">Custom Count</label>
                <input
                  type="number"
                  min={100}
                  max={50000}
                  value={transactionCount}
                  onChange={(e) => setTransactionCount(Number(e.target.value))}
                  className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-mono text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          <button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            className="mt-6 w-full rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 py-3 text-sm font-bold text-white shadow-glow hover:opacity-90 transition disabled:opacity-50"
          >
            {generateMutation.isPending ? "⏳ Generating & Ingesting..." : "🚀 Generate Synthetic Dataset"}
          </button>
        </div>

        {/* File Upload Panel */}
        <div className="glass-card rounded-2xl p-6 flex flex-col justify-between border border-slate-800 shadow-lg">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 text-lg">
                📁
              </span>
              <div>
                <h2 className="text-base font-bold text-white">Upload Custom Dataset</h2>
                <p className="text-xs text-slate-400">Supports .CSV and .JSON files</p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border-2 border-dashed border-slate-700 bg-slate-900/50 p-6 text-center">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.json"
                onChange={handleFileChange}
                disabled={uploadMutation.isPending}
                className="hidden"
                id="file-upload-input"
              />
              <label htmlFor="file-upload-input" className="cursor-pointer space-y-2 block">
                <span className="text-3xl block">📤</span>
                <span className="text-xs font-bold text-indigo-400 block hover:underline">
                  Click to select CSV/JSON file
                </span>
                <span className="text-[11px] text-slate-500 block">Strict schema validation & deduplication enforced</span>
              </label>
            </div>
          </div>

          {uploadMutation.isPending && (
            <div className="mt-4 text-center text-xs font-semibold text-emerald-400 animate-pulse">
              ⏳ Ingesting and validating file rows...
            </div>
          )}
        </div>
      </div>

      {uploadError && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-950/50 p-4 text-sm font-semibold text-rose-300">
          ⚠️ {uploadError}
        </div>
      )}

      {/* Ingestion Results & Scenarios Breakdown */}
      {lastResult && (
        <div className="glass-card rounded-2xl p-6 border border-slate-800 space-y-6">
          <h2 className="text-lg font-bold text-white">
            Results for: <span className="font-mono text-indigo-300">{lastResult.data.filename}</span>
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Total Rows" value={lastResult.data.totalRows} />
            <StatCard label="Inserted" value={lastResult.data.insertedCount} tone="text-emerald-400" />
            <StatCard label="Duplicates" value={lastResult.data.duplicateCount} tone="text-amber-400" />
            <StatCard label="Invalid" value={lastResult.data.invalidCount} tone="text-rose-400" />
          </div>

          {scenarioCounts && Object.keys(scenarioCounts).length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Generated Fraud Scenarios Breakdown</h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(scenarioCounts).map(([scenario, count]) => (
                  <span
                    key={scenario}
                    className="rounded-xl border border-indigo-500/30 bg-indigo-950/50 px-3 py-1.5 text-xs font-bold text-indigo-300"
                  >
                    ⚡ {scenario.replace(/_/g, " ")}: <strong className="text-white">{count}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}

          {analysisResult && (
            <div className="border-t border-slate-800 pt-5 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Risk Engine Execution Output</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <RiskLevelStat label="Low Risk" count={analysisResult.byRiskLevel.LOW} tone="border-emerald-500/30 bg-emerald-950/40 text-emerald-300" />
                <RiskLevelStat label="Medium Risk" count={analysisResult.byRiskLevel.MEDIUM} tone="border-amber-500/30 bg-amber-950/40 text-amber-300" />
                <RiskLevelStat label="High Risk" count={analysisResult.byRiskLevel.HIGH} tone="border-orange-500/30 bg-orange-950/40 text-orange-300" />
                <RiskLevelStat label="Critical Threat" count={analysisResult.byRiskLevel.CRITICAL} tone="border-rose-500/40 bg-rose-950/50 text-rose-300 shadow-glow-red" />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Upload History Table */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-white">Ingestion History Log</h2>
        <div className="glass-card rounded-2xl overflow-hidden border border-slate-800 shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-900/90 text-xs uppercase font-bold tracking-wider text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-5 py-4">Filename</th>
                  <th className="px-5 py-4">Source</th>
                  <th className="px-5 py-4">Status</th>
                  <th className="px-5 py-4">Inserted</th>
                  <th className="px-5 py-4">Duplicates</th>
                  <th className="px-5 py-4">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {historyLoading && (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-slate-400">
                      Loading upload history...
                    </td>
                  </tr>
                )}
                {history?.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-5 py-3.5 font-mono text-xs font-bold text-indigo-300">{u.filename}</td>
                    <td className="px-5 py-3.5 text-xs text-slate-400 uppercase font-semibold">{u.source}</td>
                    <td className="px-5 py-3.5">
                      <span className="rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 text-xs font-bold text-emerald-400">
                        {u.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-bold text-white">{u.insertedCount}</td>
                    <td className="px-5 py-3.5 text-slate-400">{u.duplicateCount}</td>
                    <td className="px-5 py-3.5 text-xs text-slate-400 font-mono">
                      {new Date(u.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, tone = "text-white" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-black mt-1 ${tone}`}>{value.toLocaleString()}</p>
    </div>
  );
}

function RiskLevelStat({ label, count, tone }: { label: string; count: number; tone: string }) {
  return (
    <div className={`rounded-xl border p-3 text-center ${tone}`}>
      <p className="text-xl font-black">{count.toLocaleString()}</p>
      <p className="text-xs font-semibold uppercase tracking-wider mt-0.5">{label}</p>
    </div>
  );
}
