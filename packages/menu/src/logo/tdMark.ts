/**
 * @file The Trusted Domain mark, as ASCII: a blue North Star in an Oracle-red
 * ring, the stratus composition's splash (docs/stratus.adoc, D11; the brand
 * is the TD mark in the driver's ring). Pre-rendered like the brain next door
 * so a browser and a terminal draw the same lines; the colour variant carries
 * 24-bit ANSI codes and the plain variant none. The red ring is Oracle's mark
 * in all but name; public use needs Oracle's agreement.
 *
 * @module
 */

/** The mark without colour, 61 columns wide. */
const PLAIN_LINES: ReadonlyArray<string> = [
  '                                                         .   ',
  '                               .                        \';   ',
  '                               do                     .\'ll,..',
  '                               0O                     ;lll.. ',
  '                   ...........\'K0\'...........      .;:. .,   ',
  '             .,codxxxxxxxxxxxxoXXdxxxxxxxxxxxxdoc:o:         ',
  '          ,ldxxxxxxxdooooooooooNNoooooooooodxxxkkxxdl,       ',
  '       .cdxxxxdc,..          .lK0;          ,l;,cdxxxxdc.    ',
  '      :xxxxxc.               \'lX0;.      .;:.     .cxxxxx:   ',
  '    .oxxxxl.            ....ckONXxxc...\':,          .lxxxxo. ',
  '    oxxxx:              :okKxldXKcdOX0d;              :xxxxo ',
  '   ,xxxxl              .KXxlc:cXKloocdX0\'              lxxxx,',
  '   cxxxx,     .;:ccldOxxM0dxx0WMMW0kkOKMOOKkxol:;.     ,xxxxc',
  '   cxxxx,      .\';:coxxkM0xddkNMMNkddoOMdodl:;,\'.      ,xxxxc',
  '   ,xxxxo              .kXxloocKXl:cd0NO.              oxxxx,',
  '    lxxxxl              ;lOXKkdXNkx0Kxol              lxxxxl ',
  '     lxxxxo.          ....  ,odXNkx,  ..            .oxxxxl  ',
  '      ,dxxxxo,.    ...       .:KXd,              .,oxxxxd,   ',
  '        ;dxxxxxo:;:.         .cKXd.         ..,:oxxxxxd;     ',
  '          .:oxxxxxxxxxxxxxxxxxxWWxxxxxxxxxxxxxxxxxxo:.       ',
  '            .\'\';cldxxxxxxxxxxxxXXxxxxxxxxxxxxdlc;..          ',
  '         ...                  .KX.                           ',
  '     .::,                      00                            ',
  '      ;,                       ol                            ',
  '                               ..                            ',
];

