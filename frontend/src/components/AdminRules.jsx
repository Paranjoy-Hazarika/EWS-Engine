import React, { useEffect, useState } from "react";
import { api } from "../api.js";

export default function AdminRules() {
  const [rules, setRules] = useState([]);
  const [error, setError] = useState(null);
  const [savedId, setSavedId] = useState(null);

  const load = () => api.listScoringRules().then((r) => { setRules(r); setError(null); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const edit = (id, field, value) => setRules((rs) => rs.map((r) => (r.rule_id === id ? { ...r, [field]: value } : r)));
  const save = async (r) => {
    try {
      await api.updateScoringRule(r.rule_id, { range_min: Number(r.range_min), range_max: Number(r.range_max), score: Number(r.score) });
      setSavedId(r.rule_id); setTimeout(() => setSavedId(null), 2000); load();
    } catch (e) { setError(e.message); }
  };

  const groups = rules.reduce((acc, r) => { (acc[r.parameter_name] = acc[r.parameter_name] || []).push(r); return acc; }, {});

  return (
    <section>
      <header className="page-head">
        <h1>Scoring rules</h1>
        <p className="sub">These rows are the whole clinical logic. Change a range or its points and the next reading is scored with it. No code change needed.</p>
      </header>
      {error && <div className="error">{error}</div>}
      <div className="rule-grid">
        {Object.entries(groups).map(([name, rows]) => (
          <div key={name} className="card">
            <div className="card-title">{name}</div>
            <table className="rule-table">
              <thead><tr><th>From</th><th>To</th><th>Points</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.rule_id}>
                    <td><input value={r.range_min} onChange={(e) => edit(r.rule_id, "range_min", e.target.value)} /></td>
                    <td><input value={r.range_max} onChange={(e) => edit(r.rule_id, "range_max", e.target.value)} /></td>
                    <td><input value={r.score} onChange={(e) => edit(r.rule_id, "score", e.target.value)} /></td>
                    <td><button className="btn ghost small" onClick={() => save(r)}>Save</button>{savedId === r.rule_id && <span className="saved">Saved</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  );
}
