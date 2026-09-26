/**
 * @file The space arranged by DATA: descriptions compared by their words,
 * hubs chained format → modality → description group, every feed hung from
 * its deepest hub, and a hub's tip saying where it is and how many feeds.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { descriptionWords_of, wordOverlap_of, descriptionGroups_of, dataPath_of, dataGraph_build, dataHubId_of, dataHubKey_of, dataHubTip_of } from '../../src/features/dag/dataSpace.js';
import { groupId_of, type LandedFeed } from '../../src/features/dag/universe.js';

const feed = (id: number, data?: LandedFeed['data']): LandedFeed => ({
  id, title: `f${id}`, jobs: 1, status: 'finishedSuccessfully', chain: ['pl-dircopy'],
  groups: [{ plugin: 'pl-dircopy', count: 1, errored: 0, status: 'finishedSuccessfully', parent: null }, { plugin: 'pl-x', count: 3, errored: 0, status: 'finishedSuccessfully', parent: 0 }],
  ...(data === undefined ? {} : { data }),
});

describe('descriptions compared by their words', () => {
  it('keeps the words that name the sequence and drops sizes, fields of view and numbers', () => {
    expect(descriptionWords_of('Sag_MPRAGE 220 FOV 256x256 1.0mm')).toEqual(['SAG', 'MPRAGE']);
    expect(descriptionWords_of('AX T2 FLAIR (FS)')).toEqual(['AX', 'T2', 'FLAIR', 'FS']);
  });

  it('measures overlap against the shorter description', () => {
    expect(wordOverlap_of(['SAG', 'MPRAGE'], ['SAG', 'MPRAGE', 'ISO'])).toBe(1);
    expect(wordOverlap_of(['AX', 'T2'], ['SAG', 'T1'])).toBe(0);
    expect(wordOverlap_of([], ['A'])).toBe(0);
  });

  it('groups descriptions alike under the commonest, and keeps different sequences apart', () => {
    const groups = descriptionGroups_of(['SAG MPRAGE', 'SAG MPRAGE', 'sag_mprage 220 FOV', 'AX T2 FLAIR', 'Sag MPRAGE ISO', '123']);
    expect(groups.get('sag_mprage 220 FOV')).toBe('SAG MPRAGE');
    expect(groups.get('Sag MPRAGE ISO')).toBe('SAG MPRAGE');
    expect(groups.get('AX T2 FLAIR')).toBe('AX T2 FLAIR');
    expect(groups.get('123')).toBe('123');
  });
});

describe('where a feed hangs', () => {
  const groups = new Map([['sag mprage', 'SAG MPRAGE']]);
  it('descends format, modality, description group for DICOM', () => {
    expect(dataPath_of(feed(1, { format: 'dicom', modality: 'MR', seriesDescription: 'sag mprage' }), groups).map((s) => s.key)).toEqual(['dicom', 'dicom/MR', 'dicom/MR/SAG MPRAGE']);
    expect(dataPath_of(feed(2, { format: 'dicom' }), groups).map((s) => s.label)).toEqual(['DICOM', 'NO MODALITY', 'NO DESCRIPTION']);
  });

  it('stops at the format for anything else, and says a feed is not yet read', () => {
    expect(dataPath_of(feed(3, { format: 'nifti' }), groups)).toEqual([{ key: 'nifti', label: 'NIfTI' }]);
    expect(dataPath_of(feed(4), groups)).toEqual([{ key: 'unread', label: 'NOT YET READ' }]);
    expect(dataPath_of(feed(5, { format: 'unknown', reason: 'x' }), groups)[0]?.label).toBe('UNREADABLE');
  });
});

describe('dataGraph_build', () => {
  const { graph, hubs } = dataGraph_build([
    feed(1, { format: 'dicom', modality: 'MR', seriesDescription: 'SAG MPRAGE' }),
    feed(2, { format: 'dicom', modality: 'MR', seriesDescription: 'sag_mprage 220' }),
    feed(3, { format: 'dicom', modality: 'CT', seriesDescription: 'HEAD' }),
    feed(4, { format: 'nifti' }),
    feed(5),
  ]);

  it('hangs each feed\'s root from its deepest hub, and chains the hubs', () => {
    expect(graph.nodes.find((n) => n.id === groupId_of(1, 0))?.parentIds).toEqual([dataHubId_of('dicom/MR/SAG MPRAGE')]);
    expect(graph.nodes.find((n) => n.id === groupId_of(2, 0))?.parentIds).toEqual([dataHubId_of('dicom/MR/SAG MPRAGE')]);
    expect(graph.nodes.find((n) => n.id === groupId_of(4, 0))?.parentIds).toEqual([dataHubId_of('nifti')]);
    expect(graph.nodes.find((n) => n.id === dataHubId_of('dicom/MR'))?.parentIds).toEqual([dataHubId_of('dicom')]);
    expect(graph.nodes.find((n) => n.id === dataHubId_of('dicom'))?.parentIds).toEqual([]);
  });

  it('draws hubs as massless nebulae sized by the feeds beneath them', () => {
    const dicom = graph.nodes.find((n) => n.id === dataHubId_of('dicom'));
    expect(dicom).toMatchObject({ ghost: true, halo: true, count: 3, label: 'DICOM', caption: 'DICOM · 3' });
    expect(hubs.get('dicom/MR')?.feeds).toBe(2);
    expect(hubs.get('unread')?.label).toBe('NOT YET READ');
  });

  it('labels formats and modalities always, and a description group only when it holds enough feeds', () => {
    expect(graph.nodes.find((n) => n.id === dataHubId_of('dicom/MR'))?.caption).toBe('MR · 2');
    expect(graph.nodes.find((n) => n.id === dataHubId_of('dicom/MR/SAG MPRAGE'))?.caption).toBeUndefined();
    const many = dataGraph_build(Array.from({ length: 6 }, (_v, i) => feed(i + 1, { format: 'dicom', modality: 'MR', seriesDescription: 'AX T2' })));
    expect(many.graph.nodes.find((n) => n.id === dataHubId_of('dicom/MR/AX T2'))?.caption).toBe('AX T2 · 6');
  });

  it('names a hub\'s place and its feeds on the tip', () => {
    expect(dataHubTip_of(dataHubId_of('dicom/MR/SAG MPRAGE'), hubs)).toBe('DICOM · MR · SAG MPRAGE · 2 feeds');
    expect(dataHubTip_of(dataHubId_of('nifti'), hubs)).toBe('NIfTI · 1 feed');
    expect(dataHubKey_of(groupId_of(1, 0))).toBeNull();
    expect(dataHubTip_of(groupId_of(1, 0), hubs)).toBeNull();
  });
});
