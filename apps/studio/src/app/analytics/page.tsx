import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const EVENT_LABELS: Record<string, string> = {
  page_view: "Page View",
  book_viewed: "Book Viewed",
  order_started: "Order Started",
  order_abandoned: "Order Abandoned",
  order_submitted: "Order Submitted",
  form_error: "Form Error",
  sheet_timeout_fallback: "Sheet Timeout Fallback",
  preview_generated: "Preview Generated",
  cartoonize_started: "Cartoonize Started",
  cartoonize_completed: "Cartoonize Completed",
  cartoonize_failed: "Cartoonize Failed",
  cartoonize_safety_retry: "Cartoonize Safety Retry",
  image_load_failed: "Image Load Failed",
};

const EVENT_COLORS: Record<string, string> = {
  page_view: "bg-gray-100 text-gray-600",
  book_viewed: "bg-blue-100 text-blue-700",
  order_started: "bg-amber-100 text-amber-700",
  order_abandoned: "bg-red-100 text-red-700",
  order_submitted: "bg-green-100 text-green-700",
  form_error: "bg-red-200 text-red-800",
  sheet_timeout_fallback: "bg-orange-100 text-orange-700",
  preview_generated: "bg-purple-100 text-purple-700",
  cartoonize_started: "bg-indigo-100 text-indigo-700",
  cartoonize_completed: "bg-indigo-100 text-indigo-700",
  cartoonize_failed: "bg-red-200 text-red-800",
  cartoonize_safety_retry: "bg-orange-100 text-orange-700",
  image_load_failed: "bg-rose-100 text-rose-700",
};

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-3xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

type FunnelStep = {
  label: string;
  count: number;
  color: string;
};

