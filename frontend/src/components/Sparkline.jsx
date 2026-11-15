import React from "react";

export default function Sparkline({ values, color, width = 132, height = 40 }) {
  if (!values || values.length === 0) return <svg width={width} height={height} aria-hidden="true" />;
  const max = Math.max(10, ...values);
  const n = values.length;
  const x = (i) => (n === 1 ? width / 2 : 5 + (i * (width - 10)) / (n - 1));
  const y = (v) => height - 5 - (v / max) * (height - 10);
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  return (
    <svg width={width} height={height} role="img" aria-label={`Recent scores: ${values.join(", ")}`}>
      <line x1="0" x2={width} y1={y(7)} y2={y(7)} stroke="#d3dde4" strokeDasharray="3 3" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(n - 1)} cy={y(values[n - 1])} r="4" fill={color} />
    </svg>
  );
}
