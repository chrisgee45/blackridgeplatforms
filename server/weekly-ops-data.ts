import { db } from "./db";
import { sql } from "drizzle-orm";

export type WeeklyOpsData = {
  generatedAt: string;
  leads: {
    totalLeads: number;
    newLeadsLast7Days: number;
    leadsInPipeline: number;
    leadsWon: number;
    leadsLost: number;
    pipelineValue: number;
    weightedForecast: number;
    staleLeads: number;
    overdueFollowups: number;
    bySource: Array<{ source: string; count: number; value: number }>;
    byStatus: Array<{ status: string; count: number }>;
  };
  projects: {
    totalProjects: number;
    activeProjects: number;
    completedProjects: number;
    totalContractValue: number;
    activeContractValue: number;
    waitingOnClient: number;
    stalledProjects: number;
    byStage: Array<{ stage: string; count: number; value: number }>;
  };
  revenue: {
    totalCollected: number;
    collectedLast30Days: number;
    pendingPayments: number;
    overduePayments: number;
    overdueAmount: number;
    upcomingDue7Days: number;
    upcomingDueAmount: number;
  };
  tasks: {
    totalOpen: number;
    overdueTasks: number;
    completedLast7Days: number;
    blockedTasks: number;
    waitingOnClientTasks: number;
    byPriority: Array<{ priority: string; count: number }>;
  };
  time: {
    totalMinutesLast7Days: number;
    billableMinutesLast7Days: number;
    billableRatio: number;
    topProjects: Array<{ projectName: string; minutes: number }>;
  };
  alerts: Array<{
    type: "stale_lead" | "overdue_payment" | "stalled_project" | "overdue_task" | "waiting_on_client";
    severity: "warning" | "critical";
    title: string;
    detail: string;
    entityId: string;
  }>;
};

function toNum(val: unknown): number {
  const n = typeof val === "string" ? Number(val) : (val as number);
  return Number.isFinite(n) ? n : 0;
}

async function queryRow(query: ReturnType<typeof sql>): Promise<Record<string, unknown>> {
  const result = await db.execute(query);
  return (result.rows?.[0] as Record<string, unknown>) ?? {};
}

async function queryRows(query: ReturnType<typeof sql>): Promise<Record<string, unknown>[]> {
  const result = await db.execute(query);
  return (result.rows as Record<string, unknown>[]) ?? [];
}

