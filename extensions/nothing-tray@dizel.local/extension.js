import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const STORE_DIR = GLib.build_filenamev([GLib.get_user_config_dir(), 'nothing-tray']);
const STORE_FILE = GLib.build_filenamev([STORE_DIR, 'hidden.json']);
const EXTRA_ROLES = ['widgets@distro.com'];
const AUTO_COLLAPSE_S = 8;
const REVEAL_MS = 160;

const CHEVRON_LEFT = ['...#', '..#.', '.#..', '#...', '.#..', '..#.', '...#'];
const CHEVRON_RIGHT = CHEVRON_LEFT.map(row => [...row].reverse().join(''));

function normalize(text) {
    return (text ?? '').toLowerCase().replace(/[^a-z0-9а-яё]/g, '');
}

function loadHidden() {
    try {
        const [ok, bytes] = GLib.file_get_contents(STORE_FILE);
        if (ok)
            return new Set(JSON.parse(new TextDecoder().decode(bytes)));
    } catch {}
    return new Set();
}

function saveHidden(hidden) {
    try {
        GLib.mkdir_with_parents(STORE_DIR, 0o755);
        GLib.file_set_contents(STORE_FILE, JSON.stringify([...hidden], null, 1));
    } catch (e) {
        logError(e, '[nothing-tray] save');
    }
}

const TrayToggle = GObject.registerClass(
class NothingTrayToggle extends PanelMenu.Button {
    constructor(owner) {
        super(0.5, 'Трей', true);
        this._owner = owner;
        this._expanded = false;
        this._badge = false;
        this.add_style_class_name('nt-toggle');

        this._area = new St.DrawingArea({width: 18, height: 16, y_align: Clutter.ActorAlign.CENTER});
        this._area.connect('repaint', () => this._paint());
        this.add_child(this._area);
    }

    _paint() {
        const cr = this._area.get_context();
        try {
            let [r, g, b] = [1, 1, 1];
            try {
                const color = this.get_theme_node().get_foreground_color();
                [r, g, b] = [color.red / 255, color.green / 255, color.blue / 255];
            } catch {}
            const rows = this._expanded ? CHEVRON_RIGHT : CHEVRON_LEFT;
            const pitch = 2.2;
            rows.forEach((row, y) => {
                [...row].forEach((cell, x) => {
                    if (cell !== '#')
                        return;
                    cr.setSourceRGBA(r, g, b, 0.9);
                    cr.arc(3 + x * pitch + 1.1, 0.5 + y * pitch + 1.1, 0.95, 0, 2 * Math.PI);
                    cr.fill();
                });
            });
            if (this._badge) {
                cr.setSourceRGBA(0.843, 0.098, 0.129, 1);
                cr.arc(15, 3, 2.4, 0, 2 * Math.PI);
                cr.fill();
            }
        } finally {
            cr.$dispose();
        }
    }

    setExpanded(expanded) {
        this._expanded = expanded;
        this._area.queue_repaint();
    }

    setBadge(badge) {
        if (this._badge === badge)
            return;
        this._badge = badge;
        this._area.queue_repaint();
    }

    setDropHint(active) {
        if (active)
            this.add_style_pseudo_class('drop');
        else
            this.remove_style_pseudo_class('drop');
    }

    vfunc_button_press_event(event) {
        if (event.get_button() === Clutter.BUTTON_PRIMARY)
            this._owner.toggleExpanded();
        return Clutter.EVENT_STOP;
    }

    vfunc_touch_event(event) {
        if (event.type() === Clutter.EventType.TOUCH_BEGIN)
            this._owner.toggleExpanded();
        return Clutter.EVENT_STOP;
    }
});

export default class NothingTrayExtension extends Extension {
    enable() {
        this._hidden = loadHidden();
        this._icons = new Map();
        this._sources = new Map();
        this._expanded = false;
        this._dragging = false;
        this._collapseId = 0;
        this._syncId = 0;

        this._toggle = new TrayToggle(this);
        Main.panel.addToStatusArea('nothing-tray', this._toggle, 0, 'right');

        Main.panel._rightBox.connectObject(
            'child-added', () => this._queueSync(),
            'child-removed', () => this._queueSync(),
            this);

        Main.messageTray.connectObject(
            'source-added', (_, source) => this._watchSource(source),
            'source-removed', (_, source) => this._unwatchSource(source),
            this);
        Main.messageTray.getSources().forEach(source => this._watchSource(source));

        this._sync();
    }

