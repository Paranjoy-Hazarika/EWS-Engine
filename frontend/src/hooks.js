import { useEffect, useState } from "react";
import { api } from "./api.js";

// Scoring rules are fetched once and used to colour vitals on screen.
export function useRules() {
  const [rules, setRules] = useState([]);
  useEffect(() => { api.listScoringRules().then(setRules).catch(() => {}); }, []);
  return rules;
}
