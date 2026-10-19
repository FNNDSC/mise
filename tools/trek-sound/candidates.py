"""The cues and their candidate reference clips; runs model_export over all of them.

usage: candidates.py FILES_ROOT OUT_DIR  -> OUT_DIR/<cue>__<stem>.json and OUT_DIR/index.json
"""
import json
import subprocess
import sys
from pathlib import Path

CUES = [
    ("press", "console", "Any pill pressed", [("computer/computerbeep_5.mp3", 1.0), ("computer/computerbeep_15.mp3", 1.0), ("computer/computerbeep_38.mp3", 1.0), ("computer/computerbeep_23.mp3", 1.0), ("computer/computerbeep_9.mp3", 1.0), ("computer/computerbeep_11.mp3", 1.0), ("computer/computerbeep_12.mp3", 1.0), ("computer/computerbeep_13.mp3", 1.0), ("computer/computerbeep_26.mp3", 1.0), ("computer/computerbeep_4.mp3", 1.0), ("computer/computerbeep_14.mp3", 1.0), ("computer/computerbeep_10.mp3", 1.0)]),
    ("ack", "console", "A command accepted", [("computer/computerbeep_18.mp3", 1.0), ("computer/computerbeep_19.mp3", 1.0), ("computer/computerbeep_62.mp3", 1.0), ("computer/computerbeep_65.mp3", 1.0), ("computer/computerbeep_41.mp3", 1.0), ("computer/computerbeep_16.mp3", 1.0), ("computer/computerbeep_59.mp3", 1.0), ("computer/computerbeep_20.mp3", 1.0), ("computer/computerbeep_64.mp3", 1.0), ("computer/computerbeep_17.mp3", 1.0), ("computer/computerbeep_21.mp3", 1.0), ("computer/computerbeep_22.mp3", 1.0)]),
    ("deny", "console", "A refused action", [("computer/computer_error.mp3", 1.0), ("computer/denybeep1.mp3", 1.0), ("computer/denybeep2.mp3", 2.0), ("computer/denybeep3.mp3", 1.0), ("computer/denybeep4.mp3", 1.0)]),
    ("open", "console", "A view opening", [("viewscreen/tos_viewscreen_magnification.mp3", 2.5), ("toscomputer/tos_viewscreen_fast.mp3", 2.5), ("viewscreen/tng_viewscreen_on.mp3", 0.6)]),
    ("close", "console", "A view closing; LEAVE BRIDGE", [("viewscreen/tos_main_viewing_screen.mp3", 2.5), ("toscomputer/tos_viewscreen_slow.mp3", 2.5), ("viewscreen/tng_viewscreen_off.mp3", 0.8)]),
    ("thinking", "console", "The computer at work", [("toscomputer/sequences/tos_computerthinking_clean.mp3", 2.5), ("toscomputer/tos_computerthinking1_ep.mp3", 2.5), ("toscomputer/sequences/tos_computerbeeps.mp3", 2.5)]),
    ("sensor", "console", "A scan running", [("toscomputer/tos_sensordisplay_clean.mp3", 1.5), ("toscomputer/sequences/tos_spocks_bridge_scanner.mp3", 3.0), ("toscomputer/sequences/tos_computerscanner_clean.mp3", 3.0)]),
    ("scanner", "console", "A sector or quadrant pressed", [("toscomputer/tos_scanner.mp3", 2.4), ("toscomputer/tos_spectro_analysis_viewer.mp3", 2.5), ("toscomputer/sequences/tos_astrogator_1.mp3", 2.5)]),
    ("phaser", "trek", "FIRE on the phasers", [("weapons/tos_ship_phaser_1.mp3", 1.2), ("weapons/tos_ship_phaser_3.mp3", 1.2), ("weapons/tos_phaser_8.mp3", 3.1)]),
    ("torpedo", "trek", "FIRE on the torpedo", [("weapons/tos_photon_torpedo.mp3", 4.0), ("weapons/tos_photon_torpedo_2.mp3", 4.0), ("weapons/tos_photon_torpedo_from_bridge.mp3", 4.0)]),
    ("incoming", "trek", "A Klingon fires", [("aliensounds/klingon_disruptor_clean.mp3", 1.0), ("weapons/tos_disruptor.mp3", 2.0), ("aliensounds/klingon_torpedo_clean.mp3", 1.2)]),
    ("hit", "trek", "A hit on the shields or hull", [("explosions/tos_hullhit_1.mp3", 3.0), ("explosions/tos_hullhit_2.mp3", 2.8), ("toscomputer/tos_hull_hit.mp3", 1.3)]),
    ("explosion", "trek", "A Klingon destroyed", [("explosions/largeexplosion1.mp3", 2.8), ("explosions/smallexplosion1.mp3", 1.8), ("explosions/console_explo_01.mp3", 2.5)]),
    ("redalert", "trek", "Condition red", [("redalertandklaxons/tos_red_alert.mp3", 4.5), ("redalertandklaxons/tos_red_alert_4.mp3", 4.5), ("redalertandklaxons/tos_klaxon.mp3", 4.5)]),
    ("yellowalert", "trek", "Condition yellow", [("redalertandklaxons/alertklaxon_clean.mp3", 2.7), ("toscomputer/sequences/tos_deflector_alert.mp3", 2.5), ("redalertandklaxons/tos_red_alert_2.mp3", 4.5)]),
    ("green", "trek", "All clear", [("toscomputer/sequences/tos_hailing_frequencies_open.mp3", 2.5), ("toscomputer/tos_com_beep_3.mp3", 1.9), ("toscomputer/tos_intercom_whistle_2.mp3", 1.4)]),
    ("dock", "trek", "Docking at a starbase", [("background/tos_bridge_1_activate.mp3", 3.0), ("toscomputer/sequences/tos_spocksviewer_bridge.mp3", 2.5), ("toscomputer/tos_transporterbeep.mp3", 2.0)]),
    ("warp", "trek", "A move under warp", [("warp/tos_flyby_1.mp3", 1.9), ("warp/tos_flyby_2.mp3", 1.5), ("warp/tng_warp2_clean.mp3", 2.8)]),
    ("impulse", "trek", "A move under impulse", [("background/tos_bridge_8_powerup.mp3", 3.0), ("background/tos_engineering_1.mp3", 3.0), ("background/tos_bridge_viewscreen_slow.mp3", 3.0)]),
    ("transporter", "trek", "Abandon ship", [("toscomputer/tos_energize.mp3", 1.3), ("transporters/tos_transporter8_clean.mp3", 4.5), ("transporters/tos_transporter4_clean.mp3", 4.5)]),
    ("destruct", "trek", "The countdown", [("toscomputer/tos_emergency_signal.mp3", 4.0), ("toscomputer/sequences/tos_buttons_1.mp3", 4.0), ("toscomputer/sequences/tos_sequence_1.mp3", 3.0)]),
    ("hail", "trek", "A starbase answers", [("toscomputer/tos_intercom_whistle.mp3", 1.4), ("toscomputer/tos_intercom_whistle_2.mp3", 1.4), ("toscomputer/tos_hailing.mp3", 1.9)]),
    ("gameover", "trek", "The game ends", [("toscomputer/tos_shipannouncement.mp3", 3.0), ("toscomputer/sequences/tos_sequence_2.mp3", 3.0), ("toscomputer/sequences/tos_sequence_3.mp3", 3.0)]),
]


