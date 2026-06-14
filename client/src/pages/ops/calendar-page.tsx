import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { enablePush, pushPermission, pushSupported } from "@/lib/push";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  CheckSquare,
  Flag,
  Receipt,
  DollarSign,
  Search,
  Plus,
  X,
  Clock,
  MapPin,
  Bell,
  Phone,
  Users,
  Sparkles,
  AlertTriangle,
  Trash2,
  Save,
  BellOff,
  BellRing,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EventType =
  | "follow_up"
  | "task"
  | "milestone"
  | "bill"
  | "tax_payment"
  | "crm_event";

interface CalendarEvent {
  id: string;
  title: string;
  event_type: EventType;
  start: string;
  end: string;
  date?: string;
  all_day?: boolean;
  color?: string;
  detail?: string;
  project_name?: string;
  project_id?: string;
  vendor_name?: string;
  amount?: number | string;
  // crm_event extras
  crm_type?: "meeting" | "call" | "demo" | "follow_up" | "other";
  location?: string;
  notes?: string;
  lead_name?: string;
  lead_id?: string;
  reminder_minutes?: number | null;
}

type ViewMode = "day" | "week" | "month" | "agenda";

// ---------------------------------------------------------------------------
// Config + helpers
// ---------------------------------------------------------------------------

const VIEW_LABELS: Record<ViewMode, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  agenda: "Agenda",
};

const EVENT_TYPE_CONFIG: Record<
  EventType,
  { label: string; icon: typeof CalendarIcon; route: string; bg: string; text: string; ring: string }
> = {
  follow_up: { label: "Follow-up", icon: CalendarIcon, route: "/admin/ops/clients", bg: "bg-amber-500/15", text: "text-amber-300", ring: "ring-amber-500/40" },
  task: { label: "Task", icon: CheckSquare, route: "/admin/ops/tasks", bg: "bg-blue-500/15", text: "text-blue-300", ring: "ring-blue-500/40" },
  milestone: { label: "Milestone", icon: Flag, route: "/admin/ops/projects", bg: "bg-purple-500/15", text: "text-purple-300", ring: "ring-purple-500/40" },
  bill: { label: "Bill", icon: Receipt, route: "/admin/ops/expenses", bg: "bg-red-500/15", text: "text-red-300", ring: "ring-red-500/40" },
  tax_payment: { label: "Tax", icon: DollarSign, route: "/admin/ops/tax-center", bg: "bg-emerald-500/15", text: "text-emerald-300", ring: "ring-emerald-500/40" },
  crm_event: { label: "Meeting", icon: Users, route: "/admin", bg: "bg-cyan-500/15", text: "text-cyan-300", ring: "ring-cyan-500/40" },
};

const CRM_TYPE_ICONS = {
  meeting: Users,
  call: Phone,
  demo: Sparkles,
  follow_up: CalendarIcon,
  other: CalendarIcon,
};

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const REMINDER_OPTIONS = [
  { value: "", label: "No reminder" },
  { value: "15", label: "15 min before" },
  { value: "30", label: "30 min before" },
  { value: "60", label: "1 hour before" },
  { value: "120", label: "2 hours before" },
  { value: "1440", label: "1 day before" },
];

