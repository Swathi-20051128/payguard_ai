import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { apiClient } from "@/lib/apiClient";
import { AuthProvider, useAuth } from "@/lib/AuthContext";

vi.mock("@/lib/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}));

function TestConsumer() {
  const { user, isLoading, login, logout } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="user">{user ? user.email : "none"}</span>
      <button onClick={() => login("jane@example.com", "pw")}>login</button>
      <button onClick={logout}>logout</button>
    </div>
  );
}

describe("AuthContext", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("starts with no user and finishes loading when there is no stored token", async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("user").textContent).toBe("none");
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it("restores the session from /auth/me when a token is already stored", async () => {
    localStorage.setItem("payguard_token", "existing.token");
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { user: { id: "u1", name: "Jane", email: "jane@example.com", role: "analyst", isActive: true } },
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("jane@example.com"));
  });

  it("logs in successfully and stores the token", async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { token: "new.token", user: { id: "u1", name: "Jane", email: "jane@example.com", role: "viewer", isActive: true } },
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));

    await act(async () => {
      screen.getByText("login").click();
    });

    await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("jane@example.com"));
    expect(localStorage.getItem("payguard_token")).toBe("new.token");
  });

  it("clears the token and user on logout", async () => {
    localStorage.setItem("payguard_token", "existing.token");
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { user: { id: "u1", name: "Jane", email: "jane@example.com", role: "viewer", isActive: true } },
    });
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: {} });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("jane@example.com"));

    await act(async () => {
      screen.getByText("logout").click();
    });

    expect(screen.getByTestId("user").textContent).toBe("none");
    expect(localStorage.getItem("payguard_token")).toBeNull();
  });
});
