/**
 * Cleans free text before it goes into a PostgREST `or()` filter: commas and
 * parentheses would let the text add or break filter clauses, and % _ * act as
 * wildcards.
 */
export function sanitizeSearchTerm(value: string): string {
  return value.replace(/[%_,()*\\"']/g, " ").replace(/\s+/g, " ").trim();
}
