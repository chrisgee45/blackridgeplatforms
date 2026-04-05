import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, ListChecks } from "lucide-react";
import type { Task, Project } from "@shared/schema";

const STATUS_COLORS: Record<string, string> = {
  todo: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-500/15 text-blue-400",
  done: "bg-green-500/15 text-green-400",
  blocked: "bg-red-500/15 text-red-400",
  waiting_on_client: "bg-orange-500/15 text-orange-400",
};

const STATUS_LABELS: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  done: "Done",
  blocked: "Blocked",
  waiting_on_client: "Waiting",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-blue-500/15 text-blue-400",
  high: "bg-amber-500/15 text-amber-400",
  urgent: "bg-red-500/15 text-red-400",
};

function isOverdue(dateStr: string | Date | null | undefined): boolean {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date(new Date().toDateString());
}

function isDueToday(dateStr: string | Date | null | undefined): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const today = new Date();
  return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
}

function formatDate(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function TasksPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<Task[]>({
    queryKey: ["/api/ops/tasks"],
  });

  const { data: projects = [], isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ["/api/ops/projects"],
  });

  const projectMap = useMemo(() => {
    const map: Record<string, Project> = {};
    projects.forEach((p) => { map[p.id] = p; });
    return map;
  }, [projects]);

  const completeTaskMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const res = await apiRequest("PATCH", `/api/ops/tasks/${taskId}`, { status: "done" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/tasks"] });
      toast({ title: "Task marked as done" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (search && !task.title.toLowerCase().includes(search.toLowerCase())) return false;
      if (statusFilter !== "all" && task.status !== statusFilter) return false;
      if (priorityFilter !== "all" && task.priority !== priorityFilter) return false;
      return true;
    });
  }, [tasks, search, statusFilter, priorityFilter]);

  const isLoading = tasksLoading || projectsLoading;

  if (isLoading) {
    return (
      <div className="p-3 sm:p-6 space-y-4 sm:space-y-6" data-testid="tasks-loading">
        <div>
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-56 mt-2" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-36" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6" data-testid="tasks-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Tasks</h1>
        <p className="text-muted-foreground text-sm mt-1" data-testid="text-page-subtitle">Manage tasks across all projects</p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks..."
            className="pl-9"
            data-testid="input-search-tasks"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40" data-testid="select-status-filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="todo">To Do</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="done">Done</SelectItem>
            <SelectItem value="blocked">Blocked</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-40" data-testid="select-priority-filter">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-auto flex-1">
        {filteredTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="empty-state">
            <ListChecks className="w-10 h-10 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground text-sm">
              {tasks.length === 0 ? "No tasks yet" : "No tasks match your filters"}
            </p>
          </div>
        ) : (
          <div className="space-y-1" data-testid="tasks-list">
            {filteredTasks.map((task) => {
              const project = projectMap[task.projectId];
              const overdue = isOverdue(task.dueDate) && task.status !== "done";
              const dueToday = isDueToday(task.dueDate) && task.status !== "done";

              return (
                <div
                  key={task.id}
                  className="flex items-center gap-3 py-2.5 px-3 rounded-md border border-border/30 hover-elevate"
                  data-testid={`task-row-${task.id}`}
                >
                  <Checkbox
                    checked={task.status === "done"}
                    disabled={task.status === "done" || completeTaskMutation.isPending}
                    onCheckedChange={() => completeTaskMutation.mutate(task.id)}
                    data-testid={`checkbox-task-${task.id}`}
                  />
                  <span
                    className={`flex-1 text-sm min-w-0 truncate ${task.status === "done" ? "line-through text-muted-foreground" : ""}`}
                    data-testid={`text-task-title-${task.id}`}
                  >
                    {task.title}
                  </span>
                  {project && (
                    <Link href={`/admin/ops/projects/${project.id}`}>
                      <span
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer whitespace-nowrap"
                        data-testid={`link-project-${task.id}`}
                      >
                        {project.name}
                      </span>
                    </Link>
                  )}
                  <Badge className={PRIORITY_COLORS[task.priority] || ""} data-testid={`badge-priority-${task.id}`}>
                    {task.priority}
                  </Badge>
                  <Badge className={STATUS_COLORS[task.status] || ""} data-testid={`badge-status-${task.id}`}>
                    {STATUS_LABELS[task.status] || task.status}
                  </Badge>
                  {task.dueDate && (
                    <span
                      className={`text-xs whitespace-nowrap ${overdue ? "text-red-400" : dueToday ? "text-amber-400" : "text-muted-foreground"}`}
                      data-testid={`text-due-${task.id}`}
                    >
                      {formatDate(task.dueDate)}
                    </span>
                  )}
                  {task.assignedTo && (
                    <span className="text-xs text-muted-foreground whitespace-nowrap" data-testid={`text-assignee-${task.id}`}>
                      {task.assignedTo}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
