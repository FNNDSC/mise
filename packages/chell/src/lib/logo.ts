import chalk from 'chalk';

/**
 * Renders the ChRIS/CheLL logo in a neofetch-style block.
 * Returns pre-colored lines when color is enabled; otherwise plain text.
 */
export function logo_linesRender(colorize: boolean): string[] {
  const baseLines: string[] = [
    '▐██████████▀▀▀▀▀▀████████████████',
    '▐████████▀▘      ▝▀▀▀████████████',
    '▐█████▀▀▘            ▝▀▀█████████',
    '▐████▘    ┌──█──────┐   ▝████████',
    '▐███▘    ┌┤         █──┐ ▝▀██████',
    '▐██▘    ┌┘├─█       │  └─┐ ▝█████',
    '▐█▌  ┌──█─┤   ┌─█───┴──┐ │  ▝████',
    '▐▌   │  │ └─┬─┘        ├─█   ▝███',
    '▐▌   █  │   │  ┌───█───┘ │    ███',
    '▐█   └┐ └───█──┤         │   ▝███',
    '▐█▌   └────┬┘  │         │    ▐██',
    '▐██▖       │   └──█───┐ ┌┘    ▐██',
    '▐███▄▄▖    █─────┐    │ │    ▗███',
    '▐██████▖         └─┐  █─┤    ▐███',
    '▐███████▄▄▄▄▄▖     └┐   ├─█  ▐███',
    '▐█████████████▄▄▄▄▖ └──┬┘   ▗████',
    '▐██████████████████▖   █    ▐████',
    '▐███████████████████▄▖   ▗  ▐████',
    '▐█████████████████████▄▄▄█▄▄█████'
  ];

  if (!colorize) {
    return baseLines;
  }

  const connectorChars: Set<string> = new Set(['┌', '┐', '└', '┘', '┬', '┴', '┤', '├', '┼', '─', '│']);
  const rows: number = baseLines.length;
  const cols: number = baseLines.reduce((max: number, line: string) => Math.max(max, line.length), 0);

  const charAt = (r: number, c: number): string | null => {
    if (r < 0 || r >= rows) return null;
    const line: string = baseLines[r];
    if (c < 0 || c >= line.length) return null;
    return line[c];
  };

  return baseLines.map((line: string, r: number) => {
    let rendered = '';
    for (let c = 0; c < line.length; c++) {
      const ch: string = line[c];
      const neighbors: Array<string | null> = [
        charAt(r - 1, c),
        charAt(r + 1, c),
        charAt(r, c - 1),
        charAt(r, c + 1)
      ];
      const isNode: boolean = ch === '█' && neighbors.some((n) => n !== null && connectorChars.has(n!));

      if (connectorChars.has(ch)) {
        rendered += chalk.blue(ch); // edges
      } else if (isNode) {
        rendered += chalk.blueBright(ch); // bright nodes
      } else if (ch === '█') {
        rendered += chalk.whiteBright(ch); // mass
      } else if (ch === '▐' || ch === '▌' || ch === '▖' || ch === '▗' || ch === '▀' || ch === '▄') {
        rendered += chalk.gray(ch); // edge shading
      } else if (ch === '▝' || ch === '▘') {
        rendered += chalk.gray(ch); // small edge caps
      } else {
        rendered += ch;
      }
    }
    return rendered;
  });
}
