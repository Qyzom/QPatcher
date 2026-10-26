import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Pango from 'gi://Pango';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

// Auto-paste simulator via virtual keyboard (Shift + Insert)
export function triggerAutoPaste() {
    return new Promise((resolve) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            try {
                const backend = global.stage.context.get_backend();
                const seat = backend.get_default_seat();
                const vDev = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
                const timestamp = GLib.get_monotonic_time();
                const KEY_LEFTSHIFT = 42;
                const KEY_INSERT = 110;
                vDev.notify_key(timestamp, KEY_LEFTSHIFT, Clutter.KeyState.PRESSED);
                vDev.notify_key(timestamp + 10, KEY_INSERT, Clutter.KeyState.PRESSED);
                vDev.notify_key(timestamp + 20, KEY_INSERT, Clutter.KeyState.RELEASED);
                vDev.notify_key(timestamp + 30, KEY_LEFTSHIFT, Clutter.KeyState.RELEASED);
            } catch (e) {
                console.error('[QPatcher] Auto-paste trigger error:', e);
            }
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

function formatTime(timestampSec) {
    if (!timestampSec) return '';
    const now = Math.floor(Date.now() / 1000);
    const diff = Math.max(0, now - timestampSec);
    if (diff < 60) return 'Только что';
    if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
    const d = new Date(timestampSec * 1000);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${hh}:${mm}`;
    }
    const day = String(d.getDate()).padStart(2, '0');
    const mon = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}.${mon}`;
}

export class ClipboardHistoryManager {
    constructor(extension, settings) {
        this._extension = extension;
        this._settings = settings;

        this._history = [];
        this._pinned = [];
        this._selection = null;
        this._ownerChangedId = 0;
        this._debounceId = 0;
        this._skipNextCapture = false;

        const cacheBase = GLib.get_user_cache_dir() + '/qpatcher';
        const dataBase = GLib.get_user_data_dir() + '/qpatcher';
        this._cacheDir = cacheBase;
        this._dataDir = dataBase;
        this._imagesDir = `${dataBase}/images`;
        this._historyFile = `${cacheBase}/clipboard_history.json`;
        this._pinnedFile = `${dataBase}/clipboard_pinned.json`;

        this._ensureDirectories();
        this._migrateOldExtensionData();
        this._loadStorage();
    }

    _ensureDirectories() {
        try {
            for (const path of [this._cacheDir, this._dataDir, this._imagesDir]) {
                const dir = Gio.File.new_for_path(path);
                if (!dir.query_exists(null)) {
                    dir.make_directory_with_parents(null);
                }
            }
        } catch (e) {
            console.error('[QPatcher] Failed to ensure directories:', e);
        }
    }

    _migrateOldExtensionData() {
        try {
            const historyFile = Gio.File.new_for_path(this._historyFile);
            if (historyFile.query_exists(null)) return;

            const oldHistoryPath = `${GLib.get_user_cache_dir()}/all-in-one-clipboard@NiffirgkcaJ.github.com/history_clipboard.json`;
            const oldImagesDir = `${GLib.get_user_data_dir()}/all-in-one-clipboard@NiffirgkcaJ.github.com/images`;
            const oldPinnedPath = `${GLib.get_user_data_dir()}/all-in-one-clipboard@NiffirgkcaJ.github.com/pinned_clipboard.json`;

            const oldHistFile = Gio.File.new_for_path(oldHistoryPath);
            if (!oldHistFile.query_exists(null)) return;

            console.log('[QPatcher] Migrating history from all-in-one-clipboard...');
            const [, histContent] = GLib.file_get_contents(oldHistoryPath);
            const decoder = new TextDecoder('utf-8');
            const items = JSON.parse(decoder.decode(histContent));

            for (const item of items) {
                if (item.type === 'image' && item.image_filename) {
                    const src = Gio.File.new_for_path(`${oldImagesDir}/${item.image_filename}`);
                    const dst = Gio.File.new_for_path(`${this._imagesDir}/${item.image_filename}`);
                    if (src.query_exists(null) && !dst.query_exists(null)) {
                        try {
                            src.copy(dst, Gio.FileCopyFlags.NONE, null, null);
                        } catch (_) {}
                    }
                }
            }

            GLib.file_set_contents(this._historyFile, histContent);

            const oldPinFile = Gio.File.new_for_path(oldPinnedPath);
            if (oldPinFile.query_exists(null)) {
                const [, pinContent] = GLib.file_get_contents(oldPinnedPath);
                GLib.file_set_contents(this._pinnedFile, pinContent);
            }
            console.log('[QPatcher] Migration completed successfully.');
        } catch (e) {
            console.error('[QPatcher] Error during clipboard migration:', e);
        }
    }

    _loadStorage() {
        try {
            const clearOnReboot = this._settings ? this._settings.get_boolean('clipboard-clear-on-reboot') : false;

            const pinFile = Gio.File.new_for_path(this._pinnedFile);
            if (pinFile.query_exists(null)) {
                const [, content] = GLib.file_get_contents(this._pinnedFile);
                const decoder = new TextDecoder('utf-8');
                this._pinned = JSON.parse(decoder.decode(content)) || [];
            } else {
                this._pinned = [];
            }

            if (clearOnReboot) {
                this._history = [];
                this._saveHistory();
                console.log('[QPatcher] Clipboard history cleared on reboot as configured.');
            } else {
                const histFile = Gio.File.new_for_path(this._historyFile);
                if (histFile.query_exists(null)) {
                    const [, content] = GLib.file_get_contents(this._historyFile);
                    const decoder = new TextDecoder('utf-8');
                    this._history = JSON.parse(decoder.decode(content)) || [];
                } else {
                    this._history = [];
                }
            }
        } catch (e) {
            console.error('[QPatcher] Failed to load clipboard storage:', e);
            this._history = [];
            this._pinned = [];
        }
    }

    _saveHistory() {
        try {
            GLib.file_set_contents(this._historyFile, JSON.stringify(this._history));
        } catch (e) {
            console.error('[QPatcher] Failed to save history:', e);
        }
    }

    _savePinned() {
        try {
            GLib.file_set_contents(this._pinnedFile, JSON.stringify(this._pinned));
        } catch (e) {
            console.error('[QPatcher] Failed to save pinned:', e);
        }
    }

    getHistory() {
        return this._history;
    }

    getPinned() {
        return this._pinned;
    }

    getImagesDir() {
        return this._imagesDir;
    }

    getLimit() {
        return this._settings ? this._settings.get_int('clipboard-history-limit') : 50;
    }

    start() {
        this._selection = global.display.get_selection();
        this._ownerChangedId = this._selection.connect('owner-changed', (selection, selectionType) => {
            if (selectionType === Meta.SelectionType.SELECTION_CLIPBOARD) {
                this._onClipboardChanged();
            }
        });
    }

    stop() {
        if (this._debounceId) {
            GLib.source_remove(this._debounceId);
            this._debounceId = 0;
        }
        if (this._ownerChangedId && this._selection) {
            this._selection.disconnect(this._ownerChangedId);
            this._ownerChangedId = 0;
        }
        this._selection = null;
    }

    _onClipboardChanged() {
        if (this._skipNextCapture) {
            this._skipNextCapture = false;
            return;
        }

        if (this._debounceId) {
            GLib.source_remove(this._debounceId);
        }

        this._debounceId = GLib.timeout_add(GLib.PRIORITY_LOW, 150, () => {
            this._debounceId = 0;
            this._captureClipboard();
            return GLib.SOURCE_REMOVE;
        });
    }

    _captureClipboard() {
        const clipboard = St.Clipboard.get_default();

        clipboard.get_content(St.ClipboardType.CLIPBOARD, 'image/png', (_clip, bytes) => {
            if (bytes && bytes.get_size() > 8) {
                const data = bytes.get_data();
                if (data && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
                    this._processCapturedImage(bytes);
                    return;
                }
            }

            clipboard.get_text(St.ClipboardType.CLIPBOARD, (_clip2, text) => {
                if (text && text.trim().length > 0) {
                    this._processCapturedText(text);
                }
            });
        });
    }

    _processCapturedText(text) {
        const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, text, -1);
        if (this._history.length > 0 && this._history[0].hash === hash) {
            return;
        }

        this._history = this._history.filter((item) => item.hash !== hash);

        const item = {
            id: GLib.uuid_string_random(),
            type: 'text',
            text: text,
            preview: text.length > 300 ? text.slice(0, 300) + '...' : text,
            timestamp: Math.floor(Date.now() / 1000),
            hash: hash,
        };

        this._history.unshift(item);
        this._pruneHistory();
        this._saveHistory();
        this._extension._clipboardDialog?.onHistoryUpdated();
    }

    _processCapturedImage(bytes) {
        const data = bytes.get_data();
        const hash = GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, data);
        if (this._history.length > 0 && this._history[0].hash === hash) {
            return;
        }

        const filename = `${Date.now()}_${GLib.uuid_string_random().slice(0, 8)}.png`;
        const filePath = `${this._imagesDir}/${filename}`;
        try {
            GLib.file_set_contents(filePath, data);
        } catch (e) {
            console.error('[QPatcher] Failed to save clipboard image file:', e);
            return;
        }

        this._history = this._history.filter((item) => item.hash !== hash);

        const item = {
            id: GLib.uuid_string_random(),
            type: 'image',
            image_filename: filename,
            timestamp: Math.floor(Date.now() / 1000),
            hash: hash,
        };

        this._history.unshift(item);
        this._pruneHistory();
        this._saveHistory();
        this._extension._clipboardDialog?.onHistoryUpdated();
    }

    _pruneHistory() {
        const limit = this.getLimit();
        if (this._history.length > limit) {
            const pruned = this._history.slice(limit);
            this._history = this._history.slice(0, limit);

            for (const item of pruned) {
                if (item.type === 'image' && item.image_filename) {
                    const isPinned = this._pinned.some((p) => p.image_filename === item.image_filename);
                    if (!isPinned) {
                        try {
                            const f = Gio.File.new_for_path(`${this._imagesDir}/${item.image_filename}`);
                            if (f.query_exists(null)) f.delete(null);
                        } catch (_) {}
                    }
                }
            }
        }
    }

    copyItem(item) {
        this._skipNextCapture = true;
        const clipboard = St.Clipboard.get_default();

        if (item.type === 'image' && item.image_filename) {
            const path = `${this._imagesDir}/${item.image_filename}`;
            try {
                const [, bytes] = GLib.file_get_contents(path);
                const gbytes = GLib.Bytes.new(bytes);
                clipboard.set_content(St.ClipboardType.CLIPBOARD, 'image/png', gbytes);
                clipboard.set_content(St.ClipboardType.PRIMARY, 'image/png', gbytes);
            } catch (e) {
                console.error('[QPatcher] Failed to copy image bytes to clipboard:', e);
            }
        } else if (item.text) {
            clipboard.set_text(St.ClipboardType.CLIPBOARD, item.text);
            clipboard.set_text(St.ClipboardType.PRIMARY, item.text);
        }
    }

    isPinned(id) {
        return this._pinned.some((p) => p.id === id);
    }

    togglePin(item) {
        const idx = this._pinned.findIndex((p) => p.id === item.id);
        if (idx >= 0) {
            this._pinned.splice(idx, 1);
            if (!this._history.some((h) => h.id === item.id)) {
                this._history.unshift(item);
            }
        } else {
            this._pinned.unshift(item);
        }
        this._savePinned();
        this._saveHistory();
        this._extension._clipboardDialog?.onHistoryUpdated();
    }

    deleteItem(item) {
        this._history = this._history.filter((h) => h.id !== item.id);
        this._pinned = this._pinned.filter((p) => p.id !== item.id);

        if (item.type === 'image' && item.image_filename) {
            try {
                const f = Gio.File.new_for_path(`${this._imagesDir}/${item.image_filename}`);
                if (f.query_exists(null)) f.delete(null);
            } catch (_) {}
        }

        this._saveHistory();
        this._savePinned();
        this._extension._clipboardDialog?.onHistoryUpdated();
    }

    clearHistory() {
        for (const item of this._history) {
            if (item.type === 'image' && item.image_filename) {
                const isPinned = this._pinned.some((p) => p.image_filename === item.image_filename);
                if (!isPinned) {
                    try {
                        const f = Gio.File.new_for_path(`${this._imagesDir}/${item.image_filename}`);
                        if (f.query_exists(null)) f.delete(null);
                    } catch (_) {}
                }
            }
        }
        this._history = [];
        this._saveHistory();
        this._extension._clipboardDialog?.onHistoryUpdated();
    }
}