def export(here, root, rel, target, seconds, stem):
    if target.exists():
        return
    res = subprocess.run([sys.executable, str(here / "model_export.py"), str(root / rel), str(target), "--seconds", str(seconds), "--name", stem, "--source", rel],
                         capture_output=True, text=True)
    print(res.stdout.strip() or res.stderr.strip()[-300:], flush=True)


def main():
    root = Path(sys.argv[1])
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    (out / "beeps").mkdir(exist_ok=True)
    here = Path(__file__).parent
    # the pool: every computer beep, by number
    pool = []
    beeps = sorted((root / "computer").glob("computerbeep_*.mp3"), key=lambda q: int(q.stem.split("_")[1]))
    for q in beeps:
        rel = f"computer/{q.name}"
        target = out / "beeps" / f"{q.stem}.json"
        export(here, root, rel, target, 2.5, q.stem)
        if target.exists():
            pool.append({"file": f"beeps/{q.stem}.json", "source": rel, "name": q.stem, "bytes": target.stat().st_size})
    index = []
    for cue, group, text, cands in CUES:
        entry = {"id": cue, "group": group, "cue": text, "candidates": []}
        for rel, seconds in cands:
            stem = Path(rel).stem
            if rel.startswith("computer/computerbeep_"):
                fname = f"beeps/{stem}.json"
            else:
                fname = f"{cue}__{stem}.json"
            target = out / fname
            export(here, root, rel, target, seconds, stem)
            if target.exists():
                entry["candidates"].append({"file": fname, "source": rel, "name": stem, "bytes": target.stat().st_size})
        index.append(entry)
    (out / "index.json").write_text(json.dumps({"cues": index, "beeps": pool}, indent=1))
    print("index", len(index), "cues", sum(len(e["candidates"]) for e in index), "models")


if __name__ == "__main__":
    main()
