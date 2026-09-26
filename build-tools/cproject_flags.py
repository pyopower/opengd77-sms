#!/usr/bin/env python3
"""Print the compiler/linker settings of one STM32CubeIDE build configuration as make variables.

    cproject_flags.py <firmware dir with .cproject> <config, e.g. DM1701_FW>

Lets the firmware build with a plain arm-none-eabi toolchain (no STM32CubeIDE): defines,
include paths, extra flags, per-file overrides, linker script and post-build output name.
"""
import re
import sys

src, config = sys.argv[1], sys.argv[2]
s = open(f"{src}/.cproject", encoding="utf-8").read()
i = s.index(f'name="{config}"')
blk = s[s.rfind("<cconfiguration", 0, i):s.index("</cconfiguration>", i)]


def tool(body, name):
    m = re.search(r'<tool [^>]*name="%s"[^>]*>(.*?)</tool>' % re.escape(name), body, re.S)
    return m.group(1) if m else ""


def list_opt(body, opt):
    m = re.search(r'<option [^>]*name="%s"[^>]*>(.*?)</option>' % re.escape(opt), body, re.S)
    return re.findall(r'<listOptionValue builtIn="false" value="([^"]+)"', m.group(1)) if m else []


def val_opt(body, opt):
    m = re.search(r'<option [^>]*name="%s"[^>]*?value="([^"]*)"' % re.escape(opt), body)
    return m.group(1).rsplit(".", 1)[-1] if m else ""


root = re.search(r'<folderInfo[^>]*resourcePath=""[^>]*>(.*?)</folderInfo>', blk, re.S).group(1)
cc, asm = tool(root, "MCU GCC Compiler"), tool(root, "MCU GCC Assembler")
defs = dict.fromkeys(list_opt(cc, "Define symbols (-D)"))
opt = {"os": "-Os", "o0": "-O0", "o1": "-O1", "o2": "-O2", "o3": "-O3", "og": "-Og", "ofast": "-Ofast"}
print("CDEFS :=", " ".join(f"-D{d}" for d in defs))
print("ASDEFS :=", " ".join(f"-D{d}" for d in dict.fromkeys(list_opt(asm, "Define symbols (-D)"))))
print("CINCS :=", " ".join(f"-I{p}" for p in list_opt(cc, "Include paths (-I)")))
print("COPT :=", opt.get(val_opt(cc, "Optimization level"), "-Os"))
print("CEXTRA :=", " ".join(f for f in list_opt(cc, "Other flags") if not f.startswith("-DGITVERSION")))
ld = re.search(r'Linker Script \(-T\)"[^>]*?value="\$\{workspace_loc:/\$\{ProjName\}/([^}]+)\}"', blk)
print("LDSCRIPT :=", "../" + (ld.group(1) if ld else "STM32F405VGTX_FLASH.ld"))
post = re.search(r'postbuildStep="[^"]*-o ([^" ]+)"', blk)
print("OUTBIN :=", post.group(1) if post else "firmware.bin")
excl = re.findall(r'<entry excluding="([^"]*)"[^>]*name="([^"]+)"', blk)
print("EXCLUDE :=", " ".join(f"../{n}/{e}" for e, n in excl for e in e.split("|")))
for path, body in re.findall(r'<fileInfo[^>]*resourcePath="([^"]+)"[^>]*>(.*?)</fileInfo>', blk, re.S):
    obj = "obj/" + re.sub(r"\.[cS]$", ".o", path)
    o = val_opt(body, "Optimization level")
    extra = [f for f in list_opt(body, "Other flags") if not f.startswith("-DGITVERSION")]
    if o:
        print(f"{obj}: COPT := {opt[o]}")
    if extra:
        print(f"{obj}: CEXTRA += {' '.join(extra)}")
