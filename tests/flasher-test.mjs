// The browser flasher must build byte for byte the image the Python loader sends.
// node tests/flasher-test.mjs <OpenMDUV380.bin> <OpenDM1701.bin> <donor MD9600 V26.45> <sha uv380> <sha 1701>
import fs from "fs"; import vm from "vm"; import crypto from "crypto";
const ctx = { module: { exports: {} }, crypto: globalThis.crypto, Uint8Array, Array, Math, Error, Promise, setTimeout, console };
vm.createContext(ctx);
const dir = new URL("../docs/flasher/", import.meta.url);
vm.runInContext(fs.readFileSync(new URL("ciphers.js", dir), "utf8") + "\n" + fs.readFileSync(new URL("flasher.js", dir), "utf8") +
  "\nthis.prepareImage=prepareImage; this.M=MODELS; this.DS=DONOR_SHA256;", ctx);
const [uv, dm, donorPath, shaUv, shaDm] = process.argv.slice(2);
const donor = new Uint8Array(fs.readFileSync(donorPath));
const h = b => crypto.createHash("sha256").update(b).digest("hex");
if (h(donor) !== ctx.DS) throw new Error("donor sha");
let ok = true;
for (const [file, model, want] of [[uv, "MD-UV380", shaUv], [dm, "DM-1701", shaDm]]) {
  const img = ctx.prepareImage(new Uint8Array(fs.readFileSync(file)), donor, ctx.M[model].cipher());
  const got = h(img); ok &&= got === want;
  console.log(model, got === want ? "IDENTICAL to the Python loader" : "DIFFERENT " + got);
}
try { ctx.prepareImage(donor, donor, ctx.M["MD-UV380"].cipher()); ok = false; } catch (e) { console.log("official firmware refused:", e.message); }
process.exit(ok ? 0 : 1);