export class EmojiManager {
    constructor(extension) {
        this._extension = extension;
        this._categories = [];
        this._allEmojis = [];
        this._recents = [];
        this._recentsFile = `${GLib.get_user_cache_dir()}/qpatcher/recent_emojis.json`;

        this._loadEmojiData();
        this._loadRecents();
    }

    _loadEmojiData() {
        try {
            const dataFile = `${this._extension.path}/emoji_data.json`;
            const [, content] = GLib.file_get_contents(dataFile);
            const decoder = new TextDecoder('utf-8');
            this._categories = JSON.parse(decoder.decode(content)) || [];

            this._allEmojis = [];
            for (const cat of this._categories) {
                if (cat.emojis) {
                    for (const em of cat.emojis) {
                        this._allEmojis.push(em);
                    }
                }
            }
        } catch (e) {
            console.error('[QPatcher] Failed to load emoji_data.json:', e);
            this._categories = [];
            this._allEmojis = [];
        }
    }

    _loadRecents() {
        try {
            const file = Gio.File.new_for_path(this._recentsFile);
            if (file.query_exists(null)) {
                const [, content] = GLib.file_get_contents(this._recentsFile);
                const decoder = new TextDecoder('utf-8');
                this._recents = JSON.parse(decoder.decode(content)) || [];
            }
        } catch (e) {
            console.error('[QPatcher] Failed to load recent emojis:', e);
            this._recents = [];
        }
    }