function Funnel({ steps }: { steps: FunnelStep[] }) {
  const maxCount = Math.max(...steps.map((s) => s.count), 1);

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-800">User journey funnel</h2>
      </div>
      <div className="p-5 space-y-2">
        {steps.map((step, i) => {
          const prev = i > 0 ? steps[i - 1].count : null;
          const dropOff = prev && prev > 0 ? (((prev - step.count) / prev) * 100).toFixed(0) : null;
          const barWidth = maxCount > 0 ? Math.max((step.count / maxCount) * 100, 2) : 2;

          return (
            <div key={step.label}>
              {/* Drop-off indicator between steps */}
              {dropOff && (
                <div className="flex items-center gap-2 py-1.5 pl-3">
                  <svg className="w-3 h-3 text-red-400 shrink-0" viewBox="0 0 12 12" fill="none">
                    <path d="M6 2v8M3 7l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="text-xs text-red-400 font-medium">
                    {dropOff}% drop-off · {prev! - step.count} lost
                  </span>
                </div>
              )}

              {/* Step bar */}
              <div className="flex items-center gap-3">
                <div className="w-36 shrink-0">
                  <p className="text-sm font-medium text-gray-700 truncate">{step.label}</p>
                </div>
                <div className="flex-1 h-9 bg-gray-50 rounded-lg overflow-hidden relative">
                  <div
                    className={`h-full rounded-lg transition-all duration-700 ${step.color}`}
                    style={{ width: `${barWidth}%` }}
                  />
                  <span className="absolute inset-y-0 right-3 flex items-center text-sm font-bold text-gray-700 tabular-nums">
                    {step.count}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Buckets the 12 gemini_call_log call_types into a few broad groups for
// compact display -- a column per exact type would make the per-book table
// unreadably wide.
function callTypeGroup(callType: string): "Template" | "Age bands" | "Character" | "Costume" | "Order" {
  if (callType.startsWith("template_age_band")) return "Age bands";
  if (callType.startsWith("template_")) return "Template";
  if (callType.startsWith("character_")) return "Character";
  if (callType.startsWith("costumed_sheet_")) return "Costume";
  return "Order";
}

function formatUsd(n: number): string {
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

export default async function AnalyticsPage() {
  const supabase = createServerClient();

  const [{ data: events }, { data: stories }, { data: geminiCalls }, { data: ordersForCost }] = await Promise.all([
    supabase
      .from("analytics_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase
      .from("stories")
      .select("id, title, slug"),
    supabase
      .from("gemini_call_log")
      .select("call_type, story_id, page_id, order_id, estimated_cost_usd, created_at")
      .order("created_at", { ascending: false })
      .limit(20000),
    supabase
      .from("orders")
      .select("id, hero_name, story_id, status, created_at"),
  ]);

  const allEvents = events ?? [];
  const storyMap = Object.fromEntries((stories ?? []).map((s) => [s.id, s]));
  const allGeminiCalls = geminiCalls ?? [];
  const orderMap = Object.fromEntries((ordersForCost ?? []).map((o) => [o.id, o]));

  const count = (name: string) => allEvents.filter((e) => e.event_name === name).length;

  // Deduplicate preview_generated by order_id for funnel (each order = 1 preview)
  const uniquePreviewOrders = new Set(
    allEvents.filter((e) => e.event_name === "preview_generated" && e.order_id).map((e) => e.order_id)
  ).size;

  const pageViews = count("page_view");
  const bookViews = count("book_viewed");
  const ordersStarted = count("order_started");
  const cartoonizeStarted = count("cartoonize_started");
  const cartoonizeCompleted = count("cartoonize_completed");
  const ordersSubmitted = count("order_submitted");
  const ordersAbandoned = count("order_abandoned");
  const sheetTimeouts = count("sheet_timeout_fallback");
  const imageLoadFailures = count("image_load_failed");

  // Funnel steps
  const funnelSteps: FunnelStep[] = [
    { label: "Site visits", count: pageViews, color: "bg-gray-300" },
    { label: "Book viewed", count: bookViews, color: "bg-blue-400" },
    { label: "Started order", count: ordersStarted, color: "bg-amber-400" },
    { label: "Cartoonized", count: cartoonizeCompleted, color: "bg-indigo-400" },
    { label: "Created preview", count: ordersSubmitted, color: "bg-green-400" },
    { label: "Saw preview", count: uniquePreviewOrders, color: "bg-purple-400" },
  ];

  const conversionRate =
    ordersStarted > 0 ? ((ordersSubmitted / ordersStarted) * 100).toFixed(1) : "—";

  // Per-story breakdown
  const storyStats: Record<string, { title: string; slug: string; views: number; started: number; submitted: number }> = {};
  for (const e of allEvents) {
    if (!e.story_id) continue;
    const story = storyMap[e.story_id];
    if (!story) continue;
    if (!storyStats[e.story_id]) {
      storyStats[e.story_id] = { title: story.title, slug: story.slug, views: 0, started: 0, submitted: 0 };
    }
    if (e.event_name === "book_viewed") storyStats[e.story_id].views++;
    if (e.event_name === "order_started") storyStats[e.story_id].started++;
    if (e.event_name === "order_submitted") storyStats[e.story_id].submitted++;
  }
  const storyRows = Object.values(storyStats).sort((a, b) => b.views - a.views);

  const recentEvents = allEvents.slice(0, 50);

  // ── Gemini call log: per-book + trends ────────────────────────────────────
  const GROUPS = ["Template", "Age bands", "Character", "Costume", "Order"] as const;

  const now = Date.now();
  const callsToday = allGeminiCalls.filter((c) => now - new Date(c.created_at).getTime() < 24 * 60 * 60 * 1000).length;
  const callsLast7Days = allGeminiCalls.filter((c) => now - new Date(c.created_at).getTime() < 7 * 24 * 60 * 60 * 1000).length;

  type BookGeminiStats = { title: string; total: number; cost: number; orderCount: number; costPerOrder: number; byGroup: Record<(typeof GROUPS)[number], number> };
  const bookGeminiStats: Record<string, BookGeminiStats> = {};
  const bookOrderIds: Record<string, Set<string>> = {};
  for (const c of allGeminiCalls) {
    if (!c.story_id) continue;
    const story = storyMap[c.story_id];
    if (!story) continue;
    if (!bookGeminiStats[c.story_id]) {
      bookGeminiStats[c.story_id] = {
        title: story.title,
        total: 0,
        cost: 0,
        orderCount: 0,
        costPerOrder: 0,
        byGroup: { Template: 0, "Age bands": 0, Character: 0, Costume: 0, Order: 0 },
      };
      bookOrderIds[c.story_id] = new Set();
    }
    bookGeminiStats[c.story_id].total++;
    bookGeminiStats[c.story_id].cost += c.estimated_cost_usd ?? 0;
    bookGeminiStats[c.story_id].byGroup[callTypeGroup(c.call_type)]++;
    if (c.order_id) bookOrderIds[c.story_id].add(c.order_id);
  }
  for (const storyId of Object.keys(bookGeminiStats)) {
    const orderCount = bookOrderIds[storyId].size;
    bookGeminiStats[storyId].orderCount = orderCount;
    bookGeminiStats[storyId].costPerOrder = orderCount > 0 ? bookGeminiStats[storyId].cost / orderCount : 0;
  }
  const bookGeminiRows = Object.values(bookGeminiStats).sort((a, b) => b.cost - a.cost);

  // ── Per-order cost: total spend, image-gen vs. validation split, retries ──
  // A "retry" is any fill-in attempt beyond the first for the same (order,
  // page) or (order, cover) -- the whole reason a page needs >1 fill-in call
  // is that an earlier attempt failed a judge, so counting extra fill-in
  // calls is an exact retry count, not an estimate.
  type OrderCostStats = {
    orderId: string; heroName: string; storyTitle: string; status: string;
    imageCalls: number; validationCalls: number; cost: number; retries: number;
  };
  const orderCostStats: Record<string, OrderCostStats> = {};
  const orderFillinKeys: Record<string, Record<string, number>> = {};
  for (const c of allGeminiCalls) {
    if (!c.order_id) continue;
    const order = orderMap[c.order_id];
    if (!order) continue;
    if (!orderCostStats[c.order_id]) {
      orderCostStats[c.order_id] = {
        orderId: c.order_id,
        heroName: order.hero_name,
        storyTitle: order.story_id ? (storyMap[order.story_id]?.title ?? "—") : "—",
        status: order.status,
        imageCalls: 0, validationCalls: 0, cost: 0, retries: 0,
      };
      orderFillinKeys[c.order_id] = {};
    }
    const stats = orderCostStats[c.order_id];
    stats.cost += c.estimated_cost_usd ?? 0;
    if (c.call_type.includes("judge")) {
      stats.validationCalls++;
    } else {
      stats.imageCalls++;
      if (c.call_type === "order_fillin_page" || c.call_type === "order_fillin_cover") {
        const key = c.page_id ?? "cover";
        orderFillinKeys[c.order_id][key] = (orderFillinKeys[c.order_id][key] ?? 0) + 1;
      }
    }
  }
  for (const orderId of Object.keys(orderCostStats)) {
    orderCostStats[orderId].retries = Object.values(orderFillinKeys[orderId]).reduce((sum, n) => sum + Math.max(n - 1, 0), 0);
  }
  const orderCostRows = Object.values(orderCostStats).sort((a, b) => b.cost - a.cost);
  const totalSpend = allGeminiCalls.reduce((sum, c) => sum + (c.estimated_cost_usd ?? 0), 0);
  const spendToday = allGeminiCalls.filter((c) => now - new Date(c.created_at).getTime() < 24 * 60 * 60 * 1000).reduce((sum, c) => sum + (c.estimated_cost_usd ?? 0), 0);
  const spendLast7Days = allGeminiCalls.filter((c) => now - new Date(c.created_at).getTime() < 7 * 24 * 60 * 60 * 1000).reduce((sum, c) => sum + (c.estimated_cost_usd ?? 0), 0);
  const avgCostPerOrder = orderCostRows.length > 0 ? orderCostRows.reduce((sum, o) => sum + o.cost, 0) / orderCostRows.length : 0;
  const totalRetries = orderCostRows.reduce((sum, o) => sum + o.retries, 0);
  const totalValidationCost = allGeminiCalls.filter((c) => c.call_type.includes("judge")).reduce((sum, c) => sum + (c.estimated_cost_usd ?? 0), 0);
  const totalImageCost = totalSpend - totalValidationCost;

  // Last 14 days, oldest first, for the trend table.
  const dayBuckets: { date: string; label: string; count: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000);
    dayBuckets.push({
      date: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      count: 0,
    });
  }
  const dayIndex = Object.fromEntries(dayBuckets.map((b, i) => [b.date, i]));
  for (const c of allGeminiCalls) {
    const day = c.created_at.slice(0, 10);
    const idx = dayIndex[day];
    if (idx !== undefined) dayBuckets[idx].count++;
  }
  const maxDayCount = Math.max(...dayBuckets.map((b) => b.count), 1);

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-sm text-gray-400 mt-1">Store telemetry · last 5 000 events</p>
      </div>

      {/* Funnel */}
      <Funnel steps={funnelSteps} />

      {/* Overview cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        <StatCard label="Conversion" value={conversionRate === "—" ? "—" : `${conversionRate}%`} sub="started → preview" />
        <StatCard label="Abandoned" value={ordersAbandoned} sub="left before submitting" />
        <StatCard label="Sheet timeouts" value={sheetTimeouts} sub={`of ${cartoonizeCompleted} cartoonizes`} />
        <StatCard label="Form errors" value={count("form_error")} />
        <StatCard label="Image load failures" value={imageLoadFailures} />
      </div>

      {/* Gemini call log */}
      <div>
        <h2 className="text-lg font-bold text-gray-800 mb-3">Gemini usage &amp; cost</h2>
        <p className="text-xs text-gray-400 -mt-2 mb-4">
          Costs are estimated per call_type (not metered actuals) — see lib/geminiPricing.ts. Image-generation calls (fill-ins, template/character/costume art) cost ~200x a validation judge call.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-4">
          <StatCard label="Total spend" value={formatUsd(totalSpend)} sub={`${allGeminiCalls.length} calls logged`} />
          <StatCard label="Spend today" value={formatUsd(spendToday)} sub={`${callsToday} calls`} />
          <StatCard label="Spend, 7 days" value={formatUsd(spendLast7Days)} sub={`${callsLast7Days} calls`} />
          <StatCard label="Avg cost / order" value={formatUsd(avgCostPerOrder)} sub={`${orderCostRows.length} orders`} />
          <StatCard label="Image-gen spend" value={formatUsd(totalImageCost)} sub={`of ${formatUsd(totalSpend)} total`} />
          <StatCard label="Wasted on retries" value={totalRetries} sub="extra fill-in attempts" />
        </div>

        {/* Trend */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-4">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-800">Calls per day — last 14 days</h3>
          </div>
          <div className="p-5 space-y-1.5">
            {dayBuckets.map((b) => (
              <div key={b.date} className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-xs text-gray-400 tabular-nums">{b.label}</span>
                <div className="flex-1 h-6 bg-gray-50 rounded overflow-hidden relative">
                  <div
                    className="h-full rounded bg-sky-400 transition-all duration-700"
                    style={{ width: `${Math.max((b.count / maxDayCount) * 100, b.count > 0 ? 2 : 0)}%` }}
                  />
                  <span className="absolute inset-y-0 right-2 flex items-center text-xs font-medium text-gray-600 tabular-nums">
                    {b.count}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Per-book Gemini breakdown */}
        {bookGeminiRows.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-4">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">Cost &amp; calls per book</h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100">
                  <th className="text-left px-5 py-3">Book</th>
                  <th className="text-right px-5 py-3">Total cost</th>
                  <th className="text-right px-5 py-3">Orders</th>
                  <th className="text-right px-5 py-3">Cost / order</th>
                  <th className="text-right px-5 py-3">Calls</th>
                  {GROUPS.map((g) => (
                    <th key={g} className="text-right px-5 py-3">{g}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {bookGeminiRows.map((row) => (
                  <tr key={row.title} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-gray-800">{row.title}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-semibold text-gray-700">{formatUsd(row.cost)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-500">{row.orderCount || "—"}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-500">{row.orderCount > 0 ? formatUsd(row.costPerOrder) : "—"}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-500">{row.total}</td>
                    {GROUPS.map((g) => (
                      <td key={g} className="px-5 py-3 text-right tabular-nums text-gray-500">{row.byGroup[g] || "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Per-order cost breakdown -- the detailed view: image-gen vs.
            validation split and retry count, so expensive outliers and
            retry-heavy orders are easy to spot. */}
        {orderCostRows.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">Cost per order</h3>
              <p className="text-xs text-gray-400 mt-0.5">Sorted most expensive first</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100">
                  <th className="text-left px-5 py-3">Order</th>
                  <th className="text-left px-5 py-3">Book</th>
                  <th className="text-left px-5 py-3">Status</th>
                  <th className="text-right px-5 py-3">Image calls</th>
                  <th className="text-right px-5 py-3">Validation calls</th>
                  <th className="text-right px-5 py-3">Retries</th>
                  <th className="text-right px-5 py-3">Total cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {orderCostRows.map((row) => (
                  <tr key={row.orderId} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3">
                      <a href={`/orders/${row.orderId}`} className="font-medium text-brand-600 hover:text-brand-700">{row.heroName}</a>
                    </td>
                    <td className="px-5 py-3 text-gray-600">{row.storyTitle}</td>
                    <td className="px-5 py-3 text-gray-500">{row.status}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-500">{row.imageCalls}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-500">{row.validationCalls}</td>
                    <td className={`px-5 py-3 text-right tabular-nums ${row.retries > 0 ? "text-amber-600 font-medium" : "text-gray-400"}`}>
                      {row.retries || "—"}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums font-semibold text-gray-700">{formatUsd(row.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Per-book */}
      {storyRows.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">Per-book breakdown</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <th className="text-left px-5 py-3">Book</th>
                <th className="text-right px-5 py-3">Views</th>
                <th className="text-right px-5 py-3">Started</th>
                <th className="text-right px-5 py-3">Submitted</th>
                <th className="text-right px-5 py-3">Conv.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {storyRows.map((row) => {
                const conv = row.started > 0 ? ((row.submitted / row.started) * 100).toFixed(0) + "%" : "—";
                return (
                  <tr key={row.slug} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-gray-800">{row.title}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-600">{row.views}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-600">{row.started}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-600">{row.submitted}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-medium text-gray-700">{conv}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Recent events */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">Recent events</h2>
        </div>
        {recentEvents.length === 0 ? (
          <p className="text-center py-12 text-gray-400 text-sm">No events recorded yet.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {recentEvents.map((e) => {
              const story = e.story_id ? storyMap[e.story_id] : null;
              const props = e.properties as Record<string, unknown>;
              const path = props?.path as string | undefined;
              const failedImageSrc = e.event_name === "image_load_failed" ? (props?.src as string | undefined) : undefined;
              const failedImageContext = e.event_name === "image_load_failed" ? (props?.context as string | undefined) : undefined;
              const label = EVENT_LABELS[e.event_name] ?? e.event_name;
              const colorClass = EVENT_COLORS[e.event_name] ?? "bg-gray-100 text-gray-600";
              const ts = new Date(e.created_at);
              return (
                <div key={e.id} className="flex items-start gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                  <span className={`mt-0.5 shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${colorClass}`}>
                    {label}
                  </span>
                  <div className="flex-1 min-w-0">
                    {story && (
                      <span className="text-sm font-medium text-gray-700 mr-2">{story.title}</span>
                    )}
                    {path && !story && (
                      <span className="text-sm text-gray-500 font-mono truncate">{path}</span>
                    )}
                    {failedImageContext && (
                      <span className="text-sm text-gray-600 mr-2">{failedImageContext}</span>
                    )}
                    {failedImageSrc && (
                      <span className="text-xs text-gray-400 font-mono truncate block max-w-md">{failedImageSrc}</span>
                    )}
                    {e.session_id && (
                      <span className="text-xs text-gray-300 font-mono ml-1">
                        sid:{e.session_id.slice(0, 8)}
                      </span>
                    )}
                  </div>
                  <time className="shrink-0 text-xs text-gray-400 tabular-nums">
                    {ts.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </time>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
