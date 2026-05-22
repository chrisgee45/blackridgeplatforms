import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft, ChevronRight, Plus, CalendarDays, LayoutGrid, List,
  Clock, MapPin, Trash2, Loader2, Check, Video, Phone, Users, Presentation, CircleDot,
} from "lucide-react";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  addMonths, subMonths, format, isSameMonth, isSameDay, isToday, isBefore,
  startOfDay,
} from "date-fns";
import type { CrmEvent, ContactSubmission } from "@shared/schema";

type EventType = "meeting" | "call" | "demo" | "follow_up" | "other";

const EVENT_STYLES: Record<string, {
  dot: string; pill: string; soft: string; icon: typeof Users; label: string;
}> = {
  meeting:   { dot: "bg-blue-500",   pill: "bg-blue-500/15 text-blue-600 dark:text-blue-300 border-blue-500/30",       soft: "bg-blue-500/10",   icon: Users,        label: "Meeting" },
  call:      { dot: "bg-violet-500", pill: "bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/30", soft: "bg-violet-500/10", icon: Phone,        label: "Call" },
  demo:      { dot: "bg-amber-500",  pill: "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30",    soft: "bg-amber-500/10",  icon: Presentation, label: "Demo" },
  follow_up: { dot: "bg-orange-500", pill: "bg-orange-500/15 text-orange-600 dark:text-orange-300 border-orange-500/30", soft: "bg-orange-500/10", icon: Clock,        label: "Follow-up" },
  other:     { dot: "bg-slate-500",  pill: "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30",    soft: "bg-slate-500/10",  icon: CircleDot,    label: "Other" },
};

export function styleFor(type: string) {
  return EVENT_STYLES[type] ?? EVENT_STYLES.other;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayKey(d: Date | string): string {
  return format(new Date(d), "yyyy-MM-dd");
}

interface CrmCalendarProps {
  leads: ContactSubmission[];
  onSelectLead?: (lead: ContactSubmission) => void;
}

export default function CrmCalendar({ leads }: CrmCalendarProps) {
  const [cursor, setCursor] = useState(() => new Date());
  const [mode, setMode] = useState<"month" | "agenda">("month");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CrmEvent | null>(null);
  const [presetDate, setPresetDate] = useState<Date | null>(null);

  const { data: events = [], isLoading } = useQuery<CrmEvent[]>({
    queryKey: ["/api/crm/events"],
  });

  const leadMap = useMemo(() => {
    const m = new Map<string, ContactSubmission>();
    leads.forEach((l) => m.set(l.id, l));
    return m;
  }, [leads]);

  const eventsByDay = useMemo(() => {
    const m = new Map<string, CrmEvent[]>();
    for (const ev of events) {
      const k = dayKey(ev.startAt);
      const arr = m.get(k) ?? [];
      arr.push(ev);
      m.set(k, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    }
    return m;
  }, [events]);

  const openNew = (date?: Date) => {
    setEditing(null);
    setPresetDate(date ?? null);
    setDialogOpen(true);
  };
  const openEdit = (ev: CrmEvent) => {
    setEditing(ev);
    setPresetDate(null);
    setDialogOpen(true);
  };

  const gridDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const upcoming = useMemo(() => {
    const today = startOfDay(new Date());
    return events
      .filter((e) => !isBefore(new Date(e.startAt), today) && e.status !== "cancelled")
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
      .slice(0, 8);
  }, [events]);

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-calendar-title">
            {format(cursor, "MMMM yyyy")}
          </h1>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCursor((c) => subMonths(c, 1))} data-testid="button-cal-prev">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-8" onClick={() => setCursor(new Date())} data-testid="button-cal-today">
              Today
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCursor((c) => addMonths(c, 1))} data-testid="button-cal-next">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-border/60 p-0.5">
            <button
              onClick={() => setMode("month")}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${mode === "month" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              data-testid="button-cal-mode-month"
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Month
            </button>
            <button
              onClick={() => setMode("agenda")}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${mode === "agenda" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              data-testid="button-cal-mode-agenda"
            >
              <List className="h-3.5 w-3.5" /> Agenda
            </button>
          </div>
          <Button size="sm" onClick={() => openNew()} data-testid="button-new-event">
            <Plus className="h-4 w-4 mr-1" /> New Event
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid lg:grid-cols-[1fr_320px] gap-6">
          <div>
            {mode === "month" ? (
              <MonthGrid
                gridDays={gridDays}
                cursor={cursor}
                eventsByDay={eventsByDay}
                leadMap={leadMap}
                onDayClick={openNew}
                onEventClick={openEdit}
              />
            ) : (
              <AgendaList events={events} leadMap={leadMap} onEventClick={openEdit} />
            )}
          </div>
          <UpcomingPanel upcoming={upcoming} leadMap={leadMap} onEventClick={openEdit} onNew={() => openNew()} />
        </div>
      )}

      <EventDialog
        key={editing?.id ?? (presetDate ? presetDate.toISOString() : "new")}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        event={editing}
        presetDate={presetDate}
        leads={leads}
      />
    </div>
  );
}

