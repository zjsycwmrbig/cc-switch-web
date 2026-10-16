import { createContext, useContext } from "react";
import type { Me } from "./client";

export const UnitSession = createContext<{
  me: Me;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  reset: () => void;
} | null>(null);
export const useUnitSession = () => useContext(UnitSession);