    _saveRecents() {
        try {
            GLib.file_set_contents(this._recentsFile, JSON.stringify(this._recents));
        } catch (e) {
            console.error('[QPatcher] Failed to save recent emojis:', e);
        }
    }

    getCategoryList() {
        return [
            { id: 'recent', icon: '🕒', label: 'Недавние' },
            { id: 'smileys', icon: '😃', label: 'Смайлы' },
            { id: 'people', icon: '👋', label: 'Люди' },
            { id: 'animals', icon: '🐶', label: 'Животные' },
            { id: 'food', icon: '🍔', label: 'Еда' },
            { id: 'travel', icon: '✈️', label: 'Места' },
            { id: 'activities', icon: '⚽', label: 'Активности' },
            { id: 'objects', icon: '💡', label: 'Предметы' },
            { id: 'symbols', icon: '🔣', label: 'Символы и цифры' },
            { id: 'flags', icon: '🚩', label: 'Флаги' },
        ];
    }

    getEmojisForCategory(catId) {
        if (catId === 'recent') {
            return this._recents;
        }
        const found = this._categories.find((c) => c.id === catId);
        return found ? found.emojis : [];
    }

    search(query) {
        if (!query || query.trim().length === 0) return null;
        const q = query.trim().toLowerCase();
        const tokens = q.split(/\s+/).filter(Boolean);

        const results = [];
        for (const em of this._allEmojis) {
            if (em.char === q) {
                results.unshift(em);
                continue;
            }
            const searchStr = (em.search || '') + ' ' + (em.name || '');
            let allMatch = true;
            for (const token of tokens) {
                if (!searchStr.includes(token)) {
                    allMatch = false;
                    break;
                }
            }
            if (allMatch) {
                results.push(em);
                if (results.length >= 144) break;
            }
        }
        return results;
    }

