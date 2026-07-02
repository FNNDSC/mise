// Break the chrisResourceGroup -> chrisConnection -> chrisContext -> chrisPlugins
// import cycle (chrisPlugins extends ChRISResourceGroup). A factory mock avoids
// loading the real module; the lazy client_get is never invoked by these tests.
jest.mock('../src/connect/chrisConnection', () => ({
  chrisConnection: { client_get: jest.fn().mockReturnValue(null) },
}));

import { ChRISResourceGroup } from '../src/resources/chrisResourceGroup';
import { ChRISTagGroup } from '../src/tags/chrisTags';
import { ChRISGroupGroup } from '../src/groups/chrisGroups';
import { ChRISWorkflowGroup } from '../src/workflows/chrisWorkflows';
import { ChRISPluginMetaGroup } from '../src/pluginmetas/chrisPluginMetas';
import { ChRISPluginMetaPluginGroup } from '../src/plugins/chrisPluginMetaPlugins';

/**
 * The concrete ChRISResourceGroup subclasses are thin: each binds a resource
 * name to a client getter, lazily (no network at construction). These tests
 * pin that wiring so a rename or wrong getMethod is caught.
 */
describe('ChRISResourceGroup subclasses', () => {
  it.each([
    [ChRISTagGroup, 'Tags'],
    [ChRISGroupGroup, 'Groups'],
    [ChRISWorkflowGroup, 'Workflows'],
    [ChRISPluginMetaGroup, 'PluginMetas'],
    [ChRISPluginMetaPluginGroup, 'PluginMetaPlugins'],
  ])('%p binds resource name "%s"', (Ctor, resourceName) => {
    const group = new (Ctor as new () => ChRISResourceGroup)();
    expect(group).toBeInstanceOf(ChRISResourceGroup);
    expect(group.asset.resourceName).toBe(resourceName);
  });
});
