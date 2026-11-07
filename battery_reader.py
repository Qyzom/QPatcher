#!/usr/bin/env python3
"""
QPatcher Peripheral Battery Reader
Supports:
- VXE Dragonfly series / CompX wireless mice (VID: 0x373b, 0x3554)
- MCHOSE V9 Turbo gaming headset (VID: 0x3837, PID: 0x600d)
"""

import glob
import json
import os
import sys

VXE_REPORT_ID = 0x08
VXE_CMD_BATTERY = 0x04
VXE_CMD_LEN = 16

def calc_vxe_checksum(buf):
    s = VXE_REPORT_ID + sum(buf[:VXE_CMD_LEN - 1])
    return (0x55 - (s & 0xff)) & 0xff

def build_vxe_battery_request():
    payload = bytearray(VXE_CMD_LEN)
    payload[0] = VXE_CMD_BATTERY
    payload[VXE_CMD_LEN - 1] = calc_vxe_checksum(payload)
    return bytes([VXE_REPORT_ID]) + bytes(payload)

def find_hidraw_devices():
    vxe_nodes = []
    v9_nodes = []

    for p in glob.glob("/sys/class/hidraw/hidraw*"):
        dev_dir = os.path.realpath(os.path.join(p, "device"))
        uevent_file = os.path.join(dev_dir, "uevent")
        if not os.path.exists(uevent_file):
            continue
        try:
            with open(uevent_file, "r") as f:
                content = f.read().upper()
        except Exception:
            continue

        dev_node = f"/dev/{os.path.basename(p)}"
        if "373B:00001085" in content or "373B:1085" in content or "3554:" in content:
            # Prefer vendor config interface (1.1)
            if ":1.1" in dev_dir or "1.1" in dev_dir:
                vxe_nodes.insert(0, dev_node)
            else:
                vxe_nodes.append(dev_node)
        elif "3837:0000600D" in content or "3837:600D" in content:
            v9_nodes.append(dev_node)

    return vxe_nodes, v9_nodes

def query_vxe_mouse(node):
    req = build_vxe_battery_request()
    try:
        with open(node, "r+b", buffering=0) as f:
            f.write(req)
            resp = f.read(64)
            if len(resp) >= 8 and resp[0] == VXE_REPORT_ID and resp[1] == VXE_CMD_BATTERY:
                capacity = int(resp[6])
                is_charging = bool(resp[7])
                voltage_mv = (resp[8] << 8) | resp[9] if len(resp) > 9 else None
                return {
                    "name": "VXE Dragonfly R1+",
                    "connected": True,
                    "battery": capacity,
                    "charging": is_charging,
                    "voltage": voltage_mv,
                    "node": node
                }
    except Exception as e:
        return {
            "name": "VXE Dragonfly R1+",
            "connected": False,
            "error": str(e),
            "node": node
        }
    return None

def query_v9_headset(node):
    # Probe MCHOSE V9 Turbo C-Media USB Audio interface
    try:
        # Check if node is accessible
        with open(node, "r+b", buffering=0) as f:
            # Query vendor report 0x55 or 0x41 if supported
            return {
                "name": "MCHOSE V9 Turbo",
                "connected": True,
                "battery": None,
                "charging": False,
                "state": "Active (USB Audio)",
                "node": node
            }
    except Exception as e:
        return {
            "name": "MCHOSE V9 Turbo",
            "connected": True,
            "battery": None,
            "state": "Connected",
            "error": str(e),
            "node": node
        }

def read_all_peripherals():
    vxe_nodes, v9_nodes = find_hidraw_devices()
    result = {
        "mouse": None,
        "headset": None
    }

    for node in vxe_nodes:
        res = query_vxe_mouse(node)
        if res and res.get("connected"):
            result["mouse"] = res
            break
        elif res and not result["mouse"]:
            result["mouse"] = res

    if not result["mouse"] and vxe_nodes:
        result["mouse"] = {"name": "VXE Dragonfly R1+", "connected": False, "node": vxe_nodes[0]}

    for node in v9_nodes:
        res = query_v9_headset(node)
        if res:
            result["headset"] = res
            break

    return result

def main():
    data = read_all_peripherals()
    if "--human" in sys.argv:
        m = data.get("mouse")
        if m and m.get("battery") is not None:
            chg = " ⚡" if m.get("charging") else ""
            print(f"🖱️ {m.get('name')}: {m.get('battery')}%{chg}")
        elif m:
            print(f"🖱️ {m.get('name')}: Disconnected / Permission Denied")
        else:
            print("🖱️ Mouse: Not Detected")

        h = data.get("headset")
        if h:
            print(f"🎧 {h.get('name')}: {h.get('state', 'Connected')}")
        else:
            print("🎧 Headset: Not Detected")
    else:
        print(json.dumps(data))

if __name__ == "__main__":
    main()
