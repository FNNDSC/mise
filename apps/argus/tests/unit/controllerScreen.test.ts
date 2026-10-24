/**
 * @jest-environment jsdom
 */
/**
 * @file The TD controller's screen: a pill per domain and NEW, a pill that
 * sends its line, an event redrawing the condition and the title, the
 * engine's question answered on the strip by a pill or a typed name, the
 * lock and the refusals drawn, and COMMIT held until the name is a free DNS
 * label.
 */
import { describe, it, expect } from '@jest/globals';
import type { DomainSizeModel, DomainSpecModel, DomainSummary } from '@fnndsc/menu';
import { TdController, type ControllerHooks } from '../../src/features/controller/screen.js';

const SPEC: DomainSpecModel = {
  family: 'E5',
  controlPlane: { count: 3, vcpu: 8, ramGib: 24, bootGib: 200, bootTier: 'ultra' },
  workers: { count: 0, vcpu: 8, ramGib: 32, bootGib: 120, bootTier: 'balanced' },
  chris: { dataGib: 20, databaseGib: 5, queueGib: 1 },
};

const domain_make = (name: string, extra: Partial<DomainSummary> = {}): DomainSummary => ({
  name, path: `/net/oci/fnndsc-bch/domains/${name}`, cluster: `${name}.oci.example.org`, lastDone: null,
  steps: [{ folder: '01-infra-apply', state: 'not done', name: 'infra-apply', evidence: 'not run yet' }],
  resources: null, cost: null, condition: 'SIZING', billing: false, origin: 'built', protected: true,
  refused: { teardown: `protected (domain protect ${name} off lifts it)` }, region: 'us-ashburn-1', compartment: null, gone: null,
  spec: SPEC, next: 'infra-apply', billingStep: 'infra-apply', running: null, plan: null, verify: null, asking: null,
  ...extra,
});

const SIZE: DomainSizeModel = {
  region: 'us-ashburn-1', family: 'E5', families: ['E5'], vcpuPerCore: 2, cores: null, memoryGib: null,
  zones: [{ zone: 'AD-1', coresFree: 100, memoryFree: 1000 }], price: null, services: null, start: SPEC, baseDomain: 'oci.example.org',
};

/** A controller over hooks that record the lines sent. */
function controller_make(size: DomainSizeModel = SIZE): { controller: TdController; sent: string[]; cues: string[]; hooks: ControllerHooks } {
  const sent: string[] = [];
  const cues: string[] = [];
  const hooks: ControllerHooks = {
    run: async (line: string): Promise<void> => { sent.push(line); },
    size_read: async (): Promise<DomainSizeModel> => size,
    stop: (): void => { sent.push('<stop>'); },
    leave: (): void => { sent.push('<leave>'); },
    voice: { pill: (): void => undefined, cue: (name: string): void => { cues.push(name); } },
  };
  const controller: TdController = new TdController(hooks);
  document.body.append(controller.root);
  return { controller, sent, cues, hooks };
}

const button_named = (root: HTMLElement, text: string): HTMLButtonElement | undefined =>
  [...root.querySelectorAll('button')].find((button: HTMLButtonElement): boolean => (button.textContent ?? '').trim() === text);

