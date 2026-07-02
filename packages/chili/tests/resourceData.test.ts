import { resourceColumns_removeDuplicates } from '../src/utils/resourceData';
import type { FilteredResourceData } from '@fnndsc/cumin';

describe('resourceColumns_removeDuplicates', () => {
  it('collapses duplicate selected fields and projects rows onto them', () => {
    const input = {
      selectedFields: ['id', 'name', 'id'],
      tableData: [{ id: 1, name: 'a', extra: 'x' }],
    } as unknown as FilteredResourceData;

    const out = resourceColumns_removeDuplicates(input);
    expect(out.selectedFields).toEqual(['id', 'name']);
    expect(out.tableData).toEqual([{ id: 1, name: 'a' }]); // 'extra' dropped
  });

  it('leaves already-unique fields untouched', () => {
    const input = {
      selectedFields: ['id', 'name'],
      tableData: [{ id: 2, name: 'b' }],
    } as unknown as FilteredResourceData;
    expect(resourceColumns_removeDuplicates(input).selectedFields).toEqual(['id', 'name']);
  });
});
