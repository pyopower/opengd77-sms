// OpenGD77 STM32 firmware flasher for the browser (WebUSB), a port of tools/opengd77_stm32_firmware_loader.py.
// Nothing leaves the browser: the donor firmware is read locally, patched into the image and sent over USB.
"use strict";

// Radios: firmware file, bootloader XOR key.
const MODELS = {
  "MD-UV380":           { file: "OpenMDUV380.bin",          cipher: () => MDUV380_ENCODE_CIPHER, tested: true },
  "MD-UV380 10W Plus":  { file: "OpenMDUV380_10W_PLUS.bin", cipher: () => MDUV380_ENCODE_CIPHER, tested: false },
  "DM-1701":            { file: "OpenDM1701.bin",           cipher: () => DM1701_ENCODE_CIPHER,  tested: true },
  "RT-84":              { file: "OpenRT84.bin",             cipher: () => DM1701_ENCODE_CIPHER,  tested: false },
};

const OFFICIAL_FIRMWARE_HEADER = [0x4F,0x75,0x74,0x53,0x65,0x63,0x75,0x72,0x69,0x74,0x79,0x42,0x69,0x6E,0x00,0x00]; // "OutSecurityBin"
const CODEC_DONOR_OFFSET = 0xC2C7C, CODEC_LENGTH = 0x48BB0, CODEC_TARGET = 0x6937C;

async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// The image the radio's bootloader expects: AMBE codec copied (decrypted) from the donor, then all XORed
// with the model's key. Same bytes as the Python loader (checked in tests/flasher-test.mjs).
function prepareImage(openFw, donor, cipher) {
  if (OFFICIAL_FIRMWARE_HEADER.every((b, i) => openFw[i] === b)) throw new Error("official-as-firmware");
  const img = new Uint8Array(openFw);
  if (donor) {
    const enc = donor.slice(CODEC_DONOR_OFFSET, CODEC_DONOR_OFFSET + CODEC_LENGTH);
    const off = CODEC_TARGET % 1024;
    for (let j = 0; j < enc.length; j++) enc[j] ^= MD9600_ENCODE_CIPHER[(j + off) % 1024];
    if (img.length >= enc.length + CODEC_TARGET) img.set(enc, CODEC_TARGET);
  }
  for (let j = 0; j < img.length; j++) img[j] ^= cipher[j % 1024];
  return img;
}

// ---- DFU (STM32 DfuSe dialect of the TYT/Baofeng bootloader) ----
const DFU = { DNLOAD: 1, GETSTATUS: 3, CLRSTATUS: 4, ABORT: 6 };
const ST = { IDLE: 2, DNBUSY: 4, DNIDLE: 5, UPIDLE: 9 };
const BLOCK = 1024;
const SECTIONS = [ // address, size, last block number
  [0x0800C000, 0x4000, 0x11], [0x08010000, 0x10000, 0x41], [0x08020000, 0x20000, 0x81], [0x08040000, 0x20000, 0x81],
  [0x08060000, 0x20000, 0x81], [0x08080000, 0x20000, 0x81], [0x080A0000, 0x20000, 0x81], [0x080C0000, 0x20000, 0x81],
  [0x080E0000, 0x20000, 0x81], [0x08100000, 0x20000, 0x81],
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const le32 = a => [0, 8, 16, 24].map(s => (a >>> s) & 0xFF);

class Dfu {
  constructor(dev) { this.dev = dev; }
  static async request() {
    const dev = await navigator.usb.requestDevice({ filters: [{ vendorId: 0x0483, productId: 0xDF11 }] });
    await dev.open();
    if (dev.configuration === null) await dev.selectConfiguration(1);
    await dev.claimInterface(0);
    return new Dfu(dev);
  }
  out(request, value, data) {
    return this.dev.controlTransferOut({ requestType: "class", recipient: "interface", request, value, index: 0 },
      data ? new Uint8Array(data) : undefined);
  }
  async status() {
    const r = await this.dev.controlTransferIn({ requestType: "class", recipient: "interface", request: DFU.GETSTATUS, value: 0, index: 0 }, 6);
    return r.data.getUint8(4);
  }
  async expect(stage, ...states) {
    for (const want of states) {
      const got = await this.status();
      if (got !== want) throw new Error(`DFU ${stage}: state ${got}, expected ${want}`);
    }
  }
  async waitIdle() {
    for (let i = 0; i < 50; i++) {
      if (await this.status() === ST.IDLE) return;
      await this.out(DFU.CLRSTATUS, 0);
    }
    throw new Error("DFU: the radio does not become idle");
  }
  async init() {
    for (let i = 0; i < 4; i++) {
      const s = await this.status();
      if (s === ST.IDLE) return;
      if (s === ST.DNIDLE || s === ST.UPIDLE) await this.out(DFU.ABORT, 0); else await this.out(DFU.CLRSTATUS, 0);
    }
  }
  async custom(a, b) {
    await this.out(DFU.DNLOAD, 0, [a & 0xFF, b & 0xFF]);
    await this.status(); await sleep(100); await this.status();
    await this.waitIdle();
  }
  async erase(addr) { await this.out(DFU.DNLOAD, 0, [0x41, ...le32(addr)]); await this.expect("erase", ST.DNBUSY, ST.DNIDLE); }
  async setAddress(addr) { await this.out(DFU.DNLOAD, 0, [0x21, ...le32(addr)]); await this.expect("set address", ST.DNBUSY, ST.DNIDLE); }
  async write(block, chunk) { await this.out(DFU.DNLOAD, block, chunk); await this.expect("write", ST.DNBUSY, ST.DNIDLE); }
  async leave() {
    await this.setAddress(0x08000000);
    try { await this.out(DFU.DNLOAD, 0); await this.status(); } catch (e) { /* the radio reboots */ }
    try { await this.dev.close(); } catch (e) { /* gone */ }
  }

  // progress(fraction, text)
  async flash(image, progress) {
    await this.init();
    await this.waitIdle();
    await this.custom(0x91, 0x01);
    await this.custom(0x91, 0x31);
    for (let i = 0; i < SECTIONS.length; i++) {
      await this.erase(SECTIONS[i][0]);
      progress(0.1 * (i + 1) / SECTIONS.length, "erase");
    }
    let pos = 0;
    for (const [addr, size, lastBlock] of SECTIONS) {
      await this.setAddress(addr);
      let written = 0, block = 2;
      while (pos < image.length && written < size) {
        if (block > lastBlock) throw new Error("block overflow");
        const chunk = new Uint8Array(BLOCK).fill(0xFF);
        chunk.set(image.subarray(pos, pos + BLOCK));
        await this.write(block, chunk);
        pos += BLOCK; written += BLOCK; block++;
        progress(0.1 + 0.9 * Math.min(1, pos / image.length), "write");
      }
    }
    await this.leave();
  }
}

if (typeof module !== "undefined") module.exports = { prepareImage, MODELS, sha256Hex };