const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('the TD controller screen', () => {
  it('draws a pill per domain and NEW, and a pill sends its line', async () => {
    const { controller, sent } = controller_make();
    controller.domains_take([domain_make('harbor', { origin: 'adopted', condition: 'UP', billing: true, refused: { build: 'adopted from ~/h', teardown: 'adopted, not built here' } }), domain_make('quay')]);
    controller.domain_choose('harbor');
    expect([...controller.root.querySelectorAll('.tdc-domain')].map((pill) => pill.textContent)).toEqual(['HARBOR', 'QUAY', '+ NEW']);
    expect(controller.root.querySelector('.tdc-chip-class')?.textContent).toBe('ADOPTED · PLANS ONLY');
    expect(controller.root.querySelector('.tdc-condition-why')?.textContent).toBe('BILLING · ADOPTED');
    expect(document.title).toBe('UP · harbor');
    // An adopted domain's BUILD is drawn and refused, never pressed.
    const build: HTMLButtonElement | undefined = button_named(controller.root, 'BUILD · REFUSED');
    expect(build?.disabled).toBe(true);
    button_named(controller.root, 'PLAN')?.click();
    await flush();
    expect(sent).toEqual(['domain plan harbor']);
    button_named(controller.root, 'QUAY')?.click();
    await flush();
    expect(sent.at(-1)).toBe('domain quay');
    expect(controller.domain_get()?.name).toBe('quay');
    controller.dispose();
    controller.root.remove();
  });

  it('redraws from an event, keeping the cost a read gave', () => {
    const { controller, cues } = controller_make();
    controller.domains_take([domain_make('quay', { cost: { hourly: 0.71, soFar: 2, currency: 'USD' } })]);
    controller.domain_choose('quay');
    controller.domain_take({ ...domain_make('quay', { condition: 'BUILDING', running: { job: 'quay-build', step: 'infra-apply', since: null } }), cost: undefined });
    expect(controller.root.querySelector('.tdc-condition-name')?.textContent).toBe('BUILDING');
    expect(controller.domain_get()?.cost?.hourly).toBe(0.71);
    controller.domain_take({ ...domain_make('quay', { condition: 'FAILED', steps: [{ folder: '01-infra-apply', state: 'failed', name: 'infra-apply' }] }), cost: undefined });
    expect(cues).toContain('redalert');
    controller.dispose();
    controller.root.remove();
  });

  it('answers the billing question by a pill and the teardown question by the name typed back', async () => {
    const { controller } = controller_make();
    controller.domains_take([domain_make('quay', { protected: false, refused: {} })]);
    controller.domain_choose('quay');
    const billing: Promise<string | null> = controller.ask_take('infra-apply creates 17 resources. Billing starts at $0.50 an hour. Continue? [y/N]', 'text');
    expect(controller.root.querySelector('.tdc-strip')?.getAttribute('data-tone')).toBe('bill');
    button_named(controller.root, 'YES · BILL')?.click();
    expect(await billing).toBe('y');
    expect((controller.root.querySelector('.tdc-strip') as HTMLElement).hidden).toBe(true);
    const named: Promise<string | null> = controller.ask_take("Destroy what quay built? Type the domain's name to go on:", 'text');
    const destroy: HTMLButtonElement | undefined = button_named(controller.root, 'DESTROY');
    const input: HTMLInputElement = controller.root.querySelector('.tdc-strip-input') as HTMLInputElement;
    expect(destroy?.disabled).toBe(true);
    input.value = 'qua';
    input.dispatchEvent(new Event('input'));
    expect(destroy?.disabled).toBe(true);
    input.value = 'quay';
    input.dispatchEvent(new Event('input'));
    expect(destroy?.disabled).toBe(false);
    destroy?.click();
    expect(await named).toBe('quay');
    controller.dispose();
    controller.root.remove();
  });

  it('shows the lock, and lifting it is a line of its own', async () => {
    const { controller, sent } = controller_make();
    controller.domains_take([domain_make('quay')]);
    controller.domain_choose('quay');
    controller.view_show('teardown');
    expect(controller.root.querySelector('.tdc-lock')?.textContent).toBe('PROTECTED');
    expect(button_named(controller.root, 'TEAR DOWN')).toBeUndefined();
    button_named(controller.root, 'LIFT THE LOCK')?.click();
    await flush();
    expect(sent).toEqual(['domain protect quay off']);
    controller.domains_take([domain_make('quay', { protected: false, refused: {} })]);
    button_named(controller.root, 'TEAR DOWN')?.click();
    await flush();
    expect(sent.at(-1)).toBe('domain teardown quay');
    controller.dispose();
    controller.root.remove();
  });

  it('holds COMMIT until the new name is a free DNS label, then writes the spec and plays the tenant', async () => {
    const { controller, sent, hooks } = controller_make();
    controller.domains_take([domain_make('harbor')]);
    // The session's read after `domain new`: the spec written, quay is kept.
    const run = hooks.run;
    hooks.run = async (line: string): Promise<void> => {
      await run(line);
      if (line.startsWith('domain new ')) controller.domains_take([domain_make('harbor'), domain_make('quay')]);
    };
    button_named(controller.root, '+ NEW')?.click();
    await flush();
    expect(controller.view_get()).toBe('size');
    const commit = (): HTMLButtonElement | undefined => [...controller.root.querySelectorAll('.tdc-commit button')].find((b) => (b.textContent ?? '').startsWith('COMMIT')) as HTMLButtonElement | undefined;
    expect(commit()?.textContent).toBe('COMMIT · NAME IT FIRST');
    const name: HTMLInputElement = controller.root.querySelector('#tdc-new-name') as HTMLInputElement;
    name.value = 'harbor';
    name.dispatchEvent(new Event('input'));
    expect(commit()?.textContent).toBe('COMMIT · HARBOR IS TAKEN');
    name.value = 'quay';
    name.dispatchEvent(new Event('input'));
    expect(commit()?.disabled).toBe(false);
    expect([...controller.root.querySelectorAll('.tdc-commit-line')].map((line) => line.textContent)).toEqual(['domain new quay', 'play ~/tenant.mise --param NAME=quay']);
    commit()?.click();
    await flush();
    await flush();
    expect(sent).toEqual(['domain new quay', 'play ~/tenant.mise --param NAME=quay']);
    expect(controller.domain_get()?.name).toBe('quay');
    expect(controller.view_get()).toBe('build');
    controller.dispose();
    controller.root.remove();
  });

  it('holds COMMIT until a zone is chosen when the tenancy holds several, and names the one chosen', async () => {
    const { controller, sent } = controller_make({ ...SIZE, baseDomain: null, dnsZones: ['lab.example.org', 'oci.example.org'] });
    controller.domains_take([domain_make('harbor')]);
    button_named(controller.root, '+ NEW')?.click();
    await flush();
    const name: HTMLInputElement = controller.root.querySelector('#tdc-new-name') as HTMLInputElement;
    name.value = 'quay';
    name.dispatchEvent(new Event('input'));
    const commit = (): HTMLButtonElement | undefined => [...controller.root.querySelectorAll('.tdc-commit button')].find((b) => (b.textContent ?? '').startsWith('COMMIT')) as HTMLButtonElement | undefined;
    expect(commit()?.textContent).toBe('COMMIT · NO ZONE');
    expect(commit()?.disabled).toBe(true);
    button_named(controller.root, 'oci.example.org')?.click();
    expect(controller.root.querySelector('.tdc-commit-line')?.textContent).toBe('domain new quay --base-domain oci.example.org');
    expect(commit()?.disabled).toBe(false);
    commit()?.click();
    await flush();
    expect(sent[0]).toBe('domain new quay --base-domain oci.example.org');
    controller.dispose();
    controller.root.remove();
  });
});
