function formatUsd(n: number): string {
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

const CALL_TYPE_LABEL: Record<string, string> = {
  order_fillin_page: "Page fill-in",
  order_fillin_cover: "Cover fill-in",
  order_judge_page: "Page identity judge",
  order_judge_cover: "Cover identity judge",
  order_wardrobe_judge_page: "Page wardrobe judge",
  order_wardrobe_judge_cover: "Cover wardrobe judge",
  order_zone_judge_page: "Text-zone judge",
  order_preserve_judge_page: "Page preservation judge",
  order_preserve_judge_cover: "Cover preservation judge",
  order_dupe_judge_page: "Page duplication judge",
  order_dupe_judge_cover: "Cover duplication judge",
  order_reverify_judge_page: "Re-verify judge",
  costumed_sheet_generate: "Costumed sheet",
  costumed_sheet_judge: "Costumed sheet judge",
};

// Server-rendered summary of this order's real Gemini spend -- sits right on
// the order so cost is visible without cross-referencing Analytics. A
// "retry" is any order_fillin_page/cover call beyond the first for the same
// page (or cover) -- an exact count (extra fill-in calls only happen because
// an earlier attempt failed a judge), not an estimate.
export function OrderCostPanel({
  calls,
}: {
  calls: { call_type: string; page_id: string | null; estimated_cost_usd: number }[];
}) {
  const totalCost = calls.reduce((sum, c) => sum + (c.estimated_cost_usd ?? 0), 0);
  const imageCalls = calls.filter((c) => !c.call_type.includes("judge"));
  const validationCalls = calls.filter((c) => c.call_type.includes("judge"));
  const imageCost = imageCalls.reduce((sum, c) => sum + (c.estimated_cost_usd ?? 0), 0);
  const validationCost = validationCalls.reduce((sum, c) => sum + (c.estimated_cost_usd ?? 0), 0);

  const fillinKeys: Record<string, number> = {};
  for (const c of calls) {
    if (c.call_type === "order_fillin_page" || c.call_type === "order_fillin_cover") {
      const key = c.page_id ?? "cover";
      fillinKeys[key] = (fillinKeys[key] ?? 0) + 1;
    }
  }
  const retries = Object.values(fillinKeys).reduce((sum, n) => sum + Math.max(n - 1, 0), 0);

  const byType: Record<string, { count: number; cost: number }> = {};
  for (const c of calls) {
    if (!byType[c.call_type]) byType[c.call_type] = { count: 0, cost: 0 };
    byType[c.call_type].count++;
    byType[c.call_type].cost += c.estimated_cost_usd ?? 0;
  }
  const typeRows = Object.entries(byType).sort((a, b) => b[1].cost - a[1].cost);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Gemini cost for this order</h2>
        <span className="text-lg font-bold text-gray-800">{formatUsd(totalCost)}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm mb-4">
        <div>
          <p className="text-xs text-gray-400">Image-gen calls</p>
          <p className="font-medium">{imageCalls.length} · {formatUsd(imageCost)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Validation calls</p>
          <p className="font-medium">{validationCalls.length} · {formatUsd(validationCost)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Retries</p>
          <p className={`font-medium ${retries > 0 ? "text-amber-600" : ""}`}>{retries}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Total calls</p>
          <p className="font-medium">{calls.length}</p>
        </div>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-medium text-brand-600 hover:text-brand-700">
          Breakdown by call type
        </summary>
        <table className="w-full text-xs mt-2">
          <tbody className="divide-y divide-gray-50">
            {typeRows.map(([type, { count, cost }]) => (
              <tr key={type}>
                <td className="py-1.5 text-gray-600">{CALL_TYPE_LABEL[type] ?? type}</td>
                <td className="py-1.5 text-right text-gray-400 tabular-nums">{count}×</td>
                <td className="py-1.5 text-right font-medium text-gray-700 tabular-nums w-20">{formatUsd(cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
