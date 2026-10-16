export const clone = (value) =>
  value == null ? value : JSON.parse(JSON.stringify(value));
const dayISO = (start, i) => {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
};
export function extract(snapshot) {
  const s = snapshot?.privateContent;
  const result = {};
  if (!s?.days) return result;
  result.preferences = {
    key: "preferences",
    type: "preferences",
    data: { weeklyDays: s.weeklyDays || 4 },
  };
  const start = s.weekStart || "2026-10-12";
  const addPlan = (d, date) => {
    const key = `plan:${date}`;
    result[key] = {
      key,
      type: "plan",
      date,
      data: {
        title: d.title,
        kind: d.kind,
        parts: d.parts || [],
        minutes: d.minutes,
        icon: d.icon || "dumbbell",
      },
    };
  };
  s.days.forEach((d, i) => {
    const date = dayISO(start, i);
    addPlan(d, date);
    const sessions = Array.isArray(d.sessions)
      ? d.sessions
      : d.record
        ? [{ ...d.record, id: `legacy-${i}`, sets: d.sets || [] }]
        : [];
    for (const r of sessions) {
      const key = `workout:${date}:${r.id}`;
      result[key] = {
        key,
        type: "workout",
        date,
        data: {
          ...clone(r),
          effort: r.effort || "",
          parts: r.parts || [],
          sets: r.sets || [],
        },
      };
    }
  });
  if (s.nextWeek)
    s.nextWeek.forEach((d, i) => addPlan(d, dayISO(start, i + 7)));
  return result;
}
export function queueDiff(meta, oldDocs, newDocs, uuid) {
  for (const key of new Set([
    ...Object.keys(oldDocs),
    ...Object.keys(newDocs),
  ])) {
    if (JSON.stringify(oldDocs[key]) === JSON.stringify(newDocs[key])) continue;
    const value = newDocs[key] || oldDocs[key];
    const existing = meta.pending[key];
    meta.pending[key] = {
      ...clone(value),
      id: uuid(),
      baseRevision: existing?.baseRevision ?? meta.revisions[key] ?? 0,
      deleted: !newDocs[key],
      workoutId: value.type === "workout" ? value.data.id : undefined,
    };
    delete meta.conflicts[key];
  }
}
export function acknowledge(meta, sent, results) {
  for (const r of results) {
    const op = sent.find((s) => s.id === r.id);
    if (!op) continue;
    if (r.conflict) {
      if (meta.pending[r.key]?.id === r.id)
        meta.conflicts[r.key] = { local: op, remote: r.remote };
      continue;
    }
    meta.revisions[r.key] = r.revision;
    if (meta.pending[r.key]?.id === r.id) delete meta.pending[r.key];
    else if (meta.pending[r.key]) meta.pending[r.key].baseRevision = r.revision;
  }
}
export function resolveConflict(meta, key, choice, uuid) {
  const conflict = meta.conflicts[key];
  if (!conflict) return;
  meta.revisions[key] = conflict.remote?.revision || 0;
  if (choice === "local")
    meta.pending[key] = {
      ...meta.pending[key],
      id: uuid(),
      baseRevision: meta.revisions[key],
    };
  else delete meta.pending[key];
  delete meta.conflicts[key];
}
export function applyRecords(snapshot, records, pending = {}) {
  const next = clone(snapshot);
  if (!next?.privateContent?.days) return next;
  const s = next.privateContent,
    start = s.weekStart || "2026-10-12";
  const docs = {};
  for (const r of records) docs[r.key] = r;
  for (const p of Object.values(pending)) docs[p.key] = p;
  const prefs = docs.preferences;
  if (prefs && !prefs.deleted) s.weeklyDays = prefs.data.weeklyDays;
  s.days.forEach((d, i) => {
    const date = dayISO(start, i),
      plan = docs[`plan:${date}`];
    if (plan && !plan.deleted) Object.assign(d, clone(plan.data));
    const entries = Object.values(docs)
      .filter((r) => r.type === "workout" && r.date === date && !r.deleted)
      .map((r) => clone(r.data));
    entries.sort(
      (a, b) =>
        (a.recordedAt || 0) - (b.recordedAt || 0) || a.id.localeCompare(b.id),
    );
    d.sessions = entries;
    if (entries.length) {
      const parts = [
        ...new Set(
          entries.flatMap((r) => (r.parts.length ? r.parts : [r.title])),
        ),
      ];
      d.record = {
        title: parts.join("＋"),
        parts,
        kind: entries.length === 1 ? entries[0].kind : "混合",
        minutes: Number(entries.reduce((n, r) => n + r.minutes, 0).toFixed(2)),
        status: entries.some((r) => r.status === "部分完成")
          ? "部分完成"
          : "完整完成",
        effort: entries.length === 1 ? entries[0].effort : "",
        sessionCount: entries.length,
      };
    } else delete d.record;
    // In-progress sets/timer remain device-local; do not replace them with another device's session.
    if (!(s.timer?.day === i && !s.timer.saved) && !d.newSession)
      d.sets = entries.at(-1)?.sets || [];
  });
  const upcoming = Array.from(
    { length: 7 },
    (_, i) => docs[`plan:${dayISO(start, i + 7)}`],
  );
  if (upcoming.every((r) => r && !r.deleted))
    s.nextWeek = upcoming.map((r) => clone(r.data));
  next.modelContent = null;
  return next;
}
