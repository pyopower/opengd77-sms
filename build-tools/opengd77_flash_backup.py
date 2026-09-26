#!/usr/bin/env python3
"""Back up an OpenGD77 STM32 radio's data flash over USB, with no CPS (Linux, Raspberry Pi...).

    opengd77_flash_backup.py [--port /dev/ttyACM1] [--out backup-dir]

The radio stays in normal mode, plugged in by its USB programming cable (it shows up as a CDC
serial port). It reads, with the same command the CPS uses ('R', area 1 = SPI flash):

  - the first MB of the SPI flash: codeplug (channels, zones, contacts, TG lists, settings),
    calibration copy and both DMR ID database areas;
  - the SMS store at 8 MB (opengd77-sms).

The factory calibration (flash security registers) is not read: flashing firmware never touches
it, and the firmware's reader of that area (SPI_Flash_readSecurityRegisters) overruns its buffer
for some lengths.

Each part is saved with its SHA-256. Reading does not change anything in the radio.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
import time

import serial

AREA_FLASH = 1
CHUNK = 1024  # the radio's buffer is 2 KB; it may answer less, the reply says how much

PARTS = [
    ("flash-0-1MB.bin", AREA_FLASH, 0x000000, 0x100000),
    ("flash-sms-8MB.bin", AREA_FLASH, 0x800000, 0x2000),
]


def read_block(port: serial.Serial, area: int, address: int, length: int) -> bytes:
    port.write(b"R" + bytes([area]) + address.to_bytes(4, "big") + length.to_bytes(2, "big"))
    head = port.read(3)
    if len(head) < 1 or head[:1] != b"R":
        raise IOError(f"radio refused a read at 0x{address:06X} (area {area}): {head!r}")
    if len(head) < 3:
        raise IOError(f"short reply at 0x{address:06X}")
    n = int.from_bytes(head[1:3], "big")
    data = port.read(n)
    if len(data) != n:
        raise IOError(f"got {len(data)} of {n} bytes at 0x{address:06X}")
    return data


def read_part(port: serial.Serial, area: int, start: int, size: int, label: str) -> bytes:
    out = bytearray()
    t0 = time.monotonic()
    while len(out) < size:
        want = min(CHUNK, size - len(out))
        block = read_block(port, area, start + len(out), want)
        if not block:
            raise IOError("empty reply")
        out += block
        pct = 100 * len(out) // size
        print(f"\r  {label}: {len(out)}/{size} bytes ({pct}%)", end="", flush=True)
    print(f"  [{time.monotonic() - t0:.0f} s]")
    return bytes(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default="/dev/ttyACM1")
    ap.add_argument("--out", default=time.strftime("opengd77-backup-%Y%m%d-%H%M%S"))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    with serial.Serial(a.port, 115200, timeout=3) as port:
        port.reset_input_buffer()
        sums = []
        for name, area, start, size in PARTS:
            try:
                data = read_part(port, area, start, size, name)
            except IOError as e:
                print(f"\n  {name}: {e}")
                if area == AREA_FLASH and start == 0:
                    return 1  # without the main part there is no backup
                continue
            with open(os.path.join(a.out, name), "wb") as f:
                f.write(data)
            sums.append(f"{hashlib.sha256(data).hexdigest()}  {name}")
    with open(os.path.join(a.out, "SHA256SUMS"), "w") as f:
        f.write("\n".join(sums) + "\n")
    print(f"backup in {a.out}/")
    print("\n".join(sums))
    return 0


if __name__ == "__main__":
    sys.exit(main())
