/**
 * @file Shared shaping helpers for FilteredResourceData prior to display.
 *
 * @module
 */
import { FilteredResourceData } from "@fnndsc/cumin";

/**
 * Removes duplicate column headers from a FilteredResourceData result.
 *
 * Keeps each selected field once (preserving first-seen order) and projects
 * every table row onto that unique header set.
 *
 * @param results - The resource data to de-duplicate.
 * @returns A new FilteredResourceData with unique selectedFields and matching rows.
 */
export function resourceColumns_removeDuplicates(
  results: FilteredResourceData
): FilteredResourceData {
  const uniqueHeaders: string[] = Array.from(new Set(results.selectedFields)) as string[];

  const uniqueTableData: Record<string, unknown>[] = results.tableData.map((row) =>
    uniqueHeaders.reduce<Record<string, unknown>>((acc, header) => {
      if (typeof header === "string" && header in row) {
        acc[header] = (row as Record<string, unknown>)[header];
      }
      return acc;
    }, {})
  );

  return {
    ...results,
    selectedFields: uniqueHeaders,
    tableData: uniqueTableData,
  };
}
