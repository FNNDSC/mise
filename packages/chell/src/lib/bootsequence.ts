import chalk from 'chalk';

export interface BootInfoItem {
  label: string;
  value: string;
}

function visibleLength(text: string): number {
  return text.replace(/\x1b\[[0-9;]*m/g, '').length;
}

export interface BootPanels {
  header: BootInfoItem[];
  local: BootInfoItem[];
  chris: BootInfoItem[];
}

export type BootStatus = 'ok' | 'skip' | 'fail';

export function bootLogger_create(title: string, useAscii: boolean) {
  const horiz: string = useAscii ? '-' : '─';
  const cornerTL: string = useAscii ? '+' : '┌';
  const cornerTR: string = useAscii ? '+' : '┐';
  const cornerBL: string = useAscii ? '+' : '└';
  const cornerBR: string = useAscii ? '+' : '┘';
  const bar: string = horiz.repeat(Math.max(title.length + 8, 30));

  const lineTop: string = `${cornerTL}${bar}${cornerTR}`;
  const lineBot: string = `${cornerBL}${bar}${cornerBR}`;
  const statusPad = (label: string): string => label.padEnd(12);

  const statusTag = (status: BootStatus): string => {
    switch (status) {
      case 'ok': return chalk.green('[ OK ]');
      case 'skip': return chalk.yellow('[SKIP]');
      case 'fail': return chalk.red('[FAIL]');
    }
  };

  return {
    header_print(): void { console.log(lineTop); },
    footer_print(): void { console.log(lineBot); },
    log(status: BootStatus, label: string, message: string): void {
      console.log(`${statusTag(status)} ${statusPad(label)} ${message}`);
    }
  };
}

function box_render(title: string, rows: BootInfoItem[], useColor: boolean, useAscii: boolean): string[] {
  if (rows.length === 0) return [];
  const horiz: string = useAscii ? '-' : '─';
  const vert: string = useAscii ? '|' : '│';
  const cornerTL: string = useAscii ? '+' : '┌';
  const cornerTR: string = useAscii ? '+' : '┐';
  const cornerBL: string = useAscii ? '+' : '└';
  const cornerBR: string = useAscii ? '+' : '┘';

  const maxLabel: number = rows.reduce((max: number, item: BootInfoItem) => Math.max(max, item.label.length), title.length);
  const maxValue: number = rows.reduce((max: number, item: BootInfoItem) => Math.max(max, visibleLength(item.value)), 0);
  const innerWidth: number = Math.max(maxLabel + maxValue + 3, title.length + 2);
  const line: string = horiz.repeat(innerWidth);

  const titlePadded: string = title.padEnd(innerWidth);
  const lines: string[] = [];
  lines.push(`${cornerTL}${line}${cornerTR}`);
  lines.push(`${vert}${useColor ? chalk.cyan(titlePadded) : titlePadded}${vert}`);
  rows.forEach((item: BootInfoItem) => {
    const label: string = useColor ? chalk.yellow(item.label.padEnd(maxLabel)) : item.label.padEnd(maxLabel);
    const value: string = useColor ? chalk.white(item.value) : item.value;
    const paddedLine: string = `${label} ${value}`.padEnd(innerWidth);
    lines.push(`${vert}${paddedLine}${vert}`);
  });
  lines.push(`${cornerBL}${line}${cornerBR}`);
  return lines;
}

function box_minWidth(title: string, rows: BootInfoItem[]): number {
  const maxLabel: number = rows.reduce((max: number, item: BootInfoItem) => Math.max(max, item.label.length), title.length);
  const maxValue: number = rows.reduce((max: number, item: BootInfoItem) => Math.max(max, visibleLength(item.value)), 0);
  return Math.max(maxLabel + maxValue + 3, title.length + 2);
}

function box_render_withMin(title: string, rows: BootInfoItem[], useColor: boolean, useAscii: boolean, minInner: number): string[] {
  if (rows.length === 0) return [];
  const horiz: string = useAscii ? '-' : '─';
  const vert: string = useAscii ? '|' : '│';
  const cornerTL: string = useAscii ? '+' : '┌';
  const cornerTR: string = useAscii ? '+' : '┐';
  const cornerBL: string = useAscii ? '+' : '└';
  const cornerBR: string = useAscii ? '+' : '┘';

  const maxLabel: number = rows.reduce((max: number, item: BootInfoItem) => Math.max(max, item.label.length), title.length);
  const maxValue: number = rows.reduce((max: number, item: BootInfoItem) => Math.max(max, visibleLength(item.value)), 0);
  const innerWidth: number = Math.max(maxLabel + maxValue + 3, title.length + 2, minInner);
  const line: string = horiz.repeat(innerWidth);

  const titlePadded: string = title.padEnd(innerWidth);
  const lines: string[] = [];
  lines.push(`${cornerTL}${line}${cornerTR}`);
  lines.push(`${vert}${useColor ? chalk.cyan(titlePadded) : titlePadded}${vert}`);
  rows.forEach((item: BootInfoItem) => {
    const label: string = useColor ? chalk.yellow(item.label.padEnd(maxLabel)) : item.label.padEnd(maxLabel);
    const value: string = useColor ? chalk.white(item.value) : item.value;
    const paddedLine: string = `${label} ${value}`.padEnd(innerWidth);
    lines.push(`${vert}${paddedLine}${vert}`);
  });
  lines.push(`${cornerBL}${line}${cornerBR}`);
  return lines;
}

export function bootsequence_printIntroPanels(
  logoLines: string[],
  panels: BootPanels,
  useColor: boolean,
  useAscii: boolean
): void {
  const leftPad: string = '  ';
  const minInner: number = Math.max(
    box_minWidth('ChELL', panels.header),
    box_minWidth('Local', panels.local),
    box_minWidth('ChRIS', panels.chris)
  );

  const headerBox: string[] = box_render_withMin('ChELL', panels.header, useColor, useAscii, minInner);
  const localBox: string[] = box_render_withMin('Local', panels.local, useColor, useAscii, minInner);
  const chrisBox: string[] = box_render_withMin('ChRIS', panels.chris, useColor, useAscii, minInner);

  const rightLinesRaw: string[] = [...headerBox, '', ...localBox, '', ...chrisBox];
  const rightWidth: number = rightLinesRaw.reduce((max: number, line: string) => Math.max(max, visibleLength(line)), 0);
  const rightLines: string[] = rightLinesRaw.map((line: string) => {
    const currentLen: number = visibleLength(line);
    if (currentLen >= rightWidth) return line;
    if (line.startsWith('┌') || line.startsWith('└') || line.startsWith('+') || line.startsWith('│') || line.startsWith('|')) {
      const padCount: number = rightWidth - currentLen;
      const lastChar: string = line.slice(-1);
      const body: string = line.slice(0, -1);
      return `${body}${' '.repeat(padCount)}${lastChar}`;
    }
    return line.padEnd(line.length + (rightWidth - currentLen), ' ');
  });

  const logoWidth: number = logoLines.reduce((max: number, line: string) => Math.max(max, visibleLength(line)), 0);
  const paddingBetween: number = 3;
  const logoBlock: string[] = ['', ...logoLines, ''].map((l: string) => l.padEnd(logoWidth, ' '));
  const totalWidth: number = logoWidth + paddingBetween + rightWidth;
  const lineChar: string = useAscii ? '-' : '─';
  const titleText: string = useColor ? chalk.bold.cyan('ChELL neofetch') : 'ChELL neofetch';
  const titleLine: string = `${leftPad}${titleText} ${lineChar.repeat(Math.max(0, totalWidth - visibleLength(titleText) - 1))}`;
  const rows: number = Math.max(logoBlock.length, rightLines.length);

  console.log(titleLine);
  for (let i = 0; i < rows; i++) {
    const logoSegment: string = logoBlock[i] ?? ''.padEnd(logoWidth, ' ');
    const rightSegment: string = rightLines[i] ?? '';
    const line: string = `${logoSegment}${' '.repeat(paddingBetween)}${rightSegment}`.trimEnd();
    console.log(`${leftPad}${line}`);
  }
}

export function bootsequence_printIntroPanelsStacked(
  logoLines: string[],
  panels: BootPanels,
  useColor: boolean,
  useAscii: boolean
): void {
  const leftPad: string = '  ';
  const minInner: number = Math.max(
    box_minWidth('ChELL', panels.header),
    box_minWidth('Local', panels.local),
    box_minWidth('ChRIS', panels.chris)
  );

  const headerBox: string[] = box_render_withMin('ChELL', panels.header, useColor, useAscii, minInner);
  const localBox: string[] = box_render_withMin('Local', panels.local, useColor, useAscii, minInner);
  const chrisBox: string[] = box_render_withMin('ChRIS', panels.chris, useColor, useAscii, minInner);

  const stackLines: string[] = [...headerBox, '', ...localBox, '', ...chrisBox];
  const boxesWidth: number = stackLines.reduce((max: number, line: string) => Math.max(max, visibleLength(line)), 0);
  const logoWidth: number = logoLines.reduce((max: number, line: string) => Math.max(max, visibleLength(line)), 0);
  const contentWidth: number = Math.max(boxesWidth, logoWidth);

  const lineChar: string = useAscii ? '-' : '─';
  const titleText: string = useColor ? chalk.bold.cyan('ChELL neofetch') : 'ChELL neofetch';
  const titleLine: string = `${leftPad}${titleText} ${lineChar.repeat(Math.max(0, contentWidth - visibleLength(titleText) - 1))}`;

  const padVisible = (line: string): string => {
    const diff: number = contentWidth - visibleLength(line);
    return diff > 0 ? `${line}${' '.repeat(diff)}` : line;
  };

  console.log(titleLine);
  stackLines.forEach((line: string) => {
    console.log(line === '' ? '' : `${leftPad}${padVisible(line)}`);
  });
  if (logoLines.length > 0) {
    console.log('');
    logoLines.forEach((line: string) => {
      console.log(`${leftPad}${padVisible(line)}`);
    });
  }
}