/** The mark in colour: the ring red, the star blue. */
const COLOR_LINES: ReadonlyArray<string> = [
  '                                                         \x1b[38;2;199;70;52m.\x1b[0m   ',
  '                               \x1b[38;2;199;70;52m.\x1b[0m                        \x1b[38;2;199;70;52m\';\x1b[0m   ',
  '                               \x1b[38;2;199;70;52mdo\x1b[0m                     \x1b[38;2;199;70;52m.\'ll,..\x1b[0m',
  '                               \x1b[38;2;122;211;241m0\x1b[0m\x1b[38;2;199;70;52mO\x1b[0m                     \x1b[38;2;199;70;52m;lll..\x1b[0m ',
  '                   \x1b[38;2;199;70;52m...........\'\x1b[0m\x1b[38;2;122;211;241mK0\x1b[0m\x1b[38;2;199;70;52m\'...........\x1b[0m      \x1b[38;2;199;70;52m.;:.\x1b[0m \x1b[38;2;199;70;52m.,\x1b[0m   ',
  '             \x1b[38;2;199;70;52m.,codxxxxxxxxxxxxo\x1b[0m\x1b[38;2;122;211;241mXX\x1b[0m\x1b[38;2;199;70;52mdxxxxxxxxxxxxdoc:o:\x1b[0m         ',
  '          \x1b[38;2;199;70;52m,ldxxxxxxxdoooooooooo\x1b[0m\x1b[38;2;122;211;241mNN\x1b[0m\x1b[38;2;199;70;52moooooooooodxxxkkxxdl,\x1b[0m       ',
  '       \x1b[38;2;199;70;52m.cdxxxxdc,..\x1b[0m          \x1b[38;2;199;70;52m.l\x1b[0m\x1b[38;2;122;211;241mK0\x1b[0m\x1b[38;2;199;70;52m;\x1b[0m          \x1b[38;2;199;70;52m,l;,cdxxxxdc.\x1b[0m    ',
  '      \x1b[38;2;199;70;52m:xxxxxc.\x1b[0m               \x1b[38;2;199;70;52m\'l\x1b[0m\x1b[38;2;122;211;241mX0\x1b[0m\x1b[38;2;199;70;52m;.\x1b[0m      \x1b[38;2;199;70;52m.;:.\x1b[0m     \x1b[38;2;199;70;52m.cxxxxx:\x1b[0m   ',
  '    \x1b[38;2;199;70;52m.oxxxxl.\x1b[0m            \x1b[38;2;199;70;52m....ckO\x1b[0m\x1b[38;2;122;211;241mNX\x1b[0m\x1b[38;2;199;70;52mxxc...\':,\x1b[0m          \x1b[38;2;199;70;52m.lxxxxo.\x1b[0m ',
  '    \x1b[38;2;199;70;52moxxxx:\x1b[0m              \x1b[38;2;199;70;52m:ok\x1b[0m\x1b[38;2;122;211;241mK\x1b[0m\x1b[38;2;199;70;52mxld\x1b[0m\x1b[38;2;122;211;241mXK\x1b[0m\x1b[38;2;199;70;52mcdO\x1b[0m\x1b[38;2;122;211;241mX0\x1b[0m\x1b[38;2;199;70;52md;\x1b[0m              \x1b[38;2;199;70;52m:xxxxo\x1b[0m ',
  '   \x1b[38;2;199;70;52m,xxxxl\x1b[0m              \x1b[38;2;199;70;52m.\x1b[0m\x1b[38;2;122;211;241mKX\x1b[0m\x1b[38;2;199;70;52mxlc:c\x1b[0m\x1b[38;2;122;211;241mXK\x1b[0m\x1b[38;2;199;70;52mloocd\x1b[0m\x1b[38;2;122;211;241mX0\x1b[0m\x1b[38;2;199;70;52m\'\x1b[0m              \x1b[38;2;199;70;52mlxxxx,\x1b[0m',
  '   \x1b[38;2;199;70;52mcxxxx,\x1b[0m     \x1b[38;2;199;70;52m.;:ccldOxx\x1b[0m\x1b[38;2;122;211;241mM0\x1b[0m\x1b[38;2;199;70;52mdxx\x1b[0m\x1b[38;2;122;211;241m0WMMW0\x1b[0m\x1b[38;2;199;70;52mkkO\x1b[0m\x1b[38;2;122;211;241mKM\x1b[0m\x1b[38;2;199;70;52mOO\x1b[0m\x1b[38;2;122;211;241mK\x1b[0m\x1b[38;2;199;70;52mkxol:;.\x1b[0m     \x1b[38;2;199;70;52m,xxxxc\x1b[0m',
  '   \x1b[38;2;199;70;52mcxxxx,\x1b[0m      \x1b[38;2;199;70;52m.\';:coxxk\x1b[0m\x1b[38;2;122;211;241mM0\x1b[0m\x1b[38;2;199;70;52mxddk\x1b[0m\x1b[38;2;122;211;241mNMMN\x1b[0m\x1b[38;2;199;70;52mkddoO\x1b[0m\x1b[38;2;122;211;241mM\x1b[0m\x1b[38;2;199;70;52mdodl:;,\'.\x1b[0m      \x1b[38;2;199;70;52m,xxxxc\x1b[0m',
  '   \x1b[38;2;199;70;52m,xxxxo\x1b[0m              \x1b[38;2;199;70;52m.k\x1b[0m\x1b[38;2;122;211;241mX\x1b[0m\x1b[38;2;199;70;52mxlooc\x1b[0m\x1b[38;2;122;211;241mKX\x1b[0m\x1b[38;2;199;70;52ml:cd\x1b[0m\x1b[38;2;122;211;241m0N\x1b[0m\x1b[38;2;199;70;52mO.\x1b[0m              \x1b[38;2;199;70;52moxxxx,\x1b[0m',
  '    \x1b[38;2;199;70;52mlxxxxl\x1b[0m              \x1b[38;2;199;70;52m;lO\x1b[0m\x1b[38;2;122;211;241mXK\x1b[0m\x1b[38;2;199;70;52mkd\x1b[0m\x1b[38;2;122;211;241mXN\x1b[0m\x1b[38;2;199;70;52mkx\x1b[0m\x1b[38;2;122;211;241m0K\x1b[0m\x1b[38;2;199;70;52mxol\x1b[0m              \x1b[38;2;199;70;52mlxxxxl\x1b[0m ',
  '     \x1b[38;2;199;70;52mlxxxxo.\x1b[0m          \x1b[38;2;199;70;52m....\x1b[0m  \x1b[38;2;199;70;52m,od\x1b[0m\x1b[38;2;122;211;241mXN\x1b[0m\x1b[38;2;199;70;52mkx,\x1b[0m  \x1b[38;2;199;70;52m..\x1b[0m            \x1b[38;2;199;70;52m.oxxxxl\x1b[0m  ',
  '      \x1b[38;2;199;70;52m,dxxxxo,.\x1b[0m    \x1b[38;2;199;70;52m...\x1b[0m       \x1b[38;2;199;70;52m.:\x1b[0m\x1b[38;2;122;211;241mKX\x1b[0m\x1b[38;2;199;70;52md,\x1b[0m              \x1b[38;2;199;70;52m.,oxxxxd,\x1b[0m   ',
  '        \x1b[38;2;199;70;52m;dxxxxxo:;:.\x1b[0m         \x1b[38;2;199;70;52m.c\x1b[0m\x1b[38;2;122;211;241mKX\x1b[0m\x1b[38;2;199;70;52md.\x1b[0m         \x1b[38;2;199;70;52m..,:oxxxxxd;\x1b[0m     ',
  '          \x1b[38;2;199;70;52m.:oxxxxxxxxxxxxxxxxxx\x1b[0m\x1b[38;2;122;211;241mWW\x1b[0m\x1b[38;2;199;70;52mxxxxxxxxxxxxxxxxxxo:.\x1b[0m       ',
  '            \x1b[38;2;199;70;52m.\'\';cldxxxxxxxxxxxx\x1b[0m\x1b[38;2;122;211;241mXX\x1b[0m\x1b[38;2;199;70;52mxxxxxxxxxxxxdlc;..\x1b[0m          ',
  '         \x1b[38;2;199;70;52m...\x1b[0m                  \x1b[38;2;199;70;52m.\x1b[0m\x1b[38;2;122;211;241mKX\x1b[0m\x1b[38;2;199;70;52m.\x1b[0m                           ',
  '     \x1b[38;2;199;70;52m.::,\x1b[0m                      \x1b[38;2;122;211;241m00\x1b[0m                            ',
  '      \x1b[38;2;199;70;52m;,\x1b[0m                       \x1b[38;2;199;70;52mol\x1b[0m                            ',
  '                               \x1b[38;2;199;70;52m..\x1b[0m                            ',
];

/**
 * Renders the TD mark as an array of lines.
 *
 * @param colorize - Whether to apply colour.
 * @returns The mark's lines.
 */
export function tdMark_linesRender(colorize: boolean): string[] {
  return [...(colorize ? COLOR_LINES : PLAIN_LINES)];
}
