import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTicketDashboardCounts } from "../src/lib/tickets/map.ts";
import type { Ticket } from "../src/lib/tickets/types.ts";
import { fetchAllPages } from "../src/lib/supabase/fetch-all.ts";
import { sanitizeSearchTerm } from "../src/lib/search-term.ts";

function ticket(overrides: Partial<Ticket>): Ticket {
  return {
    id: "t", ticketNumber: "TIC-0001", reporterName: "Ana", reporterPhone: "600", reporterEmail: null,
    department: "Interno", title: "Test", category: "equipment", description: "", startedAt: null,
    blockingLevel: "not_blocked", restarted: false, hasErrorMessage: false, errorMessage: null,
    priority: "medium", status: "new", resolutionTime: null,
    createdAt: "2026-09-10T10:00:00.000Z", updatedAt: "2026-09-10T10:00:00.000Z",
    resolvedAt: null, closedAt: null, archivedAt: null,
    ...overrides,
  };
}

test("ticket counts follow the period, except the lifetime resolved total", () => {
  const tickets = [
    ticket({ id: "a", status: "new", priority: "high" }),
    ticket({ id: "b", status: "resolved", resolvedAt: "2026-09-11T10:00:00.000Z" }),
    ticket({ id: "c", status: "resolved", createdAt: "2026-05-01T10:00:00.000Z", resolvedAt: "2026-05-02T10:00:00.000Z" }),
  ];
  const september = { start: "2026-08-31T22:00:00.000Z", end: "2026-09-30T22:00:00.000Z" };
  const counts = computeTicketDashboardCounts(tickets, september, tickets);
  assert.equal(counts.newCount, 1);
  assert.equal(counts.openCount, 1);
  assert.equal(counts.resolvedPeriodCount, 1);
  assert.equal(counts.resolvedTotalCount, 2);
  assert.equal(counts.highPriorityCount, 1);
});

test("a ticket resolved after more than 3 days counts as slow", () => {
  const slow = ticket({ status: "resolved", createdAt: "2026-09-01T10:00:00.000Z", resolvedAt: "2026-09-06T10:00:00.000Z" });
  const quick = ticket({ id: "q", status: "resolved", createdAt: "2026-09-01T10:00:00.000Z", resolvedAt: "2026-09-02T10:00:00.000Z" });
  assert.equal(computeTicketDashboardCounts([slow, quick], undefined, [slow, quick]).staleCount, 1);
});

test("fetchAllPages keeps asking until a short page arrives", async () => {
  const all = Array.from({ length: 2345 }, (_, index) => index);
  const calls: [number, number][] = [];
  const { data, error } = await fetchAllPages(async (from, to) => {
    calls.push([from, to]);
    return { data: all.slice(from, to + 1), error: null };
  });
  assert.equal(error, null);
  assert.equal(data.length, 2345);
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test("fetchAllPages stops and reports the error", async () => {
  const { data, error } = await fetchAllPages(async (from) => (from === 0 ? { data: Array(1000).fill(1), error: null } : { data: null, error: new Error("boom") }));
  assert.equal(data.length, 1000);
  assert.ok(error instanceof Error);
});

test("search text cannot add filter clauses or wildcards", () => {
  assert.equal(sanitizeSearchTerm("vpn,status.eq.new"), "vpn status.eq.new");
  assert.equal(sanitizeSearchTerm("a)b(c%d_e*"), "a b c d e");
  assert.equal(sanitizeSearchTerm("  José   García "), "José García");
});
