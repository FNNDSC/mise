/**
 * @file ANSI SGR to HTML conversion for the DOM terminal.
 *
 * The engine's rendered stream is ANSI-colored text (chalk emits 16-color,
 * 256-color, and truecolor SGR sequences). The ARGUS console renders that
 * stream as HTML, in the prototype's styled-transcript tradition, so this
 * module converts SGR runs into `<span style>` runs. Non-SGR escape
 * sequences (cursor movement, erasures) are dropped: the transcript is a
 * document, not a screen buffer, so positioning has no meaning here. All
 * text content is entity-escaped before markup is added.
 *
 * @module
 */

/** The 16 base ANSI colors, warmed slightly toward the LCARS palette. */
const BASE_COLORS: string[] = [
  '#000000', '#f24444', '#33cc66', '#ffaa44',
  '#5599ff', '#cc88ff', '#44cccc', '#ffeecc',
  '#777777', '#ff6666', '#66ee99', '#ffcc66',
  '#77bbff', '#dd99ff', '#66dddd', '#ffffff',
];

/** The active display attributes of one SGR run. */
interface SgrState {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
}

/** A fresh, attribute-free state. */
function state_initial(): SgrState {
  return { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false };
}

/**
 * Resolves one xterm 256-palette index to its hex color.
 *
 * @param index - The palette index (0-255).
 * @returns The `#rrggbb` color.
 */
function color256_resolve(index: number): string {
  if (index < 16) {
    return BASE_COLORS[index] ?? '#ffeecc';
  }
  if (index < 232) {
    const cube: number = index - 16;
    const steps: number[] = [0, 95, 135, 175, 215, 255];
    const r: number = steps[Math.floor(cube / 36) % 6] ?? 0;
    const g: number = steps[Math.floor(cube / 6) % 6] ?? 0;
    const b: number = steps[cube % 6] ?? 0;
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }
  const gray: number = 8 + (index - 232) * 10;
  return `#${((gray << 16) | (gray << 8) | gray).toString(16).padStart(6, '0')}`;
}

/**
 * Applies one SGR parameter sequence to a display state.
 *
 * @param state - The state to mutate.
 * @param params - The numeric SGR parameters.
 */
function sgr_apply(state: SgrState, params: number[]): void {
  for (let index: number = 0; index < params.length; index++) {
    const code: number = params[index] ?? 0;
    if (code === 0) {
      Object.assign(state, state_initial());
    } else if (code === 1) {
      state.bold = true;
    } else if (code === 2) {
      state.dim = true;
    } else if (code === 3) {
      state.italic = true;
    } else if (code === 4) {
      state.underline = true;
    } else if (code === 22) {
      state.bold = false;
      state.dim = false;
    } else if (code === 23) {
      state.italic = false;
    } else if (code === 24) {
      state.underline = false;
    } else if (code >= 30 && code <= 37) {
      state.fg = BASE_COLORS[code - 30] ?? null;
    } else if (code >= 90 && code <= 97) {
      state.fg = BASE_COLORS[code - 90 + 8] ?? null;
    } else if (code === 39) {
      state.fg = null;
    } else if (code >= 40 && code <= 47) {
      state.bg = BASE_COLORS[code - 40] ?? null;
    } else if (code >= 100 && code <= 107) {
      state.bg = BASE_COLORS[code - 100 + 8] ?? null;
    } else if (code === 49) {
      state.bg = null;
    } else if (code === 38 || code === 48) {
      const mode: number = params[index + 1] ?? 0;
      let color: string | null = null;
      if (mode === 5) {
        color = color256_resolve(params[index + 2] ?? 0);
        index += 2;
      } else if (mode === 2) {
        const r: number = params[index + 2] ?? 0;
        const g: number = params[index + 3] ?? 0;
        const b: number = params[index + 4] ?? 0;
        color = `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
        index += 4;
      }
      if (code === 38) {
        state.fg = color;
      } else {
        state.bg = color;
      }
    }
  }
}

/**
 * Renders one state as a CSS style attribute value.
 *
 * @param state - The display state.
 * @returns The style string; empty when the state carries no attributes.
 */
function state_toStyle(state: SgrState): string {
  const rules: string[] = [];
  if (state.fg !== null) {
    rules.push(`color:${state.fg}`);
  }
  if (state.bg !== null) {
    rules.push(`background-color:${state.bg}`);
  }
  if (state.bold) {
    rules.push('font-weight:bold');
  }
  if (state.dim) {
    rules.push('opacity:0.55');
  }
  if (state.italic) {
    rules.push('font-style:italic');
  }
  if (state.underline) {
    rules.push('text-decoration:underline');
  }
  return rules.join(';');
}

/**
 * Escapes text for safe HTML interpolation.
 *
 * @param text - The raw text.
 * @returns The entity-escaped text.
 */
export function html_escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Matches one ANSI escape sequence (CSI, OSC, or lone ESC forms). */
const ANSI_PATTERN: RegExp =
  // eslint-disable-next-line no-control-regex
  /\x1b(?:\[([0-9;:]*)([A-Za-z])|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;

/**
 * Converts ANSI-decorated text to HTML span runs.
 *
 * SGR sequences (`...m`) become styled spans; every other escape sequence
 * is dropped. Carriage returns are removed (the transcript flows as a
 * document) and newlines are preserved for `white-space: pre-wrap` layout.
 *
 * @param text - The ANSI-decorated text.
 * @returns HTML markup safe to insert into the transcript.
 */
export function ansi_toHtml(text: string): string {
  const state: SgrState = state_initial();
  let html: string = '';
  let lastIndex: number = 0;

  const emit = (chunk: string): void => {
    if (chunk.length === 0) {
      return;
    }
    const style: string = state_toStyle(state);
    const escaped: string = html_escape(chunk.replace(/\r/g, ''));
    html += style.length > 0 ? `<span style="${style}">${escaped}</span>` : escaped;
  };

  ANSI_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null = ANSI_PATTERN.exec(text);
  while (match !== null) {
    emit(text.slice(lastIndex, match.index));
    lastIndex = match.index + match[0].length;
    if (match[2] === 'm') {
      const params: number[] = (match[1] ?? '')
        .split(/[;:]/)
        .map((part: string): number => (part.length > 0 ? Number(part) : 0));
      sgr_apply(state, params);
    }
    match = ANSI_PATTERN.exec(text);
  }
  emit(text.slice(lastIndex));
  return html;
}
