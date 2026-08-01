"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// Global admin-mode toggle. Press ⌘A (Ctrl+A on non-Mac) to flip it; a badge
// shows in the top-right while it's on, and any component under the provider can
// read the flag via useAdminMode(). State persists in localStorage so it
// survives reloads.
const STORAGE_KEY = "adminMode";

const AdminModeContext = createContext(false);

export function useAdminMode(): boolean {
  return useContext(AdminModeContext);
}

export function AdminModeProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState(false);

  // Restore persisted state on mount (client-only, so no hydration mismatch:
  // server and first client render both start false).
  useEffect(() => {
    try {
      setAdmin(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // localStorage can throw (private mode) — admin mode just starts off.
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘A on macOS, Ctrl+A elsewhere. Swallow the default select-all.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setAdmin((prev) => {
          const next = !prev;
          try {
            localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
          } catch {
            // ignore persistence failures
          }
          return next;
        });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <AdminModeContext.Provider value={admin}>
      {admin && (
        <div
          aria-live="polite"
          className="fixed right-4 top-4 z-50 select-none rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide text-white shadow-lg"
          style={{ background: "#c0392b", letterSpacing: "0.06em" }}
        >
          Admin Mode
        </div>
      )}
      {children}
    </AdminModeContext.Provider>
  );
}
