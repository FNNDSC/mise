import {
  dagNodeStatusSchema,
  feedDagModelSchema,
  pipelineDiagramModelSchema,
} from '../src/dag';

describe('pipelineDiagramModelSchema', () => {
  it('accepts an authored template with joins and arguments', () => {
    const result = pipelineDiagramModelSchema.safeParse({
      name: 'PHI_detection',
      pipelineId: 12,
      nodes: [
        { id: '1', label: 'root', parentIds: [], joinParentIds: [], pluginName: 'pl-dircopy' },
        {
          id: '2',
          label: 'detect',
          parentIds: ['1'],
          joinParentIds: [],
          pluginName: 'pl-phi_detector',
          arguments: [{ name: 'threshold', value: 0.5 }],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a node missing its plugin name', () => {
    const result = pipelineDiagramModelSchema.safeParse({
      name: 'x',
      nodes: [{ id: '1', label: 'root', parentIds: [], joinParentIds: [] }],
    });
    expect(result.success).toBe(false);
  });
});

describe('feedDagModelSchema', () => {
  it('accepts a live graph whose nodes carry status, address, and metrics', () => {
    const result = feedDagModelSchema.safeParse({
      feedId: 1669,
      feedName: 'Archive of LLD_anon',
      nodes: [
        {
          id: '582750',
          label: 'dircopy',
          parentIds: [],
          joinParentIds: [],
          instanceId: 582750,
          pluginName: 'pl-dircopy',
          status: 'finishedSuccessfully',
          vfsPath: '/home/x/feeds/feed_1669/pl-dircopy_582750/data',
          metrics: { computeSeconds: 6 },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('degrades an unrecognized status to unknown instead of failing', () => {
    expect(dagNodeStatusSchema.parse('quantum-flux')).toBe('unknown');
  });
});