const HOUR_HEIGHT = 48;
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 21;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeek(d: Date) {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function endOfWeek(d: Date) {
  const x = startOfWeek(d);
  x.setDate(x.getDate() + 7);
  return x;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isSameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function fmtTime(date: Date) {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function fmtDay(date: Date) {
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function fmtRange(start: Date, end: Date) {
  if (isSameDay(start, end)) {
    return `${fmtTime(start)} – ${fmtTime(end)}`;
  }
  return `${fmtDay(start)} ${fmtTime(start)} – ${fmtDay(end)} ${fmtTime(end)}`;
}

function getMonthGridDays(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

function eventsOverlap(a: { start: Date; end: Date }, b: { start: Date; end: Date }) {
  return a.start < b.end && b.start < a.end;
}

function layoutColumns(items: { start: Date; end: Date; id: string }[]) {
  // Simple column packing: each event sits in the leftmost column where it
  // doesn't collide. Result: { col, totalCols } per id.
  const sorted = [...items].sort((a, b) => a.start.getTime() - b.start.getTime());
  const columns: { start: Date; end: Date; id: string }[][] = [];
  const placement: Record<string, { col: number }> = {};
  for (const ev of sorted) {
    let placed = false;
    for (let c = 0; c < columns.length; c++) {
      const last = columns[c][columns[c].length - 1];
      if (last.end <= ev.start) {
        columns[c].push(ev);
        placement[ev.id] = { col: c };
        placed = true;
        break;
      }
    }
    if (!placed) {
      columns.push([ev]);
      placement[ev.id] = { col: columns.length - 1 };
    }
  }
  // Compute totalCols overlapping per event
  const totalForId: Record<string, number> = {};
  for (const ev of items) {
    const overlapping = items.filter(o => eventsOverlap(ev, o));
    totalForId[ev.id] = Math.max(
      ...overlapping.map(o => placement[o.id].col + 1),
      1,
    );
  }
  return { placement, totalForId };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface CalendarProps {
  /** When set, scopes the calendar to a single lead's CRM events and
   *  auto-populates leadId on newly created events. */
  leadId?: string;
  /** Hide the page-level chrome (today strip, kbd hints). Use when embedded
   *  in a drawer / detail panel. */
  compact?: boolean;
  /** Initial view. Defaults to "week" at the top level, "agenda" when
   *  compact (works better in narrow containers). */
  defaultView?: ViewMode;
}

/** Thin wrapper used by the /admin/ops/calendar route. */
export default function CalendarPage() {
  return <Calendar />;
}

export function Calendar({ leadId, compact, defaultView }: CalendarProps = {}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const today = useMemo(() => new Date(), []);
  const [view, setView] = useState<ViewMode>(defaultView ?? (compact ? "agenda" : "week"));
  const [cursor, setCursor] = useState<Date>(startOfDay(today));
  const [search, setSearch] = useState("");
  const [hiddenTypes, setHiddenTypes] = useState<Set<EventType>>(new Set());
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [popover, setPopover] = useState<{
    anchor: { x: number; y: number };
    eventId: string | null;
    initial: Partial<CrmEventDraft>;
  } | null>(null);
  const [pushStatus, setPushStatus] = useState<NotificationPermission | "unsupported">(pushPermission());
  const [pushBusy, setPushBusy] = useState(false);

  // Pull a wide enough window to cover whichever view we're in.
  const { rangeStart, rangeEnd } = useMemo(() => computeRange(view, cursor), [view, cursor]);

  const eventsUrl = `/api/ops/calendar-events?startDate=${isoDate(rangeStart)}&endDate=${isoDate(rangeEnd)}${leadId ? `&leadId=${encodeURIComponent(leadId)}` : ""}`;
  const { data: events = [], isLoading } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/ops/calendar-events", isoDate(rangeStart), isoDate(rangeEnd), leadId ?? null],
    queryFn: async () => {
      const res = await fetch(eventsUrl);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter(e => {
      if (hiddenTypes.has(e.event_type)) return false;
      if (!q) return true;
      const hay = [
        e.title,
        e.project_name,
        e.vendor_name,
        e.lead_name,
        e.location,
        e.notes,
        e.detail,
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [events, hiddenTypes, search]);

  // Keyboard nav: T → today, ←/→ → step, D/W/M/A → switch view, / → focus search.
  // Disabled in compact / embedded mode so the host page's shortcuts win.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (compact) return;
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key.toLowerCase()) {
        case "t": setCursor(startOfDay(new Date())); break;
        case "d": setView("day"); break;
        case "w": setView("week"); break;
        case "m": setView("month"); break;
        case "a": setView("agenda"); break;
        case "arrowleft": case "j": setCursor(c => step(view, c, -1)); break;
        case "arrowright": case "k": setCursor(c => step(view, c, 1)); break;
        case "/": e.preventDefault(); searchRef.current?.focus(); break;
        case "escape":
          setSelectedEvent(null);
          setPopover(null);
          break;
        default: return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, compact]);

  // ── Mutations: create / update / delete CRM events
  const saveMutation = useMutation({
    mutationFn: async (draft: CrmEventDraft & { id?: string }) => {
      const body: Record<string, unknown> = {
        title: draft.title,
        type: draft.type,
        startAt: draft.startAt.toISOString(),
        endAt: draft.endAt ? draft.endAt.toISOString() : null,
        location: draft.location || null,
        notes: draft.notes || null,
        reminderMinutes: draft.reminderMinutes ?? null,
        status: "scheduled",
      };
      // Inherit lead binding when the calendar is scoped to a lead, but
      // only on create — don't reassign an existing event's lead silently.
      if (!draft.id && leadId) {
        body.leadId = leadId;
      }
      if (draft.id) {
        const res = await apiRequest("PATCH", `/api/crm/events/${draft.id}`, body);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/crm/events", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/calendar-events"] });
      toast({ title: "Saved" });
      setPopover(null);
      setSelectedEvent(null);
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/crm/events/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/calendar-events"] });
      toast({ title: "Event deleted" });
      setSelectedEvent(null);
      setPopover(null);
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const rescheduleMutation = useMutation({
    mutationFn: async (args: { id: string; startAt: Date; endAt: Date | null }) => {
      const res = await apiRequest("PATCH", `/api/crm/events/${args.id}`, {
        startAt: args.startAt.toISOString(),
        endAt: args.endAt ? args.endAt.toISOString() : null,
      });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/ops/calendar-events"] }),
    onError: (e: Error) => toast({ title: "Reschedule failed", description: e.message, variant: "destructive" }),
  });

  // Build the "today strip" — current and next events for today.
  const todayBand = useMemo(() => buildTodayBand(events), [events]);

  function handleEventClick(evt: CalendarEvent) {
    if (evt.event_type === "crm_event") {
      setSelectedEvent(evt);
    } else {
      navigate(EVENT_TYPE_CONFIG[evt.event_type].route);
    }
  }

  function openCreatePopover(anchor: { x: number; y: number }, start: Date, durationMin = 30) {
    setPopover({
      anchor,
      eventId: null,
      initial: {
        title: "",
        type: "meeting",
        startAt: start,
        endAt: new Date(start.getTime() + durationMin * 60000),
        location: "",
        notes: "",
        reminderMinutes: 30,
      },
    });
  }

  async function handleEnablePush() {
    setPushBusy(true);
    try {
      const result = await enablePush();
      setPushStatus(pushPermission());
      toast({ title: result.ok ? "Push enabled" : "Push not enabled", description: result.message, variant: result.ok ? "default" : "destructive" });
    } finally {
      setPushBusy(false);
    }
  }

  async function handleTestPush() {
    try {
      const res = await fetch("/api/push/test", { method: "POST", credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Test push failed");
      }
      toast({ title: "Test push sent" });
    } catch (e: any) {
      toast({ title: "Test push failed", description: e.message, variant: "destructive" });
    }
  }

  const containerCls = compact ? "space-y-3" : "p-3 sm:p-6 space-y-4";

  return (
    <div className={containerCls}>
      {/* Header — hidden when embedded; the host page renders its own. */}
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Calendar</h1>
            <p className="text-muted-foreground text-xs mt-0.5">
              <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] mr-1">T</kbd> today
              <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] mx-1">D W M A</kbd> view
              <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] mx-1">←</kbd>
              <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] mx-1">→</kbd> step
              <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] mx-1">/</kbd> search
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search events…"
                className="pl-8 h-9 w-56"
                data-testid="input-calendar-search"
              />
            </div>
            <PushControl
              status={pushStatus}
              busy={pushBusy}
              onEnable={handleEnablePush}
              onTest={handleTestPush}
              supported={pushSupported()}
            />
            <Button
              size="sm"
              onClick={() => openCreatePopover(
                { x: window.innerWidth / 2 - 180, y: 120 },
                nextHalfHour(),
              )}
              data-testid="button-new-event"
            >
              <Plus className="w-4 h-4 mr-1" /> New event
            </Button>
          </div>
        </div>
      )}

      {/* Compact-mode mini toolbar (lead drawer) */}
      {compact && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-sm font-semibold">Meetings &amp; Calls</span>
          <div className="flex items-center gap-2">
            <PushControl
              status={pushStatus}
              busy={pushBusy}
              onEnable={handleEnablePush}
              onTest={handleTestPush}
              supported={pushSupported()}
              compact
            />
            <Button
              size="sm"
              onClick={() => openCreatePopover(
                { x: window.innerWidth / 2 - 180, y: 120 },
                nextHalfHour(),
              )}
              data-testid="button-new-event"
            >
              <Plus className="w-4 h-4 mr-1" /> Schedule
            </Button>
          </div>
        </div>
      )}

      {/* Today strip — page-level only */}
      {!compact && todayBand && (
        <TodayStrip
          band={todayBand}
          onClick={(evt) => handleEventClick(evt)}
          onJumpToToday={() => { setCursor(startOfDay(new Date())); setView("day"); }}
        />
      )}

      {/* Toolbar */}
      <Card className="border-border/40">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border/40">
          <div className="inline-flex rounded-md border border-border/60 p-0.5">
            {(["day", "week", "month", "agenda"] as ViewMode[]).map(v => (
              <Button
                key={v}
                size="sm"
                variant={view === v ? "secondary" : "ghost"}
                className="h-7 px-2.5 text-xs"
                onClick={() => setView(v)}
                data-testid={`button-view-${v}`}
              >
                {VIEW_LABELS[v]}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-1 ml-2">
            <Button size="icon" variant="ghost" onClick={() => setCursor(c => step(view, c, -1))} data-testid="button-prev">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-3 text-xs" onClick={() => setCursor(startOfDay(new Date()))} data-testid="button-today">
              Today
            </Button>
            <Button size="icon" variant="ghost" onClick={() => setCursor(c => step(view, c, 1))} data-testid="button-next">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <div className="text-sm font-semibold ml-2" data-testid="text-cursor-label">
            {rangeLabel(view, cursor)}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {(Object.keys(EVENT_TYPE_CONFIG) as EventType[]).map(t => {
              const cfg = EVENT_TYPE_CONFIG[t];
              const Icon = cfg.icon;
              const hidden = hiddenTypes.has(t);
              return (
                <button
                  key={t}
                  onClick={() => {
                    const next = new Set(hiddenTypes);
                    if (hidden) next.delete(t); else next.add(t);
                    setHiddenTypes(next);
                  }}
                  className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-opacity ${cfg.bg} ${cfg.text} border-transparent ${hidden ? "opacity-30" : ""}`}
                  data-testid={`filter-${t}`}
                  title={hidden ? `Show ${cfg.label}` : `Hide ${cfg.label}`}
                >
                  <Icon className="w-3 h-3" />
                  {cfg.label}
                </button>
              );
            })}
          </div>
        </div>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : view === "month" ? (
            <MonthView
              cursor={cursor}
              events={filteredEvents}
              onPickDay={(d) => { setCursor(d); setView("day"); }}
              onEventClick={handleEventClick}
            />
          ) : view === "week" ? (
            <TimeGridView
              days={getDaysForView(view, cursor)}
              events={filteredEvents}
              onCreate={openCreatePopover}
              onEventClick={handleEventClick}
              onReschedule={(id, startAt, endAt) => rescheduleMutation.mutate({ id, startAt, endAt })}
            />
          ) : view === "day" ? (
            <TimeGridView
              days={[cursor]}
              events={filteredEvents}
              onCreate={openCreatePopover}
              onEventClick={handleEventClick}
              onReschedule={(id, startAt, endAt) => rescheduleMutation.mutate({ id, startAt, endAt })}
            />
          ) : (
            <AgendaView
              events={filteredEvents}
              from={rangeStart}
              to={rangeEnd}
              onEventClick={handleEventClick}
            />
          )}
        </CardContent>
      </Card>

      {/* Create / edit popover */}
      {popover && (
        <EventPopover
          anchor={popover.anchor}
          initial={popover.initial}
          eventId={popover.eventId}
          onClose={() => setPopover(null)}
          onSave={(d) => saveMutation.mutate({ ...d, id: popover.eventId ?? undefined })}
          onDelete={popover.eventId ? () => deleteMutation.mutate(popover.eventId!) : undefined}
          saving={saveMutation.isPending}
        />
      )}

      {/* Event detail panel (for crm_event clicks) */}
      {selectedEvent && (
        <EventDetailDrawer
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onEdit={() => {
            const start = new Date(selectedEvent.start);
            const end = new Date(selectedEvent.end || selectedEvent.start);
            setPopover({
              anchor: { x: window.innerWidth / 2 - 180, y: 120 },
              eventId: selectedEvent.id,
              initial: {
                title: selectedEvent.title,
                type: (selectedEvent.crm_type ?? "meeting") as CrmEventDraft["type"],
                startAt: start,
                endAt: end,
                location: selectedEvent.location ?? "",
                notes: selectedEvent.notes ?? "",
                reminderMinutes: selectedEvent.reminder_minutes ?? null,
              },
            });
            setSelectedEvent(null);
          }}
          onDelete={() => deleteMutation.mutate(selectedEvent.id)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Range helpers
// ---------------------------------------------------------------------------

function computeRange(view: ViewMode, cursor: Date): { rangeStart: Date; rangeEnd: Date } {
  if (view === "month" || view === "agenda") {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const start = new Date(first); start.setDate(1 - first.getDay());
    const end = new Date(last); end.setDate(last.getDate() + (6 - last.getDay()) + 1);
    return { rangeStart: start, rangeEnd: end };
  }
  if (view === "week") {
    return { rangeStart: startOfWeek(cursor), rangeEnd: endOfWeek(cursor) };
  }
  // day
  return { rangeStart: startOfDay(cursor), rangeEnd: addDays(startOfDay(cursor), 1) };
}

function step(view: ViewMode, cursor: Date, direction: 1 | -1): Date {
  if (view === "month" || view === "agenda") {
    return new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1);
  }
  if (view === "week") return addDays(cursor, 7 * direction);
  return addDays(cursor, direction);
}

function getDaysForView(view: ViewMode, cursor: Date): Date[] {
  if (view === "week") {
    const start = startOfWeek(cursor);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }
  return [cursor];
}

function rangeLabel(view: ViewMode, cursor: Date): string {
  if (view === "month" || view === "agenda") {
    return `${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`;
  }
  if (view === "week") {
    const start = startOfWeek(cursor);
    const end = addDays(start, 6);
    if (start.getMonth() === end.getMonth()) {
      return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`;
    }
    return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()} – ${MONTH_NAMES[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
  }
  return cursor.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function nextHalfHour(): Date {
  const d = new Date();
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
  d.setSeconds(0, 0);
  return d;
}

function buildTodayBand(events: CalendarEvent[]) {
  const now = new Date();
  const todays = events.filter(e => {
    const start = new Date(e.start || e.date || 0);
    return isSameDay(start, now);
  });
  if (todays.length === 0) return null;
  const current = todays.find(e => {
    const s = new Date(e.start);
    const en = new Date(e.end || e.start);
    return s <= now && now < en;
  });
  const upcoming = todays
    .filter(e => new Date(e.start) > now)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0];
  return { current, upcoming, totalToday: todays.length };
}

// ---------------------------------------------------------------------------
// Today strip
// ---------------------------------------------------------------------------

function TodayStrip({
  band,
  onClick,
  onJumpToToday,
}: {
  band: { current?: CalendarEvent; upcoming?: CalendarEvent; totalToday: number };
  onClick: (evt: CalendarEvent) => void;
  onJumpToToday: () => void;
}) {
  const featured = band.current ?? band.upcoming;
  return (
    <Card className="border-primary/20 bg-primary/5">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Clock className="w-4 h-4 text-primary" />
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          </div>
          <span className="text-sm font-semibold">Today</span>
          <span className="text-xs text-muted-foreground">
            {band.totalToday} event{band.totalToday === 1 ? "" : "s"}
          </span>
        </div>
        {featured ? (
          <button
            onClick={() => onClick(featured)}
            className="flex items-center gap-2 px-2.5 py-1 rounded-md hover-elevate text-left min-w-0"
            data-testid="today-featured"
          >
            <span className={`text-[10px] uppercase tracking-wider ${band.current ? "text-emerald-300" : "text-amber-300"}`}>
              {band.current ? "Now" : "Next"}
            </span>
            <span className="text-sm font-medium truncate">{featured.title}</span>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {featured.all_day
                ? "all day"
                : `${fmtTime(new Date(featured.start))}${featured.end ? ` – ${fmtTime(new Date(featured.end))}` : ""}`}
            </span>
            {!band.current && band.upcoming && (
              <span className="text-[10px] text-amber-300 whitespace-nowrap">
                in {minutesUntil(new Date(band.upcoming.start))}
              </span>
            )}
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">No more events today.</span>
        )}
        <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={onJumpToToday}>
          Jump to today
        </Button>
      </div>
    </Card>
  );
}

function minutesUntil(d: Date): string {
  const mins = Math.max(0, Math.floor((d.getTime() - Date.now()) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ---------------------------------------------------------------------------
// Month view
// ---------------------------------------------------------------------------

function MonthView({
  cursor,
  events,
  onPickDay,
  onEventClick,
}: {
  cursor: Date;
  events: CalendarEvent[];
  onPickDay: (d: Date) => void;
  onEventClick: (e: CalendarEvent) => void;
}) {
  const today = new Date();
  const days = useMemo(() => getMonthGridDays(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  const byDate = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const k = isoDate(new Date(e.start || e.date || 0));
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return m;
  }, [events]);

  return (
    <div className="p-2">
      <div className="grid grid-cols-7 gap-px mb-1">
        {DAYS_OF_WEEK.map(d => (
          <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1.5">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px">
        {days.map((day, idx) => {
          const k = isoDate(day);
          const dayEvents = byDate.get(k) ?? [];
          const inMonth = isSameMonth(day, cursor);
          const isToday = isSameDay(day, today);
          return (
            <div
              key={idx}
              onClick={() => onPickDay(day)}
              className={`min-h-[6rem] p-1.5 rounded-md border border-border/40 cursor-pointer hover-elevate ${
                inMonth ? "" : "opacity-40"
              } ${isToday ? "ring-2 ring-primary" : ""}`}
              data-testid={`cell-day-${k}`}
            >
              <div className={`text-xs font-semibold mb-1 ${isToday ? "text-primary" : ""}`}>
                {day.getDate()}
              </div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 4).map(evt => {
                  const cfg = EVENT_TYPE_CONFIG[evt.event_type];
                  return (
                    <div
                      key={`${evt.event_type}-${evt.id}`}
                      onClick={(e) => { e.stopPropagation(); onEventClick(evt); }}
                      className={`flex items-center gap-1 px-1 py-0.5 rounded text-[10px] truncate ${cfg.bg} ${cfg.text} hover:ring-1 ${cfg.ring}`}
                      title={evt.title}
                      data-testid={`month-event-${evt.event_type}-${evt.id}`}
                    >
                      {!evt.all_day && (
                        <span className="opacity-70 shrink-0">{fmtTime(new Date(evt.start))}</span>
                      )}
                      <span className="truncate">{evt.title}</span>
                    </div>
                  );
                })}
                {dayEvents.length > 4 && (
                  <div className="text-[10px] text-muted-foreground px-1">
                    +{dayEvents.length - 4} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time grid (Day + Week)
// ---------------------------------------------------------------------------

function TimeGridView({
  days,
  events,
  onCreate,
  onEventClick,
  onReschedule,
}: {
  days: Date[];
  events: CalendarEvent[];
  onCreate: (anchor: { x: number; y: number }, start: Date) => void;
  onEventClick: (e: CalendarEvent) => void;
  onReschedule: (id: string, startAt: Date, endAt: Date | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const today = new Date();
  const hours = useMemo(
    () => Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => DAY_START_HOUR + i),
    [],
  );

  // Auto-scroll to current time on mount.
  useEffect(() => {
    if (!containerRef.current) return;
    const offset = (today.getHours() - DAY_START_HOUR) * HOUR_HEIGHT - 100;
    containerRef.current.scrollTop = Math.max(0, offset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleGridClick(day: Date, e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const minutesFromTop = (y / HOUR_HEIGHT) * 60;
    const totalMinutes = Math.round(minutesFromTop / 15) * 15;
    const start = new Date(day);
    start.setHours(DAY_START_HOUR, 0, 0, 0);
    start.setMinutes(start.getMinutes() + totalMinutes);
    onCreate({ x: e.clientX, y: e.clientY }, start);
  }

  return (
    <div className="flex border-t border-border/40">
      {/* Hour gutter */}
      <div className="w-14 shrink-0 border-r border-border/40 bg-background sticky left-0">
        <div className="h-10" /> {/* spacer for day header */}
        {hours.map(h => (
          <div key={h} className="text-[10px] text-muted-foreground text-right pr-1.5 -mt-1.5" style={{ height: HOUR_HEIGHT }}>
            {h === 12 ? "12 PM" : h > 12 ? `${h - 12} PM` : `${h} AM`}
          </div>
        ))}
      </div>

      {/* Day columns */}
      <div ref={containerRef} className="flex-1 overflow-y-auto max-h-[70vh]">
        <div className="grid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          {days.map(day => (
            <DayHeader key={`h-${isoDate(day)}`} day={day} isToday={isSameDay(day, today)} />
          ))}
          {days.map(day => (
            <DayColumn
              key={`c-${isoDate(day)}`}
              day={day}
              events={events}
              onClickGrid={(e) => handleGridClick(day, e)}
              onEventClick={onEventClick}
              onReschedule={onReschedule}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function DayHeader({ day, isToday }: { day: Date; isToday: boolean }) {
  return (
    <div className={`h-10 border-b border-border/40 flex items-center justify-center text-xs font-semibold sticky top-0 bg-card z-10 ${isToday ? "text-primary" : ""}`}>
      {day.toLocaleDateString("en-US", { weekday: "short" })} {day.getMonth() + 1}/{day.getDate()}
    </div>
  );
}

function DayColumn({
  day,
  events,
  onClickGrid,
  onEventClick,
  onReschedule,
}: {
  day: Date;
  events: CalendarEvent[];
  onClickGrid: (e: React.MouseEvent) => void;
  onEventClick: (e: CalendarEvent) => void;
  onReschedule: (id: string, startAt: Date, endAt: Date | null) => void;
}) {
  const today = new Date();
  const isToday = isSameDay(day, today);
  const gridHeight = (DAY_END_HOUR - DAY_START_HOUR) * HOUR_HEIGHT;

  const dayEvents = useMemo(() => {
    return events
      .filter(e => isSameDay(new Date(e.start || e.date || 0), day) && !e.all_day)
      .map(e => ({
        ev: e,
        start: new Date(e.start),
        end: new Date(e.end || e.start),
        id: `${e.event_type}-${e.id}`,
      }))
      .filter(e => !isNaN(e.start.getTime()));
  }, [events, day]);

  const allDayEvents = useMemo(() => {
    return events.filter(e => isSameDay(new Date(e.start || e.date || 0), day) && e.all_day);
  }, [events, day]);

  const { placement, totalForId } = useMemo(
    () => layoutColumns(dayEvents.map(e => ({ start: e.start, end: e.end, id: e.id }))),
    [dayEvents],
  );

  // Current-time indicator
  const nowOffset = useMemo(() => {
    if (!isToday) return null;
    const now = new Date();
    if (now.getHours() < DAY_START_HOUR || now.getHours() >= DAY_END_HOUR) return null;
    const minutes = (now.getHours() - DAY_START_HOUR) * 60 + now.getMinutes();
    return (minutes / 60) * HOUR_HEIGHT;
  }, [isToday]);

  return (
    <div className="relative border-r border-border/40">
      {/* All-day strip */}
      {allDayEvents.length > 0 && (
        <div className="px-1 py-1 border-b border-border/30 space-y-0.5 min-h-[28px]">
          {allDayEvents.slice(0, 3).map(evt => {
            const cfg = EVENT_TYPE_CONFIG[evt.event_type];
            return (
              <div
                key={`${evt.event_type}-${evt.id}`}
                onClick={(e) => { e.stopPropagation(); onEventClick(evt); }}
                className={`px-1.5 py-0.5 rounded text-[10px] truncate cursor-pointer ${cfg.bg} ${cfg.text}`}
                title={evt.title}
              >
                {evt.title}
              </div>
            );
          })}
          {allDayEvents.length > 3 && (
            <div className="text-[10px] text-muted-foreground px-1.5">+{allDayEvents.length - 3} more</div>
          )}
        </div>
      )}

      {/* Time grid */}
      <div
        className="relative cursor-pointer"
        style={{ height: gridHeight }}
        onClick={onClickGrid}
        data-testid={`day-column-${isoDate(day)}`}
      >
        {/* hour lines */}
        {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }).map((_, i) => (
          <div
            key={i}
            className="absolute left-0 right-0 border-t border-border/20"
            style={{ top: i * HOUR_HEIGHT }}
          />
        ))}
        {/* half-hour lines */}
        {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }).map((_, i) => (
          <div
            key={`half-${i}`}
            className="absolute left-0 right-0 border-t border-dashed border-border/10"
            style={{ top: i * HOUR_HEIGHT + HOUR_HEIGHT / 2 }}
          />
        ))}

        {/* events */}
        {dayEvents.map(({ ev, start, end, id }) => {
          const cfg = EVENT_TYPE_CONFIG[ev.event_type];
          const startMins = (start.getHours() - DAY_START_HOUR) * 60 + start.getMinutes();
          const endMins = (end.getHours() - DAY_START_HOUR) * 60 + end.getMinutes();
          const top = (startMins / 60) * HOUR_HEIGHT;
          const height = Math.max(20, ((endMins - startMins) / 60) * HOUR_HEIGHT);
          const { col } = placement[id];
          const total = totalForId[id];
          const widthPct = 100 / total;
          const leftPct = widthPct * col;
          const isDraggable = ev.event_type === "crm_event";
          return (
            <div
              key={id}
              draggable={isDraggable}
              onDragStart={(e) => {
                if (!isDraggable) return;
                e.dataTransfer.setData("text/plain", ev.id);
                e.dataTransfer.setData("text/x-event-duration-min", String(Math.round((end.getTime() - start.getTime()) / 60000)));
                e.dataTransfer.effectAllowed = "move";
              }}
              onClick={(e) => { e.stopPropagation(); onEventClick(ev); }}
              className={`absolute rounded-md border ${cfg.bg} ${cfg.text} border-transparent hover:ring-1 ${cfg.ring} px-1.5 py-1 text-[10px] overflow-hidden cursor-pointer`}
              style={{
                top,
                height,
                left: `calc(${leftPct}% + 2px)`,
                width: `calc(${widthPct}% - 4px)`,
              }}
              data-testid={`event-block-${id}`}
              title={`${ev.title}\n${fmtTime(start)} – ${fmtTime(end)}${ev.location ? "\n" + ev.location : ""}`}
            >
              <div className="font-semibold truncate">{ev.title}</div>
              <div className="opacity-70 truncate">{fmtTime(start)} – {fmtTime(end)}</div>
              {ev.location && (
                <div className="opacity-70 truncate flex items-center gap-0.5">
                  <MapPin className="w-2.5 h-2.5" /> {ev.location}
                </div>
              )}
            </div>
          );
        })}

        {/* drop target for reschedule */}
        <DropTarget
          day={day}
          gridHeight={gridHeight}
          onDrop={(eventId, startAt, durationMin) => {
            const endAt = new Date(startAt.getTime() + durationMin * 60000);
            onReschedule(eventId, startAt, endAt);
          }}
        />

        {/* now line */}
        {nowOffset != null && (
          <div className="absolute left-0 right-0 z-10 pointer-events-none" style={{ top: nowOffset }}>
            <div className="border-t-2 border-red-500" />
            <div className="absolute -left-1 -top-1.5 w-3 h-3 rounded-full bg-red-500" />
          </div>
        )}
      </div>
    </div>
  );
}

function DropTarget({
  day,
  gridHeight,
  onDrop,
}: {
  day: Date;
  gridHeight: number;
  onDrop: (eventId: string, startAt: Date, durationMin: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div
      className="absolute inset-0"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const rect = e.currentTarget.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const snapped = Math.round((y / HOUR_HEIGHT) * 4) / 4;
        setHover(snapped * HOUR_HEIGHT);
      }}
      onDragLeave={() => setHover(null)}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData("text/plain");
        const dur = parseInt(e.dataTransfer.getData("text/x-event-duration-min") || "30", 10);
        const rect = e.currentTarget.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const minutesFromTop = Math.round(((y / HOUR_HEIGHT) * 60) / 15) * 15;
        const start = new Date(day);
        start.setHours(DAY_START_HOUR, 0, 0, 0);
        start.setMinutes(start.getMinutes() + minutesFromTop);
        setHover(null);
        if (id) onDrop(id, start, dur);
      }}
      style={{ height: gridHeight, pointerEvents: "auto" }}
    >
      {hover != null && (
        <div className="absolute left-0 right-1 border-t-2 border-primary/70" style={{ top: hover }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agenda view
// ---------------------------------------------------------------------------

function AgendaView({
  events,
  from,
  to,
  onEventClick,
}: {
  events: CalendarEvent[];
  from: Date;
  to: Date;
  onEventClick: (e: CalendarEvent) => void;
}) {
  const today = new Date();
  const groups = useMemo(() => {
    const buckets = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const d = new Date(e.start || e.date || 0);
      if (d < from || d > to) continue;
      const k = isoDate(d);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(e);
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, items]) => ({
        date: new Date(`${k}T00:00:00`),
        items: items.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()),
      }));
  }, [events, from, to]);

  if (groups.length === 0) {
    return <p className="p-12 text-center text-sm text-muted-foreground">No events in this range.</p>;
  }

  return (
    <div className="p-4 space-y-5">
      {groups.map(({ date, items }) => {
        const isToday = isSameDay(date, today);
        return (
          <div key={isoDate(date)}>
            <div className={`text-xs font-semibold uppercase tracking-wider mb-2 ${isToday ? "text-primary" : "text-muted-foreground"}`}>
              {date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
              {isToday && <span className="ml-2 normal-case tracking-normal">· Today</span>}
            </div>
            <div className="space-y-1">
              {items.map(evt => {
                const cfg = EVENT_TYPE_CONFIG[evt.event_type];
                const Icon = cfg.icon;
                return (
                  <div
                    key={`${evt.event_type}-${evt.id}`}
                    onClick={() => onEventClick(evt)}
                    className="flex items-start gap-3 p-2.5 rounded-md border border-border/40 hover-elevate cursor-pointer"
                  >
                    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${cfg.text}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{evt.title}</span>
                        <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate text-[10px]">{cfg.label}</Badge>
                        {!evt.all_day && (
                          <span className="text-[11px] text-muted-foreground">
                            {fmtTime(new Date(evt.start))}{evt.end ? ` – ${fmtTime(new Date(evt.end))}` : ""}
                          </span>
                        )}
                      </div>
                      {evt.project_name && <p className="text-xs text-muted-foreground mt-0.5">{evt.project_name}</p>}
                      {evt.vendor_name && <p className="text-xs text-muted-foreground mt-0.5">{evt.vendor_name}</p>}
                      {evt.lead_name && <p className="text-xs text-muted-foreground mt-0.5">{evt.lead_name}</p>}
                      {evt.location && (
                        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> {evt.location}
                        </p>
                      )}
                      {evt.amount != null && (
                        <p className="text-xs font-medium mt-0.5">${Number(evt.amount).toLocaleString()}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline event create / edit popover
// ---------------------------------------------------------------------------

interface CrmEventDraft {
  title: string;
  type: "meeting" | "call" | "demo" | "follow_up" | "other";
  startAt: Date;
  endAt: Date | null;
  location: string;
  notes: string;
  reminderMinutes: number | null;
}

function EventPopover({
  anchor,
  initial,
  eventId,
  onClose,
  onSave,
  onDelete,
  saving,
}: {
  anchor: { x: number; y: number };
  initial: Partial<CrmEventDraft>;
  eventId: string | null;
  onClose: () => void;
  onSave: (draft: CrmEventDraft) => void;
  onDelete?: () => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<CrmEventDraft>({
    title: initial.title ?? "",
    type: initial.type ?? "meeting",
    startAt: initial.startAt ?? nextHalfHour(),
    endAt: initial.endAt ?? new Date((initial.startAt ?? nextHalfHour()).getTime() + 30 * 60000),
    location: initial.location ?? "",
    notes: initial.notes ?? "",
    reminderMinutes: initial.reminderMinutes ?? 30,
  });
  const [conflicts, setConflicts] = useState<{ id: string; title: string }[]>([]);

  // Conflict check (debounced)
  useEffect(() => {
    const handle = setTimeout(async () => {
      try {
        const url = `/api/ops/calendar-events/conflicts?start=${draft.startAt.toISOString()}&end=${(draft.endAt ?? draft.startAt).toISOString()}${eventId ? `&excludeId=${eventId}` : ""}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        setConflicts(data.conflicts || []);
      } catch {
        // ignore
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [draft.startAt, draft.endAt, eventId]);

  const popoverRef = useRef<HTMLDivElement>(null);
  // Reposition if it would clip the viewport
  const left = Math.max(8, Math.min(window.innerWidth - 380, anchor.x));
  const top = Math.max(8, Math.min(window.innerHeight - 460, anchor.y));

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        ref={popoverRef}
        onClick={(e) => e.stopPropagation()}
        className="absolute w-[360px] rounded-lg border border-border bg-card shadow-2xl p-4 space-y-3"
        style={{ left, top }}
        data-testid="event-popover"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            {eventId ? "Edit event" : "New event"}
          </h3>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onClose}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>

        <Input
          autoFocus
          placeholder="Add a title…"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          className="h-9 text-sm"
          data-testid="input-event-title"
        />

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Type</label>
            <Select value={draft.type} onValueChange={(v) => setDraft({ ...draft, type: v as CrmEventDraft["type"] })}>
              <SelectTrigger className="h-9 text-sm" data-testid="select-event-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="meeting">Meeting</SelectItem>
                <SelectItem value="call">Call</SelectItem>
                <SelectItem value="demo">Demo</SelectItem>
                <SelectItem value="follow_up">Follow-up</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Reminder</label>
            <Select
              value={draft.reminderMinutes != null ? String(draft.reminderMinutes) : ""}
              onValueChange={(v) => setDraft({ ...draft, reminderMinutes: v ? Number(v) : null })}
            >
              <SelectTrigger className="h-9 text-sm" data-testid="select-event-reminder">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REMINDER_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value || "none"}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Starts</label>
            <Input
              type="datetime-local"
              value={toInputValue(draft.startAt)}
              onChange={(e) => {
                const newStart = fromInputValue(e.target.value) ?? draft.startAt;
                const delta = draft.endAt ? draft.endAt.getTime() - draft.startAt.getTime() : 30 * 60000;
                setDraft({ ...draft, startAt: newStart, endAt: new Date(newStart.getTime() + delta) });
              }}
              className="h-9 text-sm"
              data-testid="input-event-start"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Ends</label>
            <Input
              type="datetime-local"
              value={draft.endAt ? toInputValue(draft.endAt) : ""}
              onChange={(e) => {
                const v = fromInputValue(e.target.value);
                setDraft({ ...draft, endAt: v });
              }}
              className="h-9 text-sm"
              data-testid="input-event-end"
            />
          </div>
        </div>

        <Input
          placeholder="Location or video link…"
          value={draft.location}
          onChange={(e) => setDraft({ ...draft, location: e.target.value })}
          className="h-9 text-sm"
          data-testid="input-event-location"
        />

        <Textarea
          placeholder="Notes…"
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          className="text-sm min-h-[60px]"
          data-testid="input-event-notes"
        />

        {conflicts.length > 0 && (
          <div className="flex items-start gap-2 p-2 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs" data-testid="conflict-warning">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">Overlaps with {conflicts.length} other event{conflicts.length === 1 ? "" : "s"}</div>
              <ul className="mt-1 space-y-0.5 opacity-80">
                {conflicts.slice(0, 3).map(c => <li key={c.id} className="truncate">• {c.title}</li>)}
              </ul>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          {onDelete ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => { if (confirm("Delete this event?")) onDelete(); }}
              data-testid="button-delete-event"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
            </Button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              onClick={() => onSave(draft)}
              disabled={!draft.title.trim() || saving}
              data-testid="button-save-event"
            >
              <Save className="w-3.5 h-3.5 mr-1" />
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function toInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromInputValue(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Event detail drawer (right side)
// ---------------------------------------------------------------------------

function EventDetailDrawer({
  event,
  onClose,
  onEdit,
  onDelete,
}: {
  event: CalendarEvent;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const cfg = EVENT_TYPE_CONFIG[event.event_type];
  const Icon = event.crm_type
    ? CRM_TYPE_ICONS[event.crm_type] ?? cfg.icon
    : cfg.icon;
  const start = new Date(event.start);
  const end = event.end ? new Date(event.end) : start;
  return (
    <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute top-0 right-0 h-full w-full sm:w-[420px] bg-card border-l border-border shadow-2xl p-5 overflow-y-auto"
        data-testid="event-drawer"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className={`p-2 rounded-md ${cfg.bg}`}>
              <Icon className={`w-5 h-5 ${cfg.text}`} />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-semibold truncate" data-testid="text-drawer-title">{event.title}</h3>
              <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate text-[10px] mt-1">
                {cfg.label}
              </Badge>
            </div>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="w-4 h-4 shrink-0" />
            <span>{event.all_day ? fmtDay(start) : fmtRange(start, end)}</span>
          </div>
          {event.location && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="w-4 h-4 shrink-0" />
              <span className="truncate">{event.location}</span>
            </div>
          )}
          {event.reminder_minutes != null && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Bell className="w-4 h-4 shrink-0" />
              <span>{event.reminder_minutes} min before</span>
            </div>
          )}
          {event.lead_name && (
            <div className="text-muted-foreground">
              <span className="text-[10px] uppercase tracking-wider">Lead</span>
              <div>{event.lead_name}</div>
            </div>
          )}
          {event.notes && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Notes</span>
              <p className="mt-1 whitespace-pre-wrap text-sm">{event.notes}</p>
            </div>
          )}
        </div>

        {event.event_type === "crm_event" && (
          <div className="flex gap-2 mt-6 pt-4 border-t border-border/40">
            <Button size="sm" onClick={onEdit} data-testid="button-drawer-edit">Edit</Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => { if (confirm("Delete this event?")) onDelete(); }}
              data-testid="button-drawer-delete"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Push control
// ---------------------------------------------------------------------------

function PushControl({
  status,
  busy,
  onEnable,
  onTest,
  supported,
  compact,
}: {
  status: NotificationPermission | "unsupported";
  busy: boolean;
  onEnable: () => void;
  onTest: () => void;
  supported: boolean;
  compact?: boolean;
}) {
  if (!supported) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="h-9 text-xs"
        title="On iPhone, add this site to your Home Screen first, then open it from there to enable push."
        data-testid="button-push-unsupported"
      >
        <BellOff className="w-3.5 h-3.5 mr-1" /> {compact ? "Push" : "Push (PWA only)"}
      </Button>
    );
  }
  if (status === "granted") {
    return (
      <div className="inline-flex rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 h-9 items-center" data-testid="push-granted">
        <span className="px-2 inline-flex items-center gap-1 text-xs">
          <BellRing className="w-3.5 h-3.5" /> {compact ? "On" : "Push on"}
        </span>
        <button
          onClick={onTest}
          className="border-l border-emerald-500/30 px-2 text-xs hover:bg-emerald-500/20 h-full"
          data-testid="button-push-test"
          title="Send a test push to this device"
        >
          Test
        </button>
      </div>
    );
  }
  if (status === "denied") {
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-9 text-xs border-amber-500/40 text-amber-300"
        title="Notification permission is denied. Re-enable it in your browser/site settings."
        data-testid="button-push-denied"
      >
        <BellOff className="w-3.5 h-3.5 mr-1" /> {compact ? "Blocked" : "Push blocked"}
      </Button>
    );
  }
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-9 text-xs"
      onClick={onEnable}
      disabled={busy}
      data-testid="button-push-enable"
    >
      <Bell className="w-3.5 h-3.5 mr-1" />
      {busy ? "…" : compact ? "Enable push" : "Enable push alerts"}
    </Button>
  );
}
