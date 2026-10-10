/**
 * @file The frame's DOM helpers: an element by id, a pane stamped from its
 * template, a pane's own part.
 *
 * @module
 */

/**
 * Fetches a required element by id.
 *
 * @param id - The element id.
 * @returns The element.
 * @throws {Error} When the element does not exist.
 */
export function element_require(id: string): HTMLElement {
  const element: HTMLElement | null = document.getElementById(id);
  if (element === null) {
    throw new Error(`required element #${id} is missing`);
  }
  return element;
}

/**
 * Stamps one pane element from a template.
 *
 * @param templateId - The template's id.
 * @returns The cloned pane element, not yet in the document.
 * @throws {Error} When the template is missing or empty.
 */
export function template_stamp(templateId: string): HTMLElement {
  const template: HTMLElement = element_require(templateId);
  if (!(template instanceof HTMLTemplateElement)) {
    throw new Error(`#${templateId} is not a template`);
  }
  const first: Element | null = template.content.firstElementChild;
  if (!(first instanceof HTMLElement)) {
    throw new Error(`template #${templateId} is empty`);
  }
  return first.cloneNode(true) as HTMLElement;
}

/**
 * Finds a required descendant of a stamped pane.
 *
 * @param mount - The pane element.
 * @param selector - The descendant's selector.
 * @returns The element.
 * @throws {Error} When absent.
 */
export function pane_find(mount: HTMLElement, selector: string): HTMLElement {
  const found: HTMLElement | null = mount.querySelector<HTMLElement>(selector);
  if (found === null) {
    throw new Error(`pane template is missing ${selector}`);
  }
  return found;
}
