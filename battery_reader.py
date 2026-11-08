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
import select
import sys
import time

VXE_REPORT_ID = 0x08
VXE_CMD_BATTERY = 0x04
VXE_CMD_LEN = 16
CACHE_FILE = "/tmp/qpatcher_peripheral_battery.json"

def calc_vxe_checksum(buf):
    s = VXE_REPORT_ID + sum(buf[:VXE_CMD_LEN - 1])
    return (0x55 - (s & 0xff)) & 0xff

def build_vxe_battery_request():
    payload = bytearray(VXE_CMD_LEN)
    payload[0] = VXE_CMD_BATTERY
    payload[VXE_CMD_LEN - 1] = calc_vxe_checksum(payload)
    return bytes([VXE_REPORT_ID]) + bytes(payload)

def load_cache():
    try:
        if os.path.exists(CACHE_FILE):
            with open(CACHE_FILE, "r") as f:
                return json.load(f)
    except Exception:
        pass
    return {}

def save_cache(cache):
    try:
        with open(CACHE_FILE, "w") as f:
            json.dump(cache, f)
    except Exception:
        pass

def find_hidraw_devices():
    vxe_nodes = []
    v9_nodes = []

    for p in sorted(glob.glob("/sys/class/hidraw/hidraw*")):
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
            # Prefer interface 1.1 (the mouse control interface)
            if ":1.1" in dev_dir or "1.1" in dev_dir:
                vxe_nodes.insert(0, dev_node)
            else:
                vxe_nodes.append(dev_node)
        elif "3837:0000600D" in content or "3837:600D" in content:
            v9_nodes.append(dev_node)

    return vxe_nodes, v9_nodes

def query_vxe_mouse(node, cached_data=None):
    req = build_vxe_battery_request()
    try:
        fd = os.open(node, os.O_RDWR | os.O_NONBLOCK)
    except Exception as e:
        return {
            "name": "VXE Dragonfly R1+",
            "connected": False,
            "error": str(e),
            "node": node
        }

    try:
        # Send battery query packet (17 bytes)
        os.write(fd, req)

        # Wait up to 1.2s for response
        start_time = time.time()
        while time.time() - start_time < 1.2:
            r, _, _ = select.select([fd], [], [], 0.08)
            if not r:
                continue
            resp = os.read(fd, 64)
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
                    "node": node,
                    "updated_at": time.time()
                }
    except Exception as e:
        pass
    finally:
        os.close(fd)

    # If mouse was idle/sleeping but we have recent cached battery data (within 24h)
    if cached_data and cached_data.get("battery") is not None:
        cached_data["connected"] = True
        cached_data["sleeping"] = True
        return cached_data

    return None

def query_v9_headset(node, cached_data=None):
    try:
        fd = os.open(node, os.O_RDWR | os.O_NONBLOCK)
    except Exception as e:
        return {
            "name": "MCHOSE V9 Turbo",
            "connected": False,
            "error": str(e),
            "node": node
        }

    # MCHOSE V9 protocol: 0x55 0x65 0x01
    req = bytearray(64)
    req[0] = 0x55
    req[1] = 0x65
    req[2] = 0x01

    try:
        os.write(fd, bytes(req))
        start_time = time.time()
        while time.time() - start_time < 0.8:
            r, _, _ = select.select([fd], [], [], 0.05)
            if not r:
                continue
            resp = os.read(fd, 64)
            if len(resp) >= 4 and resp[0] == 0x55 and resp[1] == 0x65:
                battery = int(resp[2])
                charging = bool(resp[3] == 1)
                return {
                    "name": "MCHOSE V9 Turbo",
                    "connected": True,
                    "battery": battery,
                    "charging": charging,
                    "state": "Charging" if charging else "2.4G Wireless",
                    "node": node,
                    "updated_at": time.time()
                }
    except Exception:
        pass
    finally:
        os.close(fd)

    if cached_data and cached_data.get("battery") is not None:
        cached_data["connected"] = True
        return cached_data

    return None