function MonthGrid({
  gridDays, cursor, eventsByDay, leadMap, onDayClick, onEventClick,
}: {
  gridDays: Date[];
  cursor: Date;
  eventsByDay: Map<string, CrmEvent[]>;
  leadMap: Map<string, ContactSubmission>;
  onDayClick: (d: Date) => void;
  onEventClick: (e: CrmEvent) => void;
}) {
  return (
    <div className="rounded-xl border border-border/60 overflow-hidden bg-card/40">
      <div className="grid grid-cols-7 border-b border-border/60 bg-muted/30">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {gridDays.map((day) => {
          const inMonth = isSameMonth(day, cursor);
          const today = isToday(day);
          const dayEvents = eventsByDay.get(dayKey(day)) ?? [];
          const weekend = day.getDay() === 0 || day.getDay() === 6;
          return (
            <div
              key={day.toISOString()}
              onClick={() => onDayClick(day)}
              className={`group min-h-[112px] border-b border-r border-border/40 p-1.5 cursor-pointer transition-colors hover:bg-muted/40
                ${inMonth ? "" : "bg-muted/20"} ${weekend && inMonth ? "bg-muted/10" : ""}`}
              data-testid={`cal-day-${dayKey(day)}`}
            >
              <div className="flex items-center justify-between">
                <span className={`flex items-center justify-center text-xs font-semibold h-6 w-6 rounded-full
                  ${today ? "bg-primary text-primary-foreground" : inMonth ? "text-foreground" : "text-muted-foreground/50"}`}>
                  {format(day, "d")}
                </span>
                <Plus className="h-3.5 w-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors" />
              </div>
              <div className="mt-1 space-y-1">
                {dayEvents.slice(0, 3).map((ev) => {
                  const st = styleFor(ev.type);
                  const done = ev.status === "completed";
                  const cancelled = ev.status === "cancelled" || ev.status === "no_show";
                  return (
                    <button
                      key={ev.id}
                      onClick={(e) => { e.stopPropagation(); onEventClick(ev); }}
                      className={`w-full flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] leading-tight truncate text-left ${st.pill}
                        ${cancelled ? "opacity-50 line-through" : ""}`}
                      data-testid={`cal-event-${ev.id}`}
                    >
                      {done && <Check className="h-3 w-3 shrink-0" />}
                      <span className="font-medium shrink-0 tabular-nums">{format(new Date(ev.startAt), "h:mma").toLowerCase()}</span>
                      <span className="truncate">{ev.title}</span>
                    </button>
                  );
                })}
                {dayEvents.length > 3 && (
                  <div className="text-[10px] text-muted-foreground pl-1.5 font-medium">
                    +{dayEvents.length - 3} more
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

function AgendaList({
  events, leadMap, onEventClick,
}: {
  events: CrmEvent[];
  leadMap: Map<string, ContactSubmission>;
  onEventClick: (e: CrmEvent) => void;
}) {
  const today = startOfDay(new Date());
  const sorted = useMemo(
    () => [...events]
      .filter((e) => !isBefore(new Date(e.startAt), today))
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()),
    [events],
  );

  if (sorted.length === 0) {
    return <EmptyState />;
  }

  const groups = new Map<string, CrmEvent[]>();
  for (const ev of sorted) {
    const k = dayKey(ev.startAt);
    const arr = groups.get(k) ?? [];
    arr.push(ev);
    groups.set(k, arr);
  }

  return (
    <div className="space-y-5">
      {[...groups.entries()].map(([key, evs]) => {
        const d = new Date(key + "T00:00:00");
        return (
          <div key={key}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-sm font-semibold ${isToday(d) ? "text-primary" : "text-foreground"}`}>
                {isToday(d) ? "Today" : format(d, "EEEE, MMM d")}
              </span>
              <div className="flex-1 h-px bg-border/60" />
            </div>
            <div className="space-y-2">
              {evs.map((ev) => (
                <EventRow key={ev.id} event={ev} leadMap={leadMap} onClick={() => onEventClick(ev)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EventRow({
  event, leadMap, onClick,
}: {
  event: CrmEvent;
  leadMap: Map<string, ContactSubmission>;
  onClick: () => void;
}) {
  const st = styleFor(event.type);
  const Icon = st.icon;
  const lead = event.leadId ? leadMap.get(event.leadId) : null;
  const cancelled = event.status === "cancelled" || event.status === "no_show";
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 p-3 rounded-lg border border-border/60 bg-card/50 hover:bg-muted/40 transition-colors text-left ${cancelled ? "opacity-60" : ""}`}
      data-testid={`agenda-event-${event.id}`}
    >
      <div className={`h-9 w-9 rounded-md flex items-center justify-center shrink-0 ${st.soft}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium truncate ${cancelled ? "line-through" : ""}`}>{event.title}</span>
          {event.status === "completed" && <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {format(new Date(event.startAt), "h:mm a")}
          {event.endAt ? ` to ${format(new Date(event.endAt), "h:mm a")}` : ""}
          {lead ? ` · ${lead.name}` : ""}
          {event.location ? ` · ${event.location}` : ""}
        </div>
      </div>
      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${st.pill}`}>{st.label}</span>
    </button>
  );
}

function UpcomingPanel({
  upcoming, leadMap, onEventClick, onNew,
}: {
  upcoming: CrmEvent[];
  leadMap: Map<string, ContactSubmission>;
  onEventClick: (e: CrmEvent) => void;
  onNew: () => void;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-4 h-fit">
      <div className="flex items-center gap-2 mb-3">
        <CalendarDays className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Upcoming</span>
      </div>
      {upcoming.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground mb-3">Nothing scheduled.</p>
          <Button size="sm" variant="outline" onClick={onNew} data-testid="button-upcoming-new">
            <Plus className="h-4 w-4 mr-1" /> Schedule something
          </Button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {upcoming.map((ev) => {
            const st = styleFor(ev.type);
            const lead = ev.leadId ? leadMap.get(ev.leadId) : null;
            return (
              <button
                key={ev.id}
                onClick={() => onEventClick(ev)}
                className="w-full flex items-start gap-2.5 p-2 rounded-lg hover:bg-muted/50 transition-colors text-left"
                data-testid={`upcoming-event-${ev.id}`}
              >
                <span className={`mt-1 h-2 w-2 rounded-full shrink-0 ${st.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{ev.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {format(new Date(ev.startAt), "EEE, MMM d · h:mm a")}
                  </div>
                  {lead && <div className="text-xs text-muted-foreground/80 truncate">{lead.name}</div>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border/60 py-20 text-center">
      <CalendarDays className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
      <p className="text-sm text-muted-foreground">No upcoming events. Schedule a call or meeting to get started.</p>
    </div>
  );
}

export function EventDialog({
  open, onOpenChange, event, presetDate, presetLeadId, leads,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  event: CrmEvent | null;
  presetDate: Date | null;
  presetLeadId?: string | null;
  leads: ContactSubmission[];
}) {
  const { toast } = useToast();
  const isEdit = !!event;

  const initialStart = event ? new Date(event.startAt) : (presetDate ?? new Date());
  const [title, setTitle] = useState(event?.title ?? "");
  const [type, setType] = useState<EventType>((event?.type as EventType) ?? "meeting");
  const [date, setDate] = useState(format(initialStart, "yyyy-MM-dd"));
  const [startTime, setStartTime] = useState(event ? format(new Date(event.startAt), "HH:mm") : "10:00");
  const [endTime, setEndTime] = useState(event?.endAt ? format(new Date(event.endAt), "HH:mm") : "");
  const [leadId, setLeadId] = useState(event?.leadId ?? presetLeadId ?? "none");
  const [location, setLocation] = useState(event?.location ?? "");
  const [notes, setNotes] = useState(event?.notes ?? "");
  const [status, setStatus] = useState(event?.status ?? "scheduled");

  const onDone = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/crm/events"] });
    onOpenChange(false);
  };

  const errorText = (error: any) => {
    const m = String(error?.message || "").match(/^\d+:\s*([\s\S]*)$/);
    if (m) { try { return JSON.parse(m[1])?.message || m[1]; } catch { return m[1]; } }
    return error?.message || "Something went wrong";
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const startAt = new Date(`${date}T${startTime || "00:00"}`).toISOString();
      const endAt = endTime ? new Date(`${date}T${endTime}`).toISOString() : null;
      const payload = {
        title, type, startAt, endAt,
        leadId: leadId === "none" ? null : leadId,
        location, notes, status,
      };
      if (isEdit) {
        await apiRequest("PATCH", `/api/crm/events/${event!.id}`, payload);
      } else {
        await apiRequest("POST", "/api/crm/events", payload);
      }
    },
    onSuccess: () => {
      toast({ title: isEdit ? "Event updated" : "Event scheduled" });
      onDone();
    },
    onError: (e) => toast({ title: "Error", description: errorText(e), variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `/api/crm/events/${event!.id}`); },
    onSuccess: () => { toast({ title: "Event deleted" }); onDone(); },
    onError: (e) => toast({ title: "Error", description: errorText(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-event">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Event" : "New Event"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Discovery call with…"
              data-testid="input-event-title"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as EventType)}>
                <SelectTrigger data-testid="select-event-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(EVENT_STYLES) as EventType[]).map((t) => (
                    <SelectItem key={t} value={t}>{EVENT_STYLES[t].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-event-date" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Start time</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} data-testid="input-event-start" />
            </div>
            <div>
              <Label className="text-xs">End time <span className="text-muted-foreground">(optional)</span></Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} data-testid="input-event-end" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Linked lead <span className="text-muted-foreground">(optional)</span></Label>
            <Select value={leadId} onValueChange={setLeadId}>
              <SelectTrigger data-testid="select-event-lead"><SelectValue placeholder="No lead" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No lead</SelectItem>
                {leads.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}{l.company ? ` (${l.company})` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Location / link <span className="text-muted-foreground">(optional)</span></Label>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Zoom link, address, or phone"
              data-testid="input-event-location"
            />
          </div>
          <div>
            <Label className="text-xs">Notes <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} data-testid="input-event-notes" />
          </div>
          {isEdit && (
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger data-testid="select-event-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="no_show">No-show</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          {isEdit && (
            <Button
              variant="destructive"
              size="sm"
              className="mr-auto"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              data-testid="button-delete-event"
            >
              <Trash2 className="h-4 w-4 mr-1" /> Delete
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={!title.trim() || !date || saveMutation.isPending}
            data-testid="button-save-event"
          >
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            {isEdit ? "Save Changes" : "Schedule Event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
