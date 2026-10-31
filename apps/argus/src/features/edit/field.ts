/**
 * @file The editor pane's field: CodeMirror 6, as a guest.
 *
 * The field is the library's — typing, selection, undo, search, the syntax
 * colours — and nothing else of the pane is (aegis.adoc:
 * an-instruments-field-is-foreign). This module is the one place the
 * library is named: the panel asks it for a field over a container and
 * gets back the five things it needs, so the library can be swapped
 * without the pane noticing. It is loaded on demand, as the image engines
 * are, so a page that never edits never fetches it.
 *
 * @module
 */
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { HIGHLIGHT, language_resolve } from './syntax.js';

/** What the panel holds of a field. */
export interface EditField {
  /** The field's text now. */
  text_get: () => string;
  /** Replaces the whole text (REVERT, a fresh open), keeping undo honest. */
  text_set: (text: string) => void;
  /** Gives the field the keyboard. */
  focus: () => void;
  /** Whether the field holds the keyboard. */
  hasFocus: () => boolean;
  /** Takes the keyboard back from the field. */
  blur: () => void;
  /** Releases the library's view. */
  destroy: () => void;
}

/** The field's chrome-free look: the pane's black, the house's mono face. */
const LOOK: Extension = EditorView.theme({
  '&': { height: '100%', color: 'var(--butter)', backgroundColor: 'transparent', fontSize: '0.95rem' },
  '.cm-scroller': { fontFamily: "'Share Tech Mono', monospace", lineHeight: '1.45' },
  '.cm-content': { caretColor: 'var(--harvestgold)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--harvestgold)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--orange) 35%, transparent)' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--pumpkin-pie)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--orange) 8%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--harvestgold)' },
  '.cm-matchingBracket': { outline: '1px solid var(--harvestgold)', backgroundColor: 'transparent' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--daybreak) 30%, transparent)' },
  '.cm-panels': { backgroundColor: '#000', color: 'var(--butter)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '2px solid var(--orange)' },
}, { dark: true });

/**
 * Builds a field over a container.
 *
 * @param container - The pane's field section; the library owns its inside.
 * @param text - The text to open with.
 * @param extension - The file's extension, for its syntax colours.
 * @param changed - Called on every edit, with the text now.
 * @returns The field.
 */
export async function editField_create(
  container: HTMLElement,
  text: string,
  extension: string,
  changed: (text: string) => void,
): Promise<EditField> {
  const language: Extension = await language_resolve(extension);
  const view: EditorView = new EditorView({
    parent: container,
    state: EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: false }),
        syntaxHighlighting(HIGHLIGHT),
        language,
        LOOK,
        EditorView.lineWrapping,
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        EditorView.updateListener.of((update): void => {
          if (update.docChanged) changed(update.state.doc.toString());
        }),
      ],
    }),
  });
  return {
    text_get: (): string => view.state.doc.toString(),
    text_set: (next: string): void => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
    },
    focus: (): void => view.focus(),
    // The library's own hasFocus also asks whether the window has focus; a
    // background tab or a headless run holds the keyboard in the field all
    // the same, and Esc must still give it back.
    hasFocus: (): boolean => view.contentDOM.contains(document.activeElement),
    blur: (): void => view.contentDOM.blur(),
    destroy: (): void => view.destroy(),
  };
}
