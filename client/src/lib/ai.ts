export async function fetchLatestWeeklyOps() {
  const res = await fetch(`/api/ai/latest?type=weekly_ops`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load latest report");
  return res.json();
}

export async function generateWeeklyOps() {
  const res = await fetch(`/api/ai/weekly-ops-report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to generate report");
  return res.json();
}
