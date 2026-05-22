import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Check, CalendarDays, Clock } from "lucide-react";
import { format, addDays, isWeekend, startOfDay, isSameDay } from "date-fns";

const BIZ_START_HOUR = 9;
const BIZ_END_HOUR = 17;
const SLOT_MIN = 30;
const LEAD_TIME_MS = 60 * 60 * 1000;

interface BookedRange {
  startAt: string;
  endAt: string | null;
}

function upcomingWeekdays(count: number): Date[] {
  const days: Date[] = [];
  let d = startOfDay(new Date());
  while (days.length < count) {
    if (!isWeekend(d)) days.push(d);
    d = addDays(d, 1);
  }
  return days;
}

function slotsForDate(date: Date): Date[] {
  const out: Date[] = [];
  for (let h = BIZ_START_HOUR; h < BIZ_END_HOUR; h++) {
    for (let m = 0; m < 60; m += SLOT_MIN) {
      const s = new Date(date);
      s.setHours(h, m, 0, 0);
      out.push(s);
    }
  }
  return out;
}

export default function BookPage() {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Date | null>(null);
  const [form, setForm] = useState({ name: "", email: "", company: "", website: "", notes: "" });
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState<Date | null>(null);

  const dates = useMemo(() => upcomingWeekdays(14), []);
  const dateKey = selectedDate ? format(selectedDate, "yyyy-MM-dd") : "";

  const { data: avail, isFetching: loadingSlots } = useQuery<{ booked: BookedRange[] }>({
    queryKey: ["/api/book/availability", dateKey],
    queryFn: async () => {
      const res = await fetch(`/api/book/availability?date=${dateKey}`);
      if (!res.ok) throw new Error("Failed to load times");
      return res.json();
    },
    enabled: !!selectedDate,
  });

  const slots = useMemo(() => {
    if (!selectedDate) return [];
    const booked = (avail?.booked ?? []).map((b) => ({
      s: new Date(b.startAt).getTime(),
      e: b.endAt ? new Date(b.endAt).getTime() : new Date(b.startAt).getTime() + SLOT_MIN * 60000,
    }));
    const minTime = Date.now() + LEAD_TIME_MS;
    return slotsForDate(selectedDate).map((slot) => {
      const s = slot.getTime();
      const e = s + SLOT_MIN * 60000;
      const taken = booked.some((b) => s < b.e && b.s < e);
      return { slot, available: !taken && s >= minTime };
    });
  }, [selectedDate, avail]);

  const bookMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, startAt: selectedSlot!.toISOString() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Booking failed");
      return data;
    },
    onSuccess: () => setConfirmed(selectedSlot),
    onError: (e: any) => setError(e?.message || "Something went wrong. Please try again."),
  });

  const set = (field: string, value: string) => setForm((p) => ({ ...p, [field]: value }));
  const canSubmit = form.name.trim() && form.email.includes("@") && selectedSlot && !bookMutation.isPending;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-3xl">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="bg-neutral-950 rounded-xl px-5 py-3.5 mb-5">
            <img src="/blackridge-logo.png" alt="BlackRidge Platforms" className="h-12 w-auto" />
          </div>
          {confirmed ? null : (
            <>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Book a Discovery Call</h1>
              <p className="text-muted-foreground text-sm mt-2 max-w-md">
                A relaxed 30-minute call about your website. No pressure, no obligation.
                Pick a time that works for you.
              </p>
            </>
          )}
        </div>

        {confirmed ? (
          <div className="rounded-2xl border border-border/60 bg-card p-10 text-center">
            <div className="h-14 w-14 rounded-full bg-green-500/15 flex items-center justify-center mx-auto mb-4">
              <Check className="h-7 w-7 text-green-500" />
            </div>
            <h2 className="text-xl font-bold">You're booked!</h2>
            <p className="text-foreground mt-2 font-medium">
              {format(confirmed, "EEEE, MMMM d")} at {format(confirmed, "h:mm a")}
            </p>
            <p className="text-muted-foreground text-sm mt-3">
              A confirmation is on its way to <span className="text-foreground">{form.email}</span>.
              Talk soon.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-border/60 bg-card p-6 sm:p-8 space-y-7">
            {/* Step 1 — date */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <CalendarDays className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">1. Pick a day</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {dates.map((d) => {
                  const active = selectedDate && isSameDay(d, selectedDate);
                  return (
                    <button
                      key={d.toISOString()}
                      onClick={() => { setSelectedDate(d); setSelectedSlot(null); setError(""); }}
                      className={`flex flex-col items-center rounded-lg border px-3 py-2 transition-colors min-w-[68px]
                        ${active
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border/60 hover:bg-muted/50"}`}
                      data-testid={`book-date-${format(d, "yyyy-MM-dd")}`}
                    >
                      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{format(d, "EEE")}</span>
                      <span className="text-base font-semibold">{format(d, "d")}</span>
                      <span className="text-[10px] text-muted-foreground">{format(d, "MMM")}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 2 — time */}
            {selectedDate && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold">2. Pick a time</span>
                  <span className="text-xs text-muted-foreground">(your local timezone)</span>
                </div>
                {loadingSlots ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : slots.every((s) => !s.available) ? (
                  <p className="text-sm text-muted-foreground py-2">
                    No times left on this day. Try another.
                  </p>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {slots.map(({ slot, available }) => {
                      const active = selectedSlot && slot.getTime() === selectedSlot.getTime();
                      return (
                        <button
                          key={slot.toISOString()}
                          disabled={!available}
                          onClick={() => { setSelectedSlot(slot); setError(""); }}
                          className={`rounded-lg border py-2 text-sm font-medium transition-colors
                            ${active
                              ? "border-primary bg-primary text-primary-foreground"
                              : available
                                ? "border-border/60 hover:bg-muted/50"
                                : "border-border/30 text-muted-foreground/40 cursor-not-allowed"}`}
                          data-testid={`book-slot-${slot.toISOString()}`}
                        >
                          {format(slot, "h:mm a")}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Step 3 — details */}
            {selectedSlot && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm font-semibold">3. Your details</span>
                </div>
                <div className="rounded-lg bg-muted/40 border border-border/50 px-3 py-2 mb-4 text-sm">
                  <span className="text-muted-foreground">Selected: </span>
                  <span className="font-medium">
                    {format(selectedSlot, "EEEE, MMMM d")} at {format(selectedSlot, "h:mm a")}
                  </span>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Name *</Label>
                    <Input value={form.name} onChange={(e) => set("name", e.target.value)} data-testid="book-input-name" />
                  </div>
                  <div>
                    <Label className="text-xs">Email *</Label>
                    <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} data-testid="book-input-email" />
                  </div>
                  <div>
                    <Label className="text-xs">Company</Label>
                    <Input value={form.company} onChange={(e) => set("company", e.target.value)} data-testid="book-input-company" />
                  </div>
                  <div>
                    <Label className="text-xs">Current website</Label>
                    <Input value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="example.com" data-testid="book-input-website" />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-xs">What would you like to cover? (optional)</Label>
                    <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} data-testid="book-input-notes" />
                  </div>
                </div>
                {error && (
                  <p className="text-sm text-destructive mt-3" data-testid="book-error">{error}</p>
                )}
                <Button
                  className="w-full mt-4"
                  size="lg"
                  disabled={!canSubmit}
                  onClick={() => { setError(""); bookMutation.mutate(); }}
                  data-testid="book-submit"
                >
                  {bookMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Confirm Booking
                </Button>
              </div>
            )}
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground mt-6">
          BlackRidge Platforms &middot; Websites, Portals, CRM &amp; AI Systems
        </p>
      </div>
    </div>
  );
}
