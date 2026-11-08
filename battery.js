import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

function execSubprocess(argv) {
    return new Promise((resolve, reject) => {
        try {
            const proc = new Gio.Subprocess({
                argv: argv,
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            proc.init(null);
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    const [, stdout, stderr] = p.communicate_utf8_finish(res);
                    resolve({ stdout, stderr });
                } catch (err) {
                    reject(err);
                }
            });
        } catch (e) {
            reject(e);
        }
    });
}

export const QPatcherBatteryIndicator = GObject.registerClass(
    class QPatcherBatteryIndicator extends PanelMenu.Button {
        constructor(extension, settings) {
            super(0.5, 'QPatcher Peripheral Battery', false);

            this._extension = extension;
            this._settings = settings;
            this._pollTimeoutId = null;
            this._isQuerying = false;
            this._latestData = null;

            // Panel Actor: Container with Icon and optional Percentage Label
            this._box = new St.BoxLayout({
                style_class: 'panel-status-indicators-box',
                y_align: Clutter.ActorAlign.CENTER,
            });

            this._icon = new St.Icon({
                icon_name: 'battery-level-100-symbolic',
                style_class: 'system-status-icon',
            });
            this._box.add_child(this._icon);

            this._label = new St.Label({
                text: '',
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'qpatcher-battery-panel-label',
            });
            this._label.hide();
            this._box.add_child(this._label);

            this.add_child(this._box);

            this._buildMenu();

            this.menu.connect('open-state-changed', (_menu, isOpen) => {
                if (isOpen) {
                    this.refresh();
                }
            });

            this._updatePanelLabelVisibility();
            if (this._settings?.settings_schema?.has_key('battery-show-percentage-in-panel')) {
                this._settingsSig = this._settings.connect('changed::battery-show-percentage-in-panel', () => {
                    this._updatePanelLabelVisibility();
                });
            }

            this.startPolling();
        }

        _updatePanelLabelVisibility() {
            try {
                const showPct = this._settings?.get_boolean('battery-show-percentage-in-panel') || false;
                if (showPct && this._label.text) {
                    this._label.show();
                } else {
                    this._label.hide();
                }
            } catch (e) {}
        }

        _getBatteryIconName(level, charging) {
            if (level === null || level === undefined) {
                return 'battery-missing-symbolic';
            }
            const rounded = Math.min(100, Math.max(0, Math.round(level / 10) * 10));
            const chgStr = charging ? '-charging' : '';
            return `battery-level-${rounded}${chgStr}-symbolic`;
        }

        _buildMenu() {
            this.menu.removeAll();

            // Header section
            const headerItem = new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false,
            });
            const headerBox = new St.BoxLayout({
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const titleLabel = new St.Label({
                text: 'Peripheral Devices',
                style: 'font-weight: bold; font-size: 13px;',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            headerBox.add_child(titleLabel);

            const refreshBtn = new St.Button({
                style_class: 'button',
                can_focus: true,
                child: new St.Icon({
                    icon_name: 'view-refresh-symbolic',
                    icon_size: 14,
                }),
            });
            refreshBtn.connect('clicked', () => this.refresh());
            headerBox.add_child(refreshBtn);
            headerItem.add_child(headerBox);
            this.menu.addMenuItem(headerItem);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // 1. Mouse item (VXE Dragonfly R1+)
            this._mouseItem = new PopupMenu.PopupBaseMenuItem({ reactive: true });
            this._mouseBox = new St.BoxLayout({
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: 'spacing: 10px;',
            });

            this._mouseIcon = new St.Icon({
                icon_name: 'input-mouse-symbolic',
                icon_size: 18,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._mouseBox.add_child(this._mouseIcon);

            const mouseTextCol = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._mouseTitle = new St.Label({
                text: 'VXE Dragonfly R1+',
                style: 'font-weight: 600;',
            });
            this._mouseSub = new St.Label({
                text: 'Scanning...',
                style: 'font-size: 11px; opacity: 0.7;',
            });
            mouseTextCol.add_child(this._mouseTitle);
            mouseTextCol.add_child(this._mouseSub);
            this._mouseBox.add_child(mouseTextCol);

            this._mouseBadge = new St.Label({
                text: '--',
                style: 'font-weight: bold; padding: 2px 8px; border-radius: 6px; background: rgba(255,255,255,0.08);',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._mouseBox.add_child(this._mouseBadge);

            this._mouseItem.add_child(this._mouseBox);
            this.menu.addMenuItem(this._mouseItem);

            // 2. Headset item (MCHOSE V9 Turbo)
            this._headsetItem = new PopupMenu.PopupBaseMenuItem({ reactive: true });
            this._headsetBox = new St.BoxLayout({
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: 'spacing: 10px;',
            });

            this._headsetIcon = new St.Icon({
                icon_name: 'audio-headphones-symbolic',
                icon_size: 18,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._headsetBox.add_child(this._headsetIcon);

            const headsetTextCol = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._headsetTitle = new St.Label({
                text: 'MCHOSE V9 Turbo',
                style: 'font-weight: 600;',
            });
            this._headsetSub = new St.Label({
                text: 'Scanning...',
                style: 'font-size: 11px; opacity: 0.7;',
            });
            headsetTextCol.add_child(this._headsetTitle);
            headsetTextCol.add_child(this._headsetSub);
            this._headsetBox.add_child(headsetTextCol);

            this._headsetBadge = new St.Label({
                text: 'Active',
                style: 'font-weight: bold; padding: 2px 8px; border-radius: 6px; background: rgba(255,255,255,0.08);',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._headsetBox.add_child(this._headsetBadge);

            this._headsetItem.add_child(this._headsetBox);
            this.menu.addMenuItem(this._headsetItem);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Footer link: QPatcher Preferences
            const prefsItem = new PopupMenu.PopupMenuItem('QPatcher Settings');
            prefsItem.insert_child_at_index(new St.Icon({
                icon_name: 'emblem-system-symbolic',
                icon_size: 14,
                style: 'margin-right: 8px;',
            }), 0);
            prefsItem.connect('activate', () => {
                this._extension.openPreferences();
            });
            this.menu.addMenuItem(prefsItem);
        }

        startPolling() {
            this.refresh();
            const intervalSec = Math.max(10, this._settings?.get_int('battery-poll-interval') || 30);
            if (this._pollTimeoutId) {
                GLib.Source.remove(this._pollTimeoutId);
                this._pollTimeoutId = null;
            }
            this._pollTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, intervalSec, () => {
                this.refresh();
                return GLib.SOURCE_CONTINUE;
            });
        }

        stopPolling() {
            if (this._pollTimeoutId) {
                GLib.Source.remove(this._pollTimeoutId);
                this._pollTimeoutId = null;
            }
        }

        async refresh() {
            if (this._isQuerying) return;
            this._isQuerying = true;

            try {
                const scriptPath = `${this._extension.path}/battery_reader.py`;
                const { stdout, stderr } = await execSubprocess(['python3', scriptPath]);
                if (stdout) {
                    const data = JSON.parse(stdout.trim());
                    this._applyData(data);
                } else if (stderr) {
                    console.error('[QPatcher] Battery reader stderr:', stderr);
                }
            } catch (e) {
                console.error('[QPatcher] Battery refresh error:', e);
            } finally {
                this._isQuerying = false;
            }
        }

        _applyData(data) {
            this._latestData = data;
            const mouse = data?.mouse;
            const headset = data?.headset;

            // 1. Mouse update
            if (mouse && mouse.connected && mouse.battery !== null) {
                const chg = mouse.charging ? ' ⚡' : '';
                this._mouseBadge.text = `${mouse.battery}%${chg}`;
                const voltStr = mouse.voltage ? ` • ${(mouse.voltage / 1000).toFixed(2)} V` : '';
                const stateStr = mouse.charging ? 'Charging' : 'Discharging';
                this._mouseSub.text = `${stateStr}${voltStr}`;
                this._mouseBadge.style = 'font-weight: 600; padding: 2px 8px; border-radius: 6px; background: rgba(255,255,255,0.08);';
            } else if (mouse && mouse.error && mouse.error.includes('Permission denied')) {
                this._mouseSub.text = 'Need udev rule (Permission Denied)';
                this._mouseBadge.text = 'Locked';
                this._mouseBadge.style = 'font-weight: 500; padding: 2px 8px; border-radius: 6px; background: rgba(255,255,255,0.04); opacity: 0.6;';
            } else {
                this._mouseSub.text = 'Not detected / Sleeping';
                this._mouseBadge.text = 'Offline';
                this._mouseBadge.style = 'font-weight: 500; padding: 2px 8px; border-radius: 6px; background: rgba(255,255,255,0.04); opacity: 0.5;';
            }

            // 2. Headset update
            if (headset && headset.connected) {
                if (headset.battery !== null) {
                    this._headsetBadge.text = `${headset.battery}%`;
                    this._headsetSub.text = headset.state || 'Connected';
                } else {
                    this._headsetBadge.text = 'Active';
                    this._headsetSub.text = headset.state || 'USB Audio Device';
                }
                this._headsetBadge.style = 'font-weight: 600; padding: 2px 8px; border-radius: 6px; background: rgba(255,255,255,0.08);';
            } else {
                this._headsetSub.text = 'Disconnected';
                this._headsetBadge.text = 'Offline';
                this._headsetBadge.style = 'font-weight: 500; padding: 2px 8px; border-radius: 6px; background: rgba(255,255,255,0.04); opacity: 0.5;';
            }

            // 3. Top bar icon and label
            if (mouse && mouse.connected && mouse.battery !== null) {
                this._icon.icon_name = this._getBatteryIconName(mouse.battery, mouse.charging);
                this._label.text = `${mouse.battery}%`;
            } else if (headset && headset.connected) {
                this._icon.icon_name = 'battery-level-100-symbolic';
                this._label.text = 'Audio';
            } else {
                this._icon.icon_name = 'battery-missing-symbolic';
                this._label.text = '';
            }

            this._updatePanelLabelVisibility();
        }

        destroy() {
            this.stopPolling();
            if (this._settingsSig && this._settings) {
                this._settings.disconnect(this._settingsSig);
                this._settingsSig = null;
            }
            super.destroy();
        }
    }
);
