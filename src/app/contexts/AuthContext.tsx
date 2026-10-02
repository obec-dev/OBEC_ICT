"use client";

/**
 * Legacy Supabase Auth context — unused by the IctStore portal session.
 * Kept as a no-op stub so accidental imports do not trigger profiles.select('*')
 * egress. Portal auth lives in contexts/IctStore.tsx.
 */

import { createContext, useContext, type ReactNode } from "react";

type UserRole = {
  personal_role: string;
  has_school_admin: boolean;
  sub_role: string;
  school_id: string | null;
  district_id: string | null;
};

type UserProfile = {
  full_name: string | null;
  sub_role: string | null;
  school_id: string | null;
  district_id: string | null;
  personal_role: string;
};

type AuthContextType = {
  user: null;
  profile: UserProfile | null;
  currentRole: string | null;
  userRoles: UserRole | null;
  setCurrentRole: (role: string) => void;
  loading: boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const value: AuthContextType = {
    user: null,
    profile: null,
    currentRole: null,
    userRoles: null,
    setCurrentRole: () => {
      /* retired — use IctStore */
    },
    loading: false,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
