# bsd-trek

The 1976 Berkeley trek game, in your terminal.

You command the Enterprise. The galaxy is crawling with Klingons and you have until the stardate runs out to destroy them all, using warp drive, phasers, photon torpedoes, a long-range scanner and the occasional friendly starbase. This is BSD trek(6), the game that shipped with Berkeley Unix, ported line for line from NetBSD's C sources to TypeScript. It plays exactly as the original: give it the same galaxy seed and the same answers and it prints what the C printed, byte for byte.

## Play

You need [Node.js](https://nodejs.org) 22 or newer.

```
npx bsd-trek
```

To keep it around:

```
npm install -g bsd-trek
trek
```

The global install gives you two commands, `trek` and `bsd-trek`; they are the same game.

## How to play

The game opens by asking three things: how long a game (`short`, `medium` or `long`), how hard (`novice` up to `impossible`; start with `novice`), and a password (used to check a restarted game; anything will do).

Then it prints a short-range scan of the quadrant you are in, a 10 by 10 grid of sectors, and waits at `Command:`. Every command can be shortened to its first letters, shown in brackets:

| Command | What it does |
| --- | --- |
| `s`rscan | Short-range scan of this quadrant; `st`atus for the ship's state alone |
| `l`rscan | Long-range scan: the quadrants around you, each as three digits (Klingons, starbases, stars) |
| `m`ove | Warp to another place: give a course and a distance |
| `i`mpulse | Move slowly within the quadrant on impulse engines |
| `w`arp | Set the warp factor (1 to 10); faster burns more energy and risks the engines |
| `p`hasers | Fire phasers; `automatic` aims for you |
| `t`orpedo | Fire photon torpedoes along a course |
| `sh`ield | Raise or lower the shields |
| `do`ck / `u`ndock | Dock at an adjacent starbase to refuel, rearm and repair |
| `r`est | Let time pass (repairs happen while you rest) |
| `c`omputer | Course and distance to a quadrant, a record of scans, and more |
| `da`mages | Damage report |
| `help` | Every command, in the game itself |

Courses are in degrees: 0 is up, 90 is right, and so on clockwise. Distances are in quadrants (one quadrant is ten sectors). In the scans, `E` is you, `K` a Klingon, `#` a starbase, `*` a star and `@` an inhabited star system.

Klingons shoot back, multiply and attack starbases, and running out of energy or time ends the game. Dock often.

## Options

```
trek [--classic] [-f | -s] [--seed N]
```

| Option | Effect |
| --- | --- |
| `--classic` | The original look: no glyphs, no colour. Colour is also off when the output is piped or `NO_COLOR` is set. |
| `-f` | Faster messages (repeat for faster still); `-s` slow. |
| `--seed N` | A fixed galaxy: the same seed and the same answers replay the same game. |
| `--help`, `--version` | As usual. |

## Saving a game

`dump` at the `Command:` prompt saves the game; next time, answer `restart` to "What length game" to pick it up. The save is one file in your state directory: `~/.local/state/bsd-trek/trek.dump` on Linux (or under `$XDG_STATE_HOME`), `~/Library/Application Support/bsd-trek/trek.dump` on macOS. `trek --help` prints the exact path.

## History

Eric Allman wrote trek in C at Berkeley in 1976, from a FORTRAN version, itself from a BASIC game by Mike Mayfield, with help and ideas from the people the original credits (they are in [LICENSE](LICENSE)). It shipped in BSD's games collection and still does in NetBSD, whose sources this port follows; each module names the C file and revision it came from.

## Licence

BSD-3-Clause, the original's licence; see [LICENSE](LICENSE).

Star Trek is a trademark of Paramount. This is an unaffiliated port of a 1976 public game and uses nothing of Paramount's beyond the name the original carried.

## Part of mise

bsd-trek is part of [mise](https://github.com/FNNDSC/mise), a web shell over a backend. The same engine plays as `trek` in mise's shell, chell, and in its browser surface, ARGUS.