def find_v9_headset(v9_hidraw_nodes, cached_headset=None):
    # 1. First try active 2.4G dongle HID query
    for node in v9_hidraw_nodes:
        res = query_v9_headset(node, cached_headset)
        if res and res.get("connected") and res.get("battery") is not None:
            return res

    # 2. Check if wired USB cable is connected (10d6:10d6)
    wired_path = None
    for p in sorted(glob.glob('/sys/bus/usb/devices/*')):
        v_file = os.path.join(p, 'idVendor')
        p_file = os.path.join(p, 'idProduct')
        if os.path.exists(v_file) and os.path.exists(p_file):
            try:
                with open(v_file) as vf, open(p_file) as pf:
                    if vf.read().strip().lower() == '10d6' and pf.read().strip().lower() == '10d6':
                        wired_path = p
                        break
            except Exception:
                pass

    if wired_path:
        if cached_headset and cached_headset.get("battery") is not None:
            cached_headset["connected"] = True
            cached_headset["charging"] = True
            cached_headset["state"] = "Charging (Wired)"
            return cached_headset
        return {
            "name": "MCHOSE V9 Turbo",
            "connected": True,
            "battery": None,
            "charging": True,
            "state": "Charging (Plug 2.4G dongle for %)",
            "node": wired_path
        }

    # 3. Check ALSA sound cards (PipeWire / ALSA)
    for card in sorted(glob.glob('/sys/class/sound/card*')):
        id_file = os.path.join(card, 'id')
        if os.path.exists(id_file):
            try:
                with open(id_file) as f:
                    c_id = f.read().strip().upper()
                    if 'MCHOSE' in c_id or 'V9' in c_id or 'TURBO' in c_id:
                        if cached_headset and cached_headset.get("battery") is not None:
                            cached_headset["connected"] = True
                            return cached_headset
                        return {
                            "name": "MCHOSE V9 Turbo",
                            "connected": True,
                            "battery": None,
                            "charging": False,
                            "state": "Audio Active",
                            "node": card
                        }
            except Exception:
                pass

    # 4. If we have recent cached battery and 2.4G dongle is plugged but headset is asleep
    if v9_hidraw_nodes:
        if cached_headset and cached_headset.get("battery") is not None:
            cached_headset["connected"] = True
            cached_headset["sleeping"] = True
            return cached_headset

    return None

def read_all_peripherals():
    cache = load_cache()
    vxe_nodes, v9_nodes = find_hidraw_devices()
    result = {
        "mouse": None,
        "headset": None
    }

    cached_mouse = cache.get("mouse")
    for node in vxe_nodes:
        res = query_vxe_mouse(node, cached_mouse)
        if res and res.get("connected"):
            result["mouse"] = res
            cache["mouse"] = res
            save_cache(cache)
            break
        elif res and not result["mouse"]:
            result["mouse"] = res

    if not result["mouse"] and vxe_nodes:
        if cached_mouse and cached_mouse.get("battery") is not None:
            cached_mouse["connected"] = True
            cached_mouse["sleeping"] = True
            result["mouse"] = cached_mouse
        else:
            result["mouse"] = {"name": "VXE Dragonfly R1+", "connected": False, "node": vxe_nodes[0]}

    cached_headset = cache.get("headset")
    headset_res = find_v9_headset(v9_nodes, cached_headset)
    if headset_res and headset_res.get("connected") and headset_res.get("battery") is not None:
        cache["headset"] = headset_res
        save_cache(cache)
    result["headset"] = headset_res

    return result

def main():
    data = read_all_peripherals()
    if "--human" in sys.argv:
        m = data.get("mouse")
        if m and m.get("battery") is not None:
            chg = " ⚡" if m.get("charging") else ""
            sleep = " (Idle)" if m.get("sleeping") else ""
            volt = f" • {m.get('voltage')} mV" if m.get('voltage') else ""
            print(f"🖱️ {m.get('name')}: {m.get('battery')}%{chg}{sleep}{volt}")
        elif m and m.get("error"):
            print(f"🖱️ {m.get('name')}: Error: {m.get('error')}")
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
