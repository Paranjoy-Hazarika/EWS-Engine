import React from "react";
import { TIER } from "../utils.js";

// Colour is never the only signal: each tier also has its own shape and words.
export default function TierBadge({ tier, big }) {
  if (!tier) return <span className="badge none">Not scored</span>;
  const t = TIER[tier];
  return (
    <span className={`badge ${big ? "big" : ""}`} style={{ background: t.tint, color: t.color, borderColor: t.color }}>
      <span aria-hidden="true">{t.glyph}</span> {t.text}
    </span>
  );
}
