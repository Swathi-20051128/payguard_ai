import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { apiClient } from "@/lib/apiClient";
import { AuthProvider } from "@/lib/AuthContext";

vi.mock("@/lib/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}));

function renderProtected(allowedRoles?: ("admin" | "analyst" | "viewer")[]) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<div>Login page</div>} />
          <Route
            path="/"
            element={
              <ProtectedRoute allowedRoles={allowedRoles}>
                <div>Protected content</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe("ProtectedRoute", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("redirects to /login when there is no authenticated user", async () => {
    renderProtected();
    await waitFor(() => expect(screen.getByText("Login page")).toBeInTheDocument());
  });

  it("renders children for an authenticated user with no role restriction", async () => {
    localStorage.setItem("payguard_token", "tok");
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { user: { id: "u1", name: "Jane", email: "jane@example.com", role: "viewer", isActive: true } },
    });

    renderProtected();
    await waitFor(() => expect(screen.getByText("Protected content")).toBeInTheDocument());
  });

  it("blocks a user whose role is not in allowedRoles", async () => {
    localStorage.setItem("payguard_token", "tok");
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { user: { id: "u1", name: "Jane", email: "jane@example.com", role: "viewer", isActive: true } },
    });

    renderProtected(["admin"]);
    await waitFor(() => expect(screen.getByText(/access restricted/i)).toBeInTheDocument());
  });
});