export async function getWeeklyOpsData(): Promise<WeeklyOpsData> {
  const totalLeadsRow = await queryRow(sql`
    SELECT COUNT(*)::int AS count FROM contact_submissions
  `);
  const newLeads7dRow = await queryRow(sql`
    SELECT COUNT(*)::int AS count FROM contact_submissions
    WHERE created_at >= (NOW() - INTERVAL '7 days')
  `);
  const pipelineRow = await queryRow(sql`
    SELECT COUNT(*)::int AS count,
           COALESCE(SUM(projected_value), 0)::bigint AS total_value,
           COALESCE(SUM(CASE WHEN projected_value IS NOT NULL AND close_probability IS NOT NULL
                        THEN projected_value * close_probability / 100 ELSE 0 END), 0)::bigint AS weighted
    FROM contact_submissions
    WHERE status NOT IN ('won', 'lost')
  `);
  const wonRow = await queryRow(sql`
    SELECT COUNT(*)::int AS count FROM contact_submissions WHERE status = 'won'
  `);
  const lostRow = await queryRow(sql`
    SELECT COUNT(*)::int AS count FROM contact_submissions WHERE status = 'lost'
  `);
  const staleLeadsRow = await queryRow(sql`
    SELECT COUNT(*)::int AS count FROM contact_submissions
    WHERE status NOT IN ('won', 'lost')
      AND (last_contacted_at IS NULL OR last_contacted_at < (NOW() - INTERVAL '24 hours'))
      AND created_at < (NOW() - INTERVAL '24 hours')
  `);
  const overdueFollowupsRow = await queryRow(sql`
    SELECT COUNT(*)::int AS count FROM contact_submissions
    WHERE follow_up_date IS NOT NULL AND follow_up_date < NOW()
      AND status NOT IN ('won', 'lost')
  `);

  const leadsBySource = await queryRows(sql`
    SELECT COALESCE(lead_source, 'unknown') AS source,
           COUNT(*)::int AS count,
           COALESCE(SUM(projected_value), 0)::bigint AS value
    FROM contact_submissions
    GROUP BY lead_source ORDER BY count DESC
  `);
  const leadsByStatus = await queryRows(sql`
    SELECT status, COUNT(*)::int AS count
    FROM contact_submissions GROUP BY status ORDER BY count DESC
  `);

  const totalProjectsRow = await queryRow(sql`
    SELECT COUNT(*)::int AS count FROM projects
  `);
  const activeProjectsRow = await queryRow(sql`
    SELECT COUNT(*)::int AS count,
           COALESCE(SUM(contract_value), 0)::bigint AS value
    FROM projects WHERE stage NOT IN ('completed', 'archived')
  `);
  const completedProjectsRow = await queryRow(sql`
    SELECT COUNT(*)::int AS count FROM projects WHERE stage = 'completed'
  `);
  const totalContractValueRow = await queryRow(sql`
    SELECT COALESCE(SUM(contract_value), 0)::bigint AS value FROM projects
  `);
  const waitingRow = await queryRow(sql`
    SELECT COUNT(*)::int AS count FROM projects
    WHERE waiting_on_client = true AND stage NOT IN ('completed', 'archived')
  `);
  const stalledRow = await queryRow(sql`
    SELECT COUNT(*)::int AS count FROM projects
    WHERE stage NOT IN ('completed', 'archived')
      AND stage_changed_at < (NOW() - INTERVAL '14 days')
  `);
  const projectsByStage = await queryRows(sql`
    SELECT stage, COUNT(*)::int AS count,
           COALESCE(SUM(contract_value), 0)::bigint AS value
    FROM projects GROUP BY stage ORDER BY count DESC
  `);

  const collectedTotalRow = await queryRow(sql`
    SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM project_payments WHERE status = 'received'
  `);
  const collected30dRow = await queryRow(sql`
    SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM project_payments
    WHERE status = 'received' AND received_date >= (NOW() - INTERVAL '30 days')
  `);
  const pendingPaymentsRow = await queryRow(sql`
    SELECT COUNT(*)::int AS count, COALESCE(SUM(amount), 0)::bigint AS total
    FROM project_payments WHERE status = 'pending'
  `);
  const overduePaymentsRow = await queryRow(sql`
    SELECT COUNT(*)::int AS count, COALESCE(SUM(amount), 0)::bigint AS total
    FROM project_payments
    WHERE status = 'pending' AND due_date IS NOT NULL AND due_date < NOW()
  `);
  const upcoming7dRow = await queryRow(sql`
    SELECT COUNT(*)::int AS count, COALESCE(SUM(amount), 0)::bigint AS total
    FROM project_payments
    WHERE status = 'pending' AND due_date IS NOT NULL
      AND due_date >= NOW() AND due_date <= (NOW() + INTERVAL '7 days')
  `);

  const openTasksRow = await queryRow(sql`
    SELECT COUNT(*)::int AS count FROM tasks WHERE status NOT IN ('done')
  `);
  const overdueTasksRow = await queryRow(sql`
    SELECT COUNT(*)::int AS count FROM tasks
    WHERE status NOT IN ('done') AND due_date IS NOT NULL AND due_date < NOW()
  `);
  const completed7dRow = await queryRow(sql`
    SELECT COUNT(*)::int AS count FROM tasks
    WHERE status = 'done' AND completed_at >= (NOW() - INTERVAL '7 days')
  `);
  const blockedTasksRow = await queryRow(sql`
    SELECT COUNT(*)::int AS count FROM tasks WHERE status = 'blocked'
  `);
  const waitingTasksRow = await queryRow(sql`
    SELECT COUNT(*)::int AS count FROM tasks WHERE status = 'waiting_on_client'
  `);
  const tasksByPriority = await queryRows(sql`
    SELECT priority, COUNT(*)::int AS count FROM tasks
    WHERE status NOT IN ('done') GROUP BY priority ORDER BY count DESC
  `);

  const time7dRow = await queryRow(sql`
    SELECT COALESCE(SUM(minutes), 0)::int AS total,
           COALESCE(SUM(CASE WHEN billable = true THEN minutes ELSE 0 END), 0)::int AS billable
    FROM time_entries WHERE date >= (NOW() - INTERVAL '7 days')
  `);
  const topTimeProjects = await queryRows(sql`
    SELECT p.name AS project_name, COALESCE(SUM(te.minutes), 0)::int AS minutes
    FROM time_entries te
    JOIN projects p ON p.id = te.project_id
    WHERE te.date >= (NOW() - INTERVAL '7 days')
    GROUP BY p.name ORDER BY minutes DESC LIMIT 5
  `);

  const alerts: WeeklyOpsData["alerts"] = [];

  const staleLeadDetails = await queryRows(sql`
    SELECT id::text, name, company, status FROM contact_submissions
    WHERE status NOT IN ('won', 'lost')
      AND (last_contacted_at IS NULL OR last_contacted_at < (NOW() - INTERVAL '48 hours'))
      AND created_at < (NOW() - INTERVAL '24 hours')
    ORDER BY created_at ASC LIMIT 10
  `);
  for (const l of staleLeadDetails) {
    alerts.push({
      type: "stale_lead",
      severity: "warning",
      title: `Stale lead: ${l.name}`,
      detail: `${l.company || "No company"} — status: ${l.status}`,
      entityId: l.id as string,
    });
  }

  const overduePaymentDetails = await queryRows(sql`
    SELECT pp.id::text, pp.label, pp.amount, pp.due_date::text AS due_date, p.name AS project_name
    FROM project_payments pp JOIN projects p ON p.id = pp.project_id
    WHERE pp.status = 'pending' AND pp.due_date IS NOT NULL AND pp.due_date < NOW()
    ORDER BY pp.due_date ASC LIMIT 10
  `);
  for (const p of overduePaymentDetails) {
    alerts.push({
      type: "overdue_payment",
      severity: "critical",
      title: `Overdue: $${(toNum(p.amount) / 100).toLocaleString()} — ${p.label}`,
      detail: `Project: ${p.project_name} — due ${String(p.due_date || "").split("T")[0] || "unknown"}`,
      entityId: p.id as string,
    });
  }

  const stalledProjectDetails = await queryRows(sql`
    SELECT id::text, name, stage, stage_changed_at::text AS stage_changed_at
    FROM projects
    WHERE stage NOT IN ('completed', 'archived')
      AND stage_changed_at < (NOW() - INTERVAL '14 days')
    ORDER BY stage_changed_at ASC LIMIT 10
  `);
  for (const p of stalledProjectDetails) {
    alerts.push({
      type: "stalled_project",
      severity: "warning",
      title: `Stalled: ${p.name}`,
      detail: `Stage "${p.stage}" since ${String(p.stage_changed_at || "").split("T")[0] || "unknown"}`,
      entityId: p.id as string,
    });
  }

  const overdueTaskDetails = await queryRows(sql`
    SELECT t.id::text, t.title, t.due_date::text AS due_date, p.name AS project_name
    FROM tasks t JOIN projects p ON p.id = t.project_id
    WHERE t.status NOT IN ('done') AND t.due_date IS NOT NULL AND t.due_date < NOW()
    ORDER BY t.due_date ASC LIMIT 10
  `);
  for (const t of overdueTaskDetails) {
    alerts.push({
      type: "overdue_task",
      severity: "warning",
      title: `Overdue task: ${t.title}`,
      detail: `Project: ${t.project_name} — due ${String(t.due_date || "").split("T")[0] || "unknown"}`,
      entityId: t.id as string,
    });
  }

  const waitingOnClientProjects = await queryRows(sql`
    SELECT id::text, name, blocker, blocker_since::text AS blocker_since
    FROM projects
    WHERE waiting_on_client = true AND stage NOT IN ('completed', 'archived')
    ORDER BY blocker_since ASC NULLS LAST LIMIT 10
  `);
  for (const p of waitingOnClientProjects) {
    alerts.push({
      type: "waiting_on_client",
      severity: "warning",
      title: `Waiting on client: ${p.name}`,
      detail: (p.blocker as string) || "No blocker description",
      entityId: p.id as string,
    });
  }

  const totalTime7d = toNum(time7dRow.total);
  const billableTime7d = toNum(time7dRow.billable);

  return {
    generatedAt: new Date().toISOString(),
    leads: {
      totalLeads: toNum(totalLeadsRow.count),
      newLeadsLast7Days: toNum(newLeads7dRow.count),
      leadsInPipeline: toNum(pipelineRow.count),
      leadsWon: toNum(wonRow.count),
      leadsLost: toNum(lostRow.count),
      pipelineValue: toNum(pipelineRow.total_value),
      weightedForecast: toNum(pipelineRow.weighted),
      staleLeads: toNum(staleLeadsRow.count),
      overdueFollowups: toNum(overdueFollowupsRow.count),
      bySource: leadsBySource.map(r => ({
        source: r.source as string, count: toNum(r.count), value: toNum(r.value),
      })),
      byStatus: leadsByStatus.map(r => ({
        status: r.status as string, count: toNum(r.count),
      })),
    },
    projects: {
      totalProjects: toNum(totalProjectsRow.count),
      activeProjects: toNum(activeProjectsRow.count),
      completedProjects: toNum(completedProjectsRow.count),
      totalContractValue: toNum(totalContractValueRow.value),
      activeContractValue: toNum(activeProjectsRow.value),
      waitingOnClient: toNum(waitingRow.count),
      stalledProjects: toNum(stalledRow.count),
      byStage: projectsByStage.map(r => ({
        stage: r.stage as string, count: toNum(r.count), value: toNum(r.value),
      })),
    },
    revenue: {
      totalCollected: toNum(collectedTotalRow.total),
      collectedLast30Days: toNum(collected30dRow.total),
      pendingPayments: toNum(pendingPaymentsRow.count),
      overduePayments: toNum(overduePaymentsRow.count),
      overdueAmount: toNum(overduePaymentsRow.total),
      upcomingDue7Days: toNum(upcoming7dRow.count),
      upcomingDueAmount: toNum(upcoming7dRow.total),
    },
    tasks: {
      totalOpen: toNum(openTasksRow.count),
      overdueTasks: toNum(overdueTasksRow.count),
      completedLast7Days: toNum(completed7dRow.count),
      blockedTasks: toNum(blockedTasksRow.count),
      waitingOnClientTasks: toNum(waitingTasksRow.count),
      byPriority: tasksByPriority.map(r => ({
        priority: r.priority as string, count: toNum(r.count),
      })),
    },
    time: {
      totalMinutesLast7Days: totalTime7d,
      billableMinutesLast7Days: billableTime7d,
      billableRatio: totalTime7d > 0 ? billableTime7d / totalTime7d : 0,
      topProjects: topTimeProjects.map(r => ({
        projectName: r.project_name as string, minutes: toNum(r.minutes),
      })),
    },
    alerts,
  };
}
