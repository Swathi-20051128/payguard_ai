import { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";

const ROLE_STYLES: Record<string, string> = {
  admin: "bg-purple-500/20 text-purple-300 border-purple-500/40 shadow-[0_0_10px_rgba(168,85,247,0.2)]",
  analyst: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-[0_0_10px_rgba(6,182,212,0.2)]",
  viewer: "bg-slate-700/50 text-slate-300 border-slate-600",
};

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${
      isActive
        ? "bg-indigo-600 text-white shadow-glow font-semibold"
        : "text-slate-300 hover:text-white hover:bg-slate-800/80"
    }`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-indigo-500 selection:text-white">
      <header className="sticky top-0 z-50 glass-panel border-b border-slate-800/80 shadow-lg">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 text-sm font-black text-white shadow-glow">
                PG
              </div>
              <div className="flex flex-col">
                <span className="text-base font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-200 to-indigo-200 bg-clip-text text-transparent">
                  PayGuard <span className="text-indigo-400">AI</span>
                </span>
                <span className="text-[10px] uppercase font-bold tracking-widest text-indigo-400">Risk Manager</span>
              </div>
            </div>

            {user && (
              <nav className="flex items-center gap-1.5">
                <NavLink to="/" className={navClass} end>
                  Dashboard
                </NavLink>
                <NavLink to="/transactions" className={navClass}>
                  Transactions
                </NavLink>
                <NavLink to="/alerts" className={navClass}>
                  Alerts
                </NavLink>
                <NavLink to="/cases" className={navClass}>
                  Cases
                </NavLink>
                <NavLink to="/audit" className={navClass}>
                  Audit
                </NavLink>
                {(user.role === "admin" || user.role === "analyst") && (
                  <NavLink to="/data" className={navClass}>
                    Data & Generator
                  </NavLink>
                )}
              </nav>
            )}
          </div>

          {user && (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2.5">
                <span className={`rounded-full border px-3 py-0.5 text-xs font-semibold uppercase tracking-wider ${ROLE_STYLES[user.role]}`}>
                  {user.role}
                </span>
                <span className="text-sm font-medium text-slate-200">{user.name}</span>
              </div>
              <button
                onClick={logout}
                className="rounded-lg border border-slate-700 bg-slate-800/80 px-3.5 py-1.5 text-xs font-semibold text-slate-300 transition-all hover:border-slate-600 hover:bg-slate-700 hover:text-white"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 pb-16">{children}</main>

      <footer className="border-t border-slate-800/60 bg-slate-950/80 py-4 text-center text-xs text-slate-500">
        PayGuard AI Risk Engine • Test Mode • Explainable Risk Management
      </footer>
    </div>
  );
}
