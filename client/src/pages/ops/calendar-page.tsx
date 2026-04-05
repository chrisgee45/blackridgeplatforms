import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  CheckSquare,
  Flag,
  Receipt,
  DollarSign,
} from "lucide-react";

interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  event_type: "follow_up" | "task" | "milestone" | "bill" | "tax_payment";
  color: string;
  detail?: string;
  project_name?: string;
  vendor_name?: string;
  amount?: number | string;
}

const EVENT_TYPE_CONFIG: Record<
  string,
  { label: string; icon: typeof CalendarIcon; route: string }
> = {
  follow_up: { label: "Follow-up", icon: CalendarIcon, route: "/admin" },
  task: { label: "Task", icon: CheckSquare, route: "/admin/ops/tasks" },
  milestone: { label: "Milestone", icon: Flag, route: "/admin/ops/projects" },
  bill: { label: "Bill", icon: Receipt, route: "/admin/ops/expenses" },
  tax_payment: { label: "Tax Payment", icon: DollarSign, route: "/admin/ops/tax-center" },
};

const EVENT_COLORS: Record<string, string> = {
  follow_up: "bg-amber-500",
  task: "bg-blue-500",
  milestone: "bg-purple-500",
  bill: "bg-red-500",
  tax_payment: "bg-emerald-500",
};

const EVENT_TEXT_COLORS: Record<string, string> = {
  follow_up: "text-amber-500",
  task: "text-blue-500",
  milestone: "text-purple-500",
  bill: "text-red-500",
  tax_payment: "text-emerald-500",
};

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const days: Date[] = [];
  const startDate = new Date(year, month, 1 - startOffset);
  for (let i = 0; i < 42; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    days.push(d);
  }
  return days;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function CalendarPage() {
  const [, navigate] = useLocation();
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const calendarDays = useMemo(() => getCalendarDays(currentYear, currentMonth), [currentYear, currentMonth]);

  const startDate = formatDate(calendarDays[0]);
  const endDate = formatDate(calendarDays[calendarDays.length - 1]);

  const { data: events, isLoading } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/ops/calendar-events", startDate, endDate],
    queryFn: async () => {
      const res = await fetch(`/api/ops/calendar-events?startDate=${startDate}&endDate=${endDate}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    (events ?? []).forEach((evt) => {
      const dateKey = evt.date?.substring(0, 10);
      if (!dateKey) return;
      if (!map.has(dateKey)) map.set(dateKey, []);
      map.get(dateKey)!.push(evt);
    });
    return map;
  }, [events]);

  const selectedDayEvents = useMemo(() => {
    if (!selectedDay) return [];
    return eventsByDate.get(formatDate(selectedDay)) ?? [];
  }, [selectedDay, eventsByDate]);

  function goToPrevMonth() {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  }

  function goToNextMonth() {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  }

  function handleEventClick(evt: CalendarEvent) {
    const config = EVENT_TYPE_CONFIG[evt.event_type];
    if (config) {
      navigate(config.route);
    }
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Calendar</h1>
        <p className="text-muted-foreground text-sm mt-1">View upcoming events, deadlines, and payments</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <CalendarIcon className="w-5 h-5 text-muted-foreground" />
            <CardTitle className="text-lg" data-testid="text-month-year">
              {MONTH_NAMES[currentMonth]} {currentYear}
            </CardTitle>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              onClick={goToPrevMonth}
              data-testid="button-prev-month"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={goToNextMonth}
              data-testid="button-next-month"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : (
            <div>
              <div className="grid grid-cols-7 gap-px mb-1">
                {DAYS_OF_WEEK.map((day) => (
                  <div
                    key={day}
                    className="text-center text-xs font-medium text-muted-foreground py-2"
                    data-testid={`header-day-${day.toLowerCase()}`}
                  >
                    {day}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-px">
                {calendarDays.map((day, idx) => {
                  const dateKey = formatDate(day);
                  const dayEvents = eventsByDate.get(dateKey) ?? [];
                  const isCurrentMonth = day.getMonth() === currentMonth;
                  const isToday = isSameDay(day, today);
                  const visibleEvents = dayEvents.slice(0, 3);
                  const moreCount = dayEvents.length - 3;

                  return (
                    <div
                      key={idx}
                      className={`min-h-[5rem] p-1 border border-border/40 rounded-md cursor-pointer hover-elevate ${
                        !isCurrentMonth ? "opacity-40" : ""
                      } ${isToday ? "ring-2 ring-primary" : ""}`}
                      onClick={() => setSelectedDay(day)}
                      data-testid={`cell-day-${dateKey}`}
                    >
                      <div
                        className={`text-xs font-medium mb-0.5 ${
                          isToday ? "text-primary font-bold" : isCurrentMonth ? "" : "text-muted-foreground"
                        }`}
                        data-testid={`text-day-number-${dateKey}`}
                      >
                        {day.getDate()}
                      </div>
                      <div className="space-y-0.5">
                        {visibleEvents.map((evt) => (
                          <div
                            key={`${evt.event_type}-${evt.id}`}
                            className="flex items-center gap-1"
                            data-testid={`event-pill-${evt.event_type}-${evt.id}`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${EVENT_COLORS[evt.event_type]}`} />
                            <span className="text-[10px] truncate leading-tight">
                              {evt.title}
                            </span>
                          </div>
                        ))}
                        {moreCount > 0 && (
                          <span
                            className="text-[10px] text-muted-foreground pl-2.5"
                            data-testid={`text-more-events-${dateKey}`}
                          >
                            +{moreCount} more
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedDay} onOpenChange={(open) => !open && setSelectedDay(null)}>
        <DialogContent data-testid="dialog-day-events">
          <DialogHeader>
            <DialogTitle data-testid="text-dialog-title">
              {selectedDay
                ? selectedDay.toLocaleDateString("en-US", {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })
                : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {selectedDayEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center" data-testid="text-no-events">
                No events on this day
              </p>
            ) : (
              selectedDayEvents.map((evt) => {
                const config = EVENT_TYPE_CONFIG[evt.event_type];
                const Icon = config?.icon ?? CalendarIcon;
                return (
                  <div
                    key={`${evt.event_type}-${evt.id}`}
                    className="flex items-start gap-3 p-3 rounded-md hover-elevate cursor-pointer"
                    onClick={() => handleEventClick(evt)}
                    data-testid={`event-item-${evt.event_type}-${evt.id}`}
                  >
                    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${EVENT_TEXT_COLORS[evt.event_type]}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{evt.title}</span>
                        <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate text-[10px]">
                          {config?.label ?? evt.event_type}
                        </Badge>
                      </div>
                      {evt.project_name && (
                        <p className="text-xs text-muted-foreground mt-0.5">{evt.project_name}</p>
                      )}
                      {evt.vendor_name && (
                        <p className="text-xs text-muted-foreground mt-0.5">{evt.vendor_name}</p>
                      )}
                      {evt.detail && (
                        <p className="text-xs text-muted-foreground mt-0.5">{evt.detail}</p>
                      )}
                      {evt.amount != null && (
                        <p className="text-xs font-medium mt-0.5">
                          ${Number(evt.amount).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
