"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { archiveOrders, unarchiveOrders } from "./archiveActions";
import { confirmPayment } from "./actions";

const STATUS_BADGE: Record<string, string> = {
  pending_payment:    "bg-yellow-100 text-yellow-700",
  payment_submitted:  "bg-orange-100 text-orange-700",
  paid:               "bg-blue-100 text-blue-700",
  generating:      "bg-purple-100 text-purple-700",
  preview_ready:   "bg-amber-100 text-amber-700",
  pdf_ready:       "bg-green-100 text-green-700",
  sent_to_print:   "bg-gray-100 text-gray-700",
  shipped:         "bg-green-100 text-green-700",
  delivered:       "bg-green-200 text-green-800",
};

export type OrderItem = {
  id: string;
  hero_name: string;
  language: string;
  status: string;
  amount_usd: number;
  archived: boolean;
  created_at: string;
  story: { id: string; title: string } | null;
  needs_attention?: boolean;
};

interface Props {
  orders: OrderItem[];
}

export function OrdersList({ orders }: Props) {
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const filtered = orders.filter((o) => (tab === "active" ? !o.archived : o.archived));

  // Group by book
  const groups: Record<string, { title: string; orders: OrderItem[] }> = {};
  const ungrouped: OrderItem[] = [];
  for (const order of filtered) {
    if (order.story) {
      if (!groups[order.story.id]) groups[order.story.id] = { title: order.story.title, orders: [] };
      groups[order.story.id].orders.push(order);
    } else {
      ungrouped.push(order);
    }
  }
  const sortedGroups = Object.entries(groups).sort(
    (a, b) =>
      new Date(b[1].orders[0].created_at).getTime() -
      new Date(a[1].orders[0].created_at).getTime()
  );
  if (ungrouped.length > 0) sortedGroups.push(["__none__", { title: "Unknown book", orders: ungrouped }]);

  const allIds = filtered.map((o) => o.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someSelected = allIds.some((id) => selected.has(id));
  const selectedCount = allIds.filter((id) => selected.has(id)).length;

  function toggleAll() {
    if (allSelected) {
      setSelected((s) => { const n = new Set(s); allIds.forEach((id) => n.delete(id)); return n; });
    } else {
      setSelected((s) => new Set([...s, ...allIds]));
    }
  }

  function toggleOne(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function handleArchive() {
    const ids = allIds.filter((id) => selected.has(id));
    startTransition(async () => {
      await archiveOrders(ids);
      setSelected(new Set());
    });
  }

  function handleUnarchive() {
    const ids = allIds.filter((id) => selected.has(id));
    startTransition(async () => {
      await unarchiveOrders(ids);
      setSelected(new Set());
    });
  }

  const activeCount = orders.filter((o) => !o.archived).length;
  const archivedCount = orders.filter((o) => o.archived).length;

  return (
    <div className="space-y-6">
      {/* Tabs + bulk actions bar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 border-b border-gray-200">
          {(["active", "archived"] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setSelected(new Set()); }}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t
                  ? "border-brand-500 text-brand-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t === "active" ? "Active" : "Archived"}
              <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                {t === "active" ? activeCount : archivedCount}
              </span>
            </button>
          ))}
        </div>

        {someSelected && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{selectedCount} selected</span>
            {tab === "active" ? (
              <button
                onClick={handleArchive}
                disabled={isPending}
                className="text-sm font-medium px-4 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {isPending ? "Archiving…" : "Archive"}
              </button>
            ) : (
              <button
                onClick={handleUnarchive}
                disabled={isPending}
                className="text-sm font-medium px-4 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {isPending ? "Restoring…" : "Restore"}
              </button>
            )}
          </div>
        )}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-gray-400 text-sm">
          No {tab} orders.
        </div>
      )}

      {sortedGroups.map(([storyId, group]) => (
        <div key={storyId} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">{group.title}</h2>
            <span className="text-xs text-gray-400">{group.orders.length} order{group.orders.length !== 1 ? "s" : ""}</span>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <th className="px-4 py-2.5 w-8">
                  <input
                    type="checkbox"
                    checked={group.orders.every((o) => selected.has(o.id))}
                    ref={(el) => {
                      if (el) el.indeterminate = group.orders.some((o) => selected.has(o.id)) && !group.orders.every((o) => selected.has(o.id));
                    }}
                    onChange={() => {
                      const ids = group.orders.map((o) => o.id);
                      const allGroupSelected = ids.every((id) => selected.has(id));
                      setSelected((s) => {
                        const n = new Set(s);
                        if (allGroupSelected) ids.forEach((id) => n.delete(id));
                        else ids.forEach((id) => n.add(id));
                        return n;
                      });
                    }}
                    className="rounded border-gray-300 text-brand-500 focus:ring-brand-400 cursor-pointer"
                  />
                </th>
                <th className="text-left px-4 py-2.5">Order ID</th>
                <th className="text-left px-4 py-2.5">Hero</th>
                <th className="text-left px-4 py-2.5">Language</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-right px-4 py-2.5">Amount</th>
                <th className="text-right px-4 py-2.5">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {group.orders.map((order) => (
                <tr
                  key={order.id}
                  className={`hover:bg-gray-50 transition-colors ${selected.has(order.id) ? "bg-brand-50" : ""}`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(order.id)}
                      onChange={() => toggleOne(order.id)}
                      className="rounded border-gray-300 text-brand-500 focus:ring-brand-400 cursor-pointer"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/orders/${order.id}`}
                      className="font-mono text-xs text-brand-600 hover:text-brand-800 transition-colors"
                      title={order.id}
                    >
                      {order.id.slice(0, 8)}…
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/orders/${order.id}`}
                      className="font-medium text-gray-900 hover:text-brand-600 transition-colors"
                    >
                      {order.hero_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-500 uppercase text-xs font-medium">
                    {order.language}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[order.status] ?? "bg-gray-100 text-gray-600"}`}>
                        {order.status.replace(/_/g, " ")}
                      </span>
                      {order.needs_attention && (
                        <span
                          title="One or more pages failed to generate — open the order to retry"
                          className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700"
                        >
                          ⚠ needs attention
                        </span>
                      )}
                      {order.status === "payment_submitted" && (
                        <ConfirmPaymentButton orderId={order.id} />
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-700">
                    ${order.amount_usd}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-gray-400 tabular-nums whitespace-nowrap">
                    {new Date(order.created_at).toLocaleDateString(undefined, {
                      month: "short", day: "numeric", year: "numeric",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* Select-all footer when there are multiple groups */}
      {sortedGroups.length > 1 && filtered.length > 0 && (
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
            onChange={toggleAll}
            className="rounded border-gray-300 text-brand-500 focus:ring-brand-400 cursor-pointer"
          />
          <span>{allSelected ? "Deselect all" : "Select all"} ({filtered.length})</span>
        </div>
      )}
    </div>
  );
}

function ConfirmPaymentButton({ orderId }: { orderId: string }) {
  const [, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  if (done) return <span className="text-xs text-green-600 font-medium">✓ Confirmed</span>;

  return (
    <button
      onClick={() => startTransition(async () => {
        await confirmPayment(orderId);
        setDone(true);
      })}
      className="text-xs bg-orange-500 hover:bg-orange-600 text-white font-semibold px-2 py-0.5 rounded-full transition-colors"
    >
      Confirm payment
    </button>
  );
}