    disable() {
        if (this._syncId)
            GLib.source_remove(this._syncId);
        if (this._collapseId)
            GLib.source_remove(this._collapseId);
        this._syncId = this._collapseId = 0;

        Main.panel._rightBox.disconnectObject(this);
        Main.messageTray.disconnectObject(this);
        for (const source of [...this._sources.keys()])
            this._unwatchSource(source);

        for (const button of [...this._icons.keys()])
            this._detach(button);

        this._toggle?.destroy();
        this._toggle = null;
        this._icons = null;
        this._sources = null;
        this._hidden = null;
    }

    _keyFor(button) {
        const indicator = button._indicator;
        return normalize(indicator?.id) || normalize(indicator?.title) || normalize(button.accessible_name);
    }

    _names(button) {
        const indicator = button._indicator;
        return [indicator?.id, indicator?.title, button.accessible_name]
            .map(normalize)
            .filter(name => name.length >= 4);
    }

    _trayButtons() {
        return Object.entries(Main.panel.statusArea)
            .filter(([key, button]) => (key.startsWith('appindicator-') || EXTRA_ROLES.includes(key)) &&
                button && !button._nothingTrayDestroyed)
            .map(([, button]) => button);
    }

    _queueSync() {
        if (this._syncId)
            return;
        this._syncId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._syncId = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _attach(button) {
        let capturedId = 0;
        let clone = null;
        let dragging = false;
        let startX = 0;
        let startY = 0;

        const stopCapture = () => {
            if (capturedId) {
                button.disconnect(capturedId);
                capturedId = 0;
            }
        };

        const finishDrag = (x, y) => {
            stopCapture();
            this._dragging = false;
            this._toggle?.setDropHint(false);
            clone?.destroy();
            clone = null;
            if (dragging && this._pointerOnToggle(x, y))
                this.toggleHidden(button);
            dragging = false;
            this._armCollapse();
        };

        const onCaptured = (_, event) => {
            const type = event.type();
            if (type === Clutter.EventType.MOTION) {
                const [x, y] = event.get_coords();
                if (!dragging) {
                    if (Math.hypot(x - startX, y - startY) < 8)
                        return Clutter.EVENT_STOP;
                    dragging = true;
                    button._waitDoubleClickPromise?.cancel();
                    if (button.menu?.isOpen)
                        button.menu.close();
                    clone = new Clutter.Clone({
                        source: button,
                        width: button.width,
                        height: button.height,
                        opacity: 200,
                    });
                    Main.uiGroup.add_child(clone);
                    Main.uiGroup.set_child_above_sibling(clone, null);
                    clone.set_position(x - button.width / 2, y - button.height / 2);
                    this._dragging = true;
                    this._toggle.setDropHint(true);
                    this._holdOpen();
                } else if (clone) {
                    clone.set_position(x - button.width / 2, y - button.height / 2);
                    this._toggle.setDropHint(this._pointerOnToggle(x, y));
                }
                return Clutter.EVENT_STOP;
            }
            if (type === Clutter.EventType.BUTTON_RELEASE || type === Clutter.EventType.TOUCH_END) {
                const [x, y] = event.get_coords();
                const wasDragging = dragging;
                finishDrag(x, y);
                return wasDragging ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
            }
            return Clutter.EVENT_PROPAGATE;
        };

        const pressId = button.connect('button-press-event', (_, event) => {
            if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_PROPAGATE;
            [startX, startY] = event.get_coords();
            dragging = false;
            stopCapture();
            capturedId = button.connect('captured-event', onCaptured);
            return Clutter.EVENT_PROPAGATE;
        });

        const entry = {statusId: 0, menuId: 0, destroyId: 0, pressId, stopCapture};
        if (button._indicator?.connect)
            entry.statusId = button._indicator.connect('status', () => this._updateBadges());
        if (button.menu?.connect)
            entry.menuId = button.menu.connect('open-state-changed', (_, open) => {
                if (open)
                    this._holdOpen();
                else
                    this._armCollapse();
            });
        entry.destroyId = button.connect('destroy', () => {
            button._nothingTrayDestroyed = true;
            this._icons?.delete(button);
            this._queueSync();
        });
        this._icons.set(button, entry);
    }

    _detach(button) {
        const entry = this._icons.get(button);
        if (!entry)
            return;
        this._icons.delete(button);
        if (button._nothingTrayDestroyed)
            return;

        entry.stopCapture?.();
        if (entry.statusId)
            button._indicator?.disconnect(entry.statusId);
        if (entry.menuId)
            button.menu?.disconnect(entry.menuId);
        button.disconnect(entry.destroyId);
        button.disconnect(entry.pressId);
        button.container.remove_all_transitions();
        button.container.opacity = 255;
        button.container.show();
    }

    _pointerOnToggle(x, y) {
        const toggle = this._toggle;
        if (!toggle?.mapped)
            return false;
        const [tx, ty] = toggle.get_transformed_position();
        const [width, height] = toggle.get_transformed_size();
        const slack = 6;
        return x >= tx - slack && x <= tx + width + slack && y >= ty - slack && y <= ty + height + slack;
    }

    _isHidden(button) {
        return this._hidden.has(this._keyFor(button));
    }

    _sync() {
        if (!this._toggle)
            return;

        for (const button of this._trayButtons()) {
            if (!this._icons.has(button))
                this._attach(button);
        }

        const box = this._toggle.container.get_parent();
        const hidden = [...this._icons.keys()].filter(button => this._isHidden(button));
        let index = 0;
        for (const button of hidden) {
            if (button.container.get_parent() === box)
                box.set_child_at_index(button.container, index++);
            if (!this._expanded)
                button.container.hide();
        }
        box.set_child_at_index(this._toggle.container, index);
        this._toggle.visible = hidden.length > 0 || this._icons.size > 0;

        this._updateBadges();
    }

    toggleHidden(button) {
        const key = this._keyFor(button);
        if (!key)
            return;
        if (this._hidden.has(key)) {
            this._hidden.delete(key);
            button.container.show();
        } else {
            this._hidden.add(key);
            if (!this._expanded)
                button.container.hide();
        }
        saveHidden(this._hidden);
        this._sync();
    }

    toggleExpanded() {
        this._setExpanded(!this._expanded);
    }

    _setExpanded(expanded) {
        this._expanded = expanded;
        this._toggle.setExpanded(expanded);

        for (const button of this._icons.keys()) {
            if (!this._isHidden(button))
                continue;
            const container = button.container;
            container.remove_all_transitions();
            if (expanded) {
                container.opacity = 0;
                container.show();
                container.ease({opacity: 255, duration: REVEAL_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            } else {
                container.ease({
                    opacity: 0,
                    duration: REVEAL_MS,
                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    onStopped: () => {
                        if (!this._expanded) {
                            container.hide();
                            container.opacity = 255;
                        }
                    },
                });
            }
        }

        if (expanded)
            this._armCollapse();
        else
            this._holdOpen();
    }

    _holdOpen() {
        if (this._collapseId) {
            GLib.source_remove(this._collapseId);
            this._collapseId = 0;
        }
    }

    _armCollapse() {
        this._holdOpen();
        if (!this._expanded)
            return;
        this._collapseId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, AUTO_COLLAPSE_S, () => {
            this._collapseId = 0;
            const menuOpen = [...this._icons.keys()].some(button => button.menu?.isOpen);
            if (menuOpen || this._dragging)
                this._armCollapse();
            else
                this._setExpanded(false);
            return GLib.SOURCE_REMOVE;
        });
    }

    _watchSource(source) {
        if (this._sources.has(source))
            return;
        this._sources.set(source, source.connect('notify::count', () => this._updateBadges()));
        this._updateBadges();
    }

    _unwatchSource(source) {
        const id = this._sources.get(source);
        if (id)
            source.disconnect(id);
        this._sources.delete(source);
        this._updateBadges();
    }

    _hasUnread(button) {
        if (button._indicator?.status === 'NeedsAttention')
            return true;
        const names = this._names(button);
        if (!names.length)
            return false;
        for (const source of this._sources.keys()) {
            if (!source.count)
                continue;
            const sourceNames = [source.title, source.policy?.id]
                .map(normalize)
                .filter(name => name.length >= 4);
            if (names.some(name => sourceNames.some(other => other.includes(name) || name.includes(other))))
                return true;
        }
        return false;
    }

    _updateBadges() {
        if (!this._toggle || !this._icons)
            return;
        const badge = [...this._icons.keys()].some(button => this._isHidden(button) && this._hasUnread(button));
        this._toggle.setBadge(badge);
    }
}
