# Plain arm-none-eabi build of one STM32CubeIDE configuration (no IDE needed).
#
#   make -f build-tools/Makefile TREE=V3_TEST CONFIG=DM1701_FW [CROSS=/path/bin/arm-none-eabi-] [-j16]
#
# Works like the IDE: runs inside <TREE>/MDUV380_firmware/<CONFIG>/ so the ../ paths of the
# project resolve the same. Flags come from .cproject (build-tools/cproject_flags.py).
# Needs application/source/linkerdata/codec_bin_section_1.bin: run <TREE>/prepare first
# (codec_cleaner -C creates the empty placeholder; the codec itself is added when flashing).

TREE   ?= V3_TEST
CONFIG ?= DM1701_FW
CROSS  ?= arm-none-eabi-
TOP    := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/..)
FW     := $(TOP)/$(TREE)/MDUV380_firmware
OUT    := $(FW)/$(CONFIG)

ifeq ($(CURDIR),$(OUT))
include flags.mk

CC := $(CROSS)gcc
OBJCOPY := $(CROSS)objcopy
SIZE := $(CROSS)size
MCU := -mcpu=cortex-m4 -mthumb -mfpu=fpv4-sp-d16 -mfloat-abi=hard
GITVERSION := $(shell git -C $(TOP) rev-parse --short HEAD 2>/dev/null || echo UNKNOWN)
CFLAGS = $(MCU) -std=gnu11 -g3 $(COPT) $(CDEFS) $(CINCS) $(CEXTRA) -DGITVERSION=$(GITVERSION) \
         -ffunction-sections -fdata-sections -Wall -fstack-usage --specs=nano.specs -MMD -MP
ASFLAGS = $(MCU) -g3 $(ASDEFS) -x assembler-with-cpp --specs=nano.specs -MMD -MP
LDFLAGS = $(MCU) -T$(LDSCRIPT) --specs=nosys.specs --specs=nano.specs -Wl,-Map=firmware.map \
          -Wl,--gc-sections -static -Wl,--start-group -lc -lm -Wl,--end-group

SRCDIRS := SeggerRTT application Core Middlewares Drivers USB_DEVICE
SRCS := $(filter-out $(EXCLUDE),$(shell cd .. && find $(SRCDIRS) \( -name '*.c' -o -name '*.s' -o -name '*.S' \) | sed 's|^|../|' | sort))
OBJS := $(patsubst ../%,obj/%.o,$(basename $(SRCS)))
OBJS := $(OBJS:%.o.o=%.o)

all: $(OUTBIN)

$(OUTBIN): firmware.bin
	$(TOP)/$(TREE)/MDUV380_firmware/tools/codec_cleaner.Linux -i $< -o $@
	@echo "==> $(OUT)/$@"

firmware.bin: firmware.elf
	$(OBJCOPY) -O binary $< $@
	$(SIZE) $<

firmware.elf: $(OBJS)
	$(CC) -o $@ $^ $(LDFLAGS)

obj/%.o: ../%.c
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -c $< -o $@
obj/%.o: ../%.s
	@mkdir -p $(dir $@)
	$(CC) $(ASFLAGS) -c $< -o $@
obj/%.o: ../%.S
	@mkdir -p $(dir $@)
	$(CC) $(ASFLAGS) -c $< -o $@

-include $(OBJS:.o=.d)
else
.PHONY: all clean
all:
	@mkdir -p $(OUT)
	python3 $(TOP)/build-tools/cproject_flags.py $(FW) $(CONFIG) > $(OUT)/flags.mk
	$(MAKE) -C $(OUT) -f $(abspath $(lastword $(MAKEFILE_LIST))) TREE=$(TREE) CONFIG=$(CONFIG) CROSS=$(CROSS)
clean:
	rm -rf $(OUT)
endif
