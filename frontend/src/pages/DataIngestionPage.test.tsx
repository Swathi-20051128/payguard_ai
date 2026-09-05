import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { apiClient } from "@/lib/apiClient";
import { DataIngestionPage } from "@/pages/DataIngestionPage";

vi.mock("@/lib/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DataIngestionPage />
    </QueryClientProvider>
  );
}

describe("DataIngestionPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { uploads: [] } });
  });

  it("shows an empty state when there is no upload history", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/no uploads yet/i)).toBeInTheDocument());
  });

  it("renders upload history rows once loaded", async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: {
        uploads: [
          {
            id: "u1",
            filename: "transactions_master.csv",
            source: "csv",
            status: "completed",
            totalRows: 100,
            insertedCount: 95,
            duplicateCount: 3,
            invalidCount: 2,
            sampleErrors: [],
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });

    renderPage();

    await waitFor(() => expect(screen.getByText("transactions_master.csv")).toBeInTheDocument());
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("generates sample data and displays the result summary", async () => {
    (apiClient.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        data: {
          upload: {
            id: "u2",
            filename: "generated-2000-transactions",
            source: "generated",
            status: "completed",
            totalRows: 2000,
            insertedCount: 2000,
            duplicateCount: 0,
            invalidCount: 0,
            sampleErrors: [],
            createdAt: new Date().toISOString(),
          },
          scenarioCounts: { CARD_TESTING: 12, VELOCITY_ABUSE: 20 },
        },
      })
      .mockResolvedValueOnce({
        data: {
          result: {
            totalAnalyzed: 2000,
            byRiskLevel: { LOW: 1800, MEDIUM: 120, HIGH: 60, CRITICAL: 20 },
            failedTransactionIds: [],
            mlAvailable: true,
          },
        },
      });

    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /generate sample data/i }));

    await waitFor(() => {
      expect(screen.getByText(/generation result/i)).toBeInTheDocument();
    });
    expect(screen.getAllByText("2,000").length).toBeGreaterThanOrEqual(2); // at least totalRows and insertedCount
    expect(screen.getByText(/card testing: 12/i)).toBeInTheDocument();

    // The batch is automatically scored right after generation — no
    // separate manual step should be needed to see risk results.
    await waitFor(() => {
      expect(screen.getByText(/scored/i)).toBeInTheDocument();
    });
    expect(apiClient.post).toHaveBeenCalledWith("/risk/analyze-batch", { uploadId: "u2" });
    expect(screen.getByText("20")).toBeInTheDocument(); // CRITICAL count
  });

  it("shows a server error message when generation fails", async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      response: { data: { error: { message: "Something went wrong generating data" } } },
    });

    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /generate sample data/i }));

    await waitFor(() => {
      expect(screen.getByText("Something went wrong generating data")).toBeInTheDocument();
    });
  });

  it("shows an analysis error if the auto-triggered batch analysis fails, without hiding the generation result", async () => {
    (apiClient.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        data: {
          upload: {
            id: "u3",
            filename: "generated-500-transactions",
            source: "generated",
            status: "completed",
            totalRows: 500,
            insertedCount: 500,
            duplicateCount: 0,
            invalidCount: 0,
            sampleErrors: [],
            createdAt: new Date().toISOString(),
          },
          scenarioCounts: {},
        },
      })
      .mockRejectedValueOnce({
        response: { data: { error: { message: "Risk analysis service unavailable" } } },
      });

    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /generate sample data/i }));

    await waitFor(() => {
      expect(screen.getByText(/generation result/i)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("Risk analysis service unavailable")).toBeInTheDocument();
    });
    // The generation result itself should still be visible even though scoring failed.
    expect(screen.getByText(/generated-500-transactions/)).toBeInTheDocument();
  });
});