    recordRecent(em) {
        this._recents = this._recents.filter((r) => r.char !== em.char);
        this._recents.unshift({
            char: em.char,
            name: em.name || '',
            search: em.search || '',
        });
        if (this._recents.length > 48) {
            this._recents = this._recents.slice(0, 48);
        }
        this._saveRecents();
    }
}

export const QPatcherClipboardDialog = GObject.registerClass(
    class QPatcherClipboardDialog extends ModalDialog.ModalDialog {
        _init(extension, clipboardManager, emojiManager) {
            super._init({
                styleClass: 'qpatcher-clipboard-dialog',
                destroyOnClose: false,
            });

            this._extension = extension;
            this._clipboardManager = clipboardManager;
            this._emojiManager = emojiManager;
            this._currentTab = 'clipboard';
            this._currentEmojiCategory = 'smileys';
            this._activeQuery = '';

            this.dialogLayout.width = 620;
            this.dialogLayout.height = 560;

            this._buildUI();
        }

        _buildUI() {
            this.contentLayout.remove_all_children();
            this.contentLayout.add_style_class_name('qpatcher-modal-container');

            // Header: Search bar + Close
            const headerBox = new St.BoxLayout({
                style_class: 'qpatcher-modal-header',
                vertical: false,
                x_expand: true,
            });

            this._searchEntry = new St.Entry({
                style_class: 'qpatcher-search-entry',
                can_focus: true,
                x_expand: true,
                hint_text: 'Поиск...',
            });

            const searchIcon = new St.Icon({
                icon_name: 'system-search-symbolic',
                style_class: 'qpatcher-search-icon',
            });
            this._searchEntry.set_primary_icon(searchIcon);

            // Setup Ctrl+A (English 'a' and Russian 'ф') & navigation
            this._searchEntry.clutter_text.connect('key-press-event', (_actor, event) => {
                const symbol = event.get_key_symbol();
                const state = event.get_state();
                const isCtrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;

                // Ctrl+A handling (support both English 'a' (0x61, 0x41) and Russian 'ф' (0x6c6, 0x6e6))
                if (isCtrl && (symbol === Clutter.KEY_a || symbol === Clutter.KEY_A || symbol === 0x6c6 || symbol === 0x6e6)) {
                    this._searchEntry.clutter_text.set_selection(0, -1);
                    return Clutter.EVENT_STOP;
                }

                if (symbol === Clutter.KEY_Escape) {
                    this.close();
                    return Clutter.EVENT_STOP;
                }

                return Clutter.EVENT_PROPAGATE;
            });

            this._searchEntry.clutter_text.connect('text-changed', () => {
                this._activeQuery = this._searchEntry.get_text() || '';
                this._onSearchChanged();
            });

            const closeBtn = new St.Button({
                style_class: 'qpatcher-dialog-close-btn',
                child: new St.Icon({
                    icon_name: 'window-close-symbolic',
                    icon_size: 16,
                }),
            });
            closeBtn.connect('clicked', () => this.close());

            headerBox.add_child(this._searchEntry);
            headerBox.add_child(closeBtn);
            this.contentLayout.add_child(headerBox);

            // Tab bar
            const tabBox = new St.BoxLayout({
                style_class: 'qpatcher-tabs-bar',
                vertical: false,
                x_expand: true,
            });

            this._btnTabClipboard = new St.Button({
                label: '📋 История буфера',
                style_class: 'qpatcher-tab-button active',
                x_expand: true,
            });
            this._btnTabClipboard.connect('clicked', () => this.switchTab('clipboard'));

            this._btnTabEmoji = new St.Button({
                label: '😊 Эмодзи',
                style_class: 'qpatcher-tab-button',
                x_expand: true,
            });
            this._btnTabEmoji.connect('clicked', () => this.switchTab('emoji'));

            tabBox.add_child(this._btnTabClipboard);
            tabBox.add_child(this._btnTabEmoji);
            this.contentLayout.add_child(tabBox);

            // Body container
            this._bodyBox = new St.BoxLayout({
                style_class: 'qpatcher-body-box',
                vertical: true,
                x_expand: true,
                y_expand: true,
            });
            this.contentLayout.add_child(this._bodyBox);

            // Tab 1: Clipboard View
            this._clipboardView = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_expand: true,
            });

            this._clipboardScrollView = new St.ScrollView({
                style_class: 'qpatcher-scroll-view',
                x_expand: true,
                y_expand: true,
                overlay_scrollbars: true,
            });
            this._clipboardList = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style_class: 'qpatcher-items-list',
            });
            this._clipboardScrollView.add_child(this._clipboardList);
            this._clipboardView.add_child(this._clipboardScrollView);

            // Clipboard footer
            const clipFooter = new St.BoxLayout({
                style_class: 'qpatcher-footer-bar',
                vertical: false,
                x_expand: true,
            });
            this._clipboardCountLabel = new St.Label({
                text: '',
                style_class: 'qpatcher-footer-label',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const clearBtn = new St.Button({
                label: 'Очистить всё',
                style_class: 'qpatcher-clear-all-btn',
            });
            clearBtn.connect('clicked', () => {
                this._clipboardManager.clearHistory();
                this._refreshClipboardList();
            });

            clipFooter.add_child(this._clipboardCountLabel);
            clipFooter.add_child(clearBtn);
            this._clipboardView.add_child(clipFooter);

            // Tab 2: Emoji View
            this._emojiView = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_expand: true,
            });

            // Category pills bar in horizontal scroll view
            this._categoryScrollView = new St.ScrollView({
                style_class: 'qpatcher-category-scroll',
                vscrollbar_policy: St.PolicyType.NEVER,
                hscrollbar_policy: St.PolicyType.AUTOMATIC,
                x_expand: true,
                overlay_scrollbars: true,
            });
            this._emojiCategoryBar = new St.BoxLayout({
                style_class: 'qpatcher-category-bar',
                vertical: false,
                x_expand: true,
            });
            this._categoryScrollView.add_child(this._emojiCategoryBar);
            this._categoryButtons = [];
            const cats = this._emojiManager.getCategoryList();
            for (const cat of cats) {
                const btn = new St.Button({
                    label: `${cat.icon} ${cat.label}`,
                    style_class: 'qpatcher-category-pill',
                });
                btn.connect('clicked', () => {
                    this._currentEmojiCategory = cat.id;
                    this._searchEntry.set_text('');
                    this._updateCategoryButtons();
                    this._refreshEmojiGrid();
                });
                btn._catId = cat.id;
                this._categoryButtons.push(btn);
                this._emojiCategoryBar.add_child(btn);
            }
            this._emojiView.add_child(this._categoryScrollView);

            // Emoji grid container
            this._emojiScrollView = new St.ScrollView({
                style_class: 'qpatcher-scroll-view',
                x_expand: true,
                y_expand: true,
                overlay_scrollbars: true,
            });
            this._emojiListBox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style_class: 'qpatcher-emoji-list-box',
            });
            this._emojiScrollView.add_child(this._emojiListBox);
            this._emojiView.add_child(this._emojiScrollView);

            // Initial view
            this._bodyBox.add_child(this._clipboardView);
            this._updateCategoryButtons();
        }

        vfunc_key_press_event(event) {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Escape) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            return super.vfunc_key_press_event(event);
        }

        switchTab(tabName) {
            this._currentTab = tabName;
            this._searchEntry.set_text('');
            this._activeQuery = '';

            if (tabName === 'clipboard') {
                this._btnTabClipboard.add_style_class_name('active');
                this._btnTabEmoji.remove_style_class_name('active');
                this._searchEntry.set_hint_text('Поиск в истории буфера...');
                if (this._emojiView.get_parent() === this._bodyBox) {
                    this._bodyBox.remove_child(this._emojiView);
                }
                if (this._clipboardView.get_parent() !== this._bodyBox) {
                    this._bodyBox.add_child(this._clipboardView);
                }
                this._refreshClipboardList();
            } else {
                this._btnTabEmoji.add_style_class_name('active');
                this._btnTabClipboard.remove_style_class_name('active');
                this._searchEntry.set_hint_text('Поиск эмодзи (на русском или английском)...');
                if (this._clipboardView.get_parent() === this._bodyBox) {
                    this._bodyBox.remove_child(this._clipboardView);
                }
                if (this._emojiView.get_parent() !== this._bodyBox) {
                    this._bodyBox.add_child(this._emojiView);
                }
                this._updateCategoryButtons();
                this._refreshEmojiGrid();
            }

            this._searchEntry.grab_key_focus();
        }

        _updateCategoryButtons() {
            for (const btn of this._categoryButtons) {
                if (btn._catId === this._currentEmojiCategory) {
                    btn.add_style_class_name('active');
                } else {
                    btn.remove_style_class_name('active');
                }
            }
        }

        _onSearchChanged() {
            if (this._currentTab === 'clipboard') {
                this._refreshClipboardList();
            } else {
                this._refreshEmojiGrid();
            }
        }

        onHistoryUpdated() {
            if (this._currentTab === 'clipboard') {
                this._refreshClipboardList();
            }
        }

        _refreshClipboardList() {
            this._clipboardList.remove_all_children();

            const query = this._activeQuery.toLowerCase().trim();
            const pinned = this._clipboardManager.getPinned();
            const history = this._clipboardManager.getHistory();

            const filterFn = (item) => {
                if (!query) return true;
                if (item.type === 'text' && item.text) {
                    return item.text.toLowerCase().includes(query);
                }
                return false;
            };

            const visiblePinned = pinned.filter(filterFn);
            const visibleHistory = history.filter(filterFn);

            const totalCount = pinned.length + history.length;
            const maxLimit = this._clipboardManager.getLimit();
            this._clipboardCountLabel.set_text(`Записей: ${totalCount} (лимит: ${maxLimit})`);

            if (visiblePinned.length === 0 && visibleHistory.length === 0) {
                const emptyLabel = new St.Label({
                    text: query ? 'Ничего не найдено' : 'История буфера обмена пуста',
                    style_class: 'qpatcher-empty-label',
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                    x_expand: true,
                    y_expand: true,
                });
                this._clipboardList.add_child(emptyLabel);
                return;
            }

            if (visiblePinned.length > 0) {
                const pinnedHeader = new St.Label({
                    text: 'ЗАКРЕПЛЁННЫЕ',
                    style_class: 'qpatcher-section-header',
                });
                this._clipboardList.add_child(pinnedHeader);

                for (const item of visiblePinned) {
                    this._clipboardList.add_child(this._createHistoryRow(item, true));
                }
            }

            if (visibleHistory.length > 0) {
                if (visiblePinned.length > 0) {
                    const histHeader = new St.Label({
                        text: 'ИСТОРИЯ',
                        style_class: 'qpatcher-section-header',
                    });
                    this._clipboardList.add_child(histHeader);
                }

                for (const item of visibleHistory) {
                    this._clipboardList.add_child(this._createHistoryRow(item, false));
                }
            }
        }

        _createHistoryRow(item, isPinned) {
            const row = new St.Button({
                style_class: `qpatcher-history-row ${isPinned ? 'is-pinned' : ''}`,
                x_expand: true,
                reactive: true,
                can_focus: true,
            });

            const rowContent = new St.BoxLayout({
                vertical: false,
                x_expand: true,
                style_class: 'qpatcher-history-row-content',
            });

            // Icon / Preview on left
            let iconActor;
            if (item.type === 'image' && item.image_filename) {
                const fullPath = `${this._clipboardManager.getImagesDir()}/${item.image_filename}`;
                try {
                    const gicon = Gio.FileIcon.new(Gio.File.new_for_path(fullPath));
                    iconActor = new St.Icon({
                        gicon: gicon,
                        style_class: 'qpatcher-image-thumbnail',
                        icon_size: 40,
                    });
                } catch (_) {
                    iconActor = new St.Icon({
                        icon_name: 'image-x-generic-symbolic',
                        style_class: 'qpatcher-type-icon',
                        icon_size: 24,
                    });
                }
            } else {
                iconActor = new St.Icon({
                    icon_name: 'edit-copy-symbolic',
                    style_class: 'qpatcher-type-icon',
                    icon_size: 24,
                });
            }
            rowContent.add_child(iconActor);

            // Middle: text / info
            const detailsBox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style_class: 'qpatcher-item-details',
            });

            const textLabel = new St.Label({
                text: item.type === 'image' ? 'Изображение (PNG)' : (item.preview || item.text || ''),
                style_class: 'qpatcher-item-text',
                x_expand: true,
            });
            textLabel.clutter_text.line_wrap = false;
            textLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

            const timeLabel = new St.Label({
                text: formatTime(item.timestamp),
                style_class: 'qpatcher-item-time',
            });

            detailsBox.add_child(textLabel);
            detailsBox.add_child(timeLabel);
            rowContent.add_child(detailsBox);

            // Actions on right
            const actionsBox = new St.BoxLayout({
                vertical: false,
                style_class: 'qpatcher-item-actions',
            });

            const pinBtn = new St.Button({
                style_class: `qpatcher-row-action-btn ${isPinned ? 'pinned' : ''}`,
                child: new St.Icon({
                    icon_name: isPinned ? 'starred-symbolic' : 'non-starred-symbolic',
                    icon_size: 16,
                }),
            });
            pinBtn.connect('clicked', () => {
                this._clipboardManager.togglePin(item);
                this._refreshClipboardList();
            });

            const deleteBtn = new St.Button({
                style_class: 'qpatcher-row-action-btn delete',
                child: new St.Icon({
                    icon_name: 'user-trash-symbolic',
                    icon_size: 16,
                }),
            });
            deleteBtn.connect('clicked', () => {
                this._clipboardManager.deleteItem(item);
                this._refreshClipboardList();
            });

            actionsBox.add_child(pinBtn);
            actionsBox.add_child(deleteBtn);
            rowContent.add_child(actionsBox);

            row.set_child(rowContent);

            // Clicking row copies item and auto-pastes
            row.connect('clicked', () => {
                this._clipboardManager.copyItem(item);
                this.close();

                const autoPaste = this._extension._getSettingBool('clipboard-auto-paste', true);
                if (autoPaste) {
                    triggerAutoPaste();
                }
            });

            return row;
        }

        _refreshEmojiGrid() {
            this._emojiListBox.destroy_all_children();

            let emojis = [];
            const query = this._activeQuery.trim();
            if (query) {
                emojis = this._emojiManager.search(query) || [];
                this._categoryScrollView.visible = false;
            } else {
                this._categoryScrollView.visible = true;
                emojis = this._emojiManager.getEmojisForCategory(this._currentEmojiCategory) || [];
            }

            if (emojis.length === 0) {
                const emptyLabel = new St.Label({
                    text: query ? 'Эмодзи не найдены' : 'Список пуст',
                    style_class: 'qpatcher-empty-label',
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                this._emojiListBox.add_child(emptyLabel);
                return;
            }

            // Exactly 12 columns: zero leftover holes, homogeneous spacing
            const COLUMNS = 12;
            let currentRow = null;
            emojis.forEach((em, idx) => {
                if (idx % COLUMNS === 0) {
                    currentRow = new St.BoxLayout({
                        vertical: false,
                        x_expand: true,
                        style_class: 'qpatcher-emoji-row',
                    });
                    this._emojiListBox.add_child(currentRow);
                }

                const btn = new St.Button({
                    style_class: 'qpatcher-emoji-btn',
                    x_expand: true,
                    child: new St.Label({
                        text: em.char,
                        style_class: 'qpatcher-emoji-char',
                    }),
                    can_focus: true,
                });

                btn.connect('clicked', () => {
                    const clipboard = St.Clipboard.get_default();
                    clipboard.set_text(St.ClipboardType.CLIPBOARD, em.char);
                    clipboard.set_text(St.ClipboardType.PRIMARY, em.char);

                    this._emojiManager.recordRecent(em);
                    this.close();

                    const autoPaste = this._extension._getSettingBool('clipboard-auto-paste', true);
                    if (autoPaste) {
                        triggerAutoPaste();
                    }
                });

                currentRow.add_child(btn);
            });
        }

        openModal(initialTab = 'clipboard') {
            const enabled = this._extension._getSettingBool('clipboard-enable', true);
            if (!enabled) return false;

            if (this.state === ModalDialog.State.OPENED || this.state === ModalDialog.State.OPENING) {
                if (this._currentTab !== initialTab) {
                    this.switchTab(initialTab);
                }
                return true;
            }

            this.switchTab(initialTab);
            const opened = this.open();
            if (opened) {
                this._searchEntry.grab_key_focus();
            }
            return opened;
        }
    }
);
