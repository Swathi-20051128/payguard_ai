import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { apiClient } from "@/lib/apiClient";
import { SystemStatusPage } from "@/pages/SystemStatusPage";

vi.mock("@/lib/apiClient", () => ({
  apiClient: { get: vi.fn() },
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("SystemStatusPage", () => {
  it("renders dependency statuses once the health check resolves", async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: {
        status: "ok",
        service: "payguard-backend",
        timestamp: new Date().toISOString(),
        dependencies: { mongodb: "up", mlService: "up" },
      },
    });

    renderWithClient(<SystemStatusPage />);

    expect(screen.getByText(/checking system status/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("MongoDB")).toBeInTheDocument();
    });

    expect(screen.getAllByText("UP")).toHaveLength(2);
  });

  it("shows a helpful error when the backend is unreachable", async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Network Error"));

    renderWithClient(<SystemStatusPage />);

    await waitFor(() => {
      expect(screen.getByText(/could not reach the backend api/i)).toBeInTheDocument();
    });
  });
});
