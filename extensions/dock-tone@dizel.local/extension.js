import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const DOCK_SCHEMA = 'org.gnome.shell.extensions.dash-to-dock';
const BLUR_SCHEMA = 'org.gnome.shell.extensions.blur-my-shell.dash-to-dock';
const DEFAULT_COLOR = '#1c1c1e';
// Every pick_color() reads pixels back from the GPU, so keep them rare.
const POLL_MS = 1000;
// Inside one window a new tone must hold this many polls in a row.
const CONFIRM_POLLS = 2;
const SAME_TONE = 28;

function channel(value) {
    if (typeof value !== 'number' || Number.isNaN(value))
        return 0;
    // pick_color() returns 0–255. A component of 1 is almost black, not white.
    return Math.max(0, Math.min(255, Math.round(value)));
}

function hexByte(value) {
    return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
}

function median(values) {
    const sorted = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
    if (!sorted.length)
        return 0;
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2)
        return sorted[middle];
    return (sorted[middle - 1] + sorted[middle]) / 2;
}

function colorDistance(a, b) {
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

function toHex(rgb) {
    return `#${hexByte(rgb[0])}${hexByte(rgb[1])}${hexByte(rgb[2])}`;
}

export default class DockToneExtension extends Extension {
    enable() {
        this._dockSettings = new Gio.Settings({schema_id: DOCK_SCHEMA});
        this._blurSettings = this._blurSettingsFromDirectory();
        this._keepPill();

        try {
            Gio._promisify(Shell.Screenshot.prototype, 'pick_color');
        } catch (error) {
            // Already promisified by the shell.
        }

        this._shot = new Shell.Screenshot();
        this._strips = [];
        this._busy = false;
        this._pending = false;
        this._idle = 0;
        this._followUps = [];
        this._placeBars();

        this._focusId = global.display.connect('notify::focus-window', () => this._onFocus());
        this._restackId = global.display.connect('restacked', () => this._schedule());
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._placeBars());
        this._overviewShowingId = Main.overview.connect('showing', () => this._hideBars());
        this._overviewHiddenId = Main.overview.connect('hidden', () => {
            this._placeBars();
            this._onFocus();
        });
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => {
            this._placeBars();
            this._schedule();
            return GLib.SOURCE_CONTINUE;
        });
        this._schedule();
        console.warn('[dock-tone] strip per monitor, tone from the window top');
    }

    disable() {
        for (const [object, id] of [
            [global.display, this._focusId],
            [global.display, this._restackId],
            [Main.layoutManager, this._monitorsId],
            [Main.overview, this._overviewShowingId],
            [Main.overview, this._overviewHiddenId],
        ]) {
            if (id)
                object.disconnect(id);
        }
        this._focusId = this._restackId = this._monitorsId = 0;
        this._overviewShowingId = this._overviewHiddenId = 0;

        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = 0;
        }
        for (const id of this._followUps ?? [])
            GLib.source_remove(id);
        this._followUps = [];
        if (this._idle) {
            GLib.source_remove(this._idle);
            this._idle = 0;
        }
        this._destroyBars();
        this._shot = null;
        this._dockSettings = null;
        this._blurSettings = null;
    }

    _keepPill() {
        // The icon pill keeps its own frost and hover magnification.
        // Static blur samples the wallpaper, not the margin bar painted above it.
        this._dockSettings.set_boolean('custom-background-color', false);
        this._dockSettings.set_double('background-opacity', 0.12);
        this._blurSettings?.set_boolean('blur', true);
        this._blurSettings?.set_boolean('static-blur', true);
    }

    _destroyBars() {
        for (const strip of this._strips ?? [])
            strip.bar.destroy();
        this._strips = [];
    }

    _hideBars() {
        for (const strip of this._strips)
            strip.bar.hide();
    }

    _placeBars() {
        const monitors = Main.layoutManager.monitors;
        if (this._strips.length !== monitors.length) {
            this._destroyBars();
            for (let index = 0; index < monitors.length; index++) {
                const bar = new St.Widget({
                    name: 'dock-tone-margin',
                    reactive: false,
                    style: `background-color: ${DEFAULT_COLOR};`,
                });
                Main.layoutManager._backgroundGroup.add_child(bar);
                this._strips.push({
                    bar,
                    index,
                    color: DEFAULT_COLOR,
                    rgb: null,
                    window: null,
                    candidate: null,
                    candidateCount: 0,
                });
            }
        }

        const group = Main.layoutManager._backgroundGroup;
        for (const strip of this._strips) {
            const monitor = monitors[strip.index];
            if (!monitor)
                continue;
            const area = Main.layoutManager.getWorkAreaForMonitor(strip.index);
            const top = area.y + area.height;
            const height = Math.max(0, monitor.y + monitor.height - top);
            strip.bar.set_position(monitor.x, top);
            strip.bar.set_size(monitor.width, height);
            if (strip.bar.get_parent() === group)
                group.set_child_above_sibling(strip.bar, null);
            if (height < 4 || Main.overview.visible)
                strip.bar.hide();
            else
                strip.bar.show();
        }
    }

    _onFocus() {
        this._schedule();
        for (const id of this._followUps)
            GLib.source_remove(id);
        this._followUps = [];
        // The new window may still be painting its first frames.
        for (const delay of [60, 160, 320]) {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                this._followUps = this._followUps.filter(item => item !== id);
                this._schedule();
                return GLib.SOURCE_REMOVE;
            });
            this._followUps.push(id);
        }
    }

    _schedule() {
        if (this._busy) {
            this._pending = true;
            return;
        }
        if (this._idle)
            return;

        this._idle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idle = 0;
            this._sampleAll().catch(error => {
                console.warn(`[dock-tone] ${error?.message ?? error}`);
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _blurSettingsFromDirectory() {
        try {
            const directory = Gio.File.new_for_path(
                `${GLib.get_home_dir()}/.local/share/gnome-shell/extensions/blur-my-shell@aunetx/schemas`
            );
            const source = Gio.SettingsSchemaSource.new_from_directory(
                directory.get_path(),
                Gio.SettingsSchemaSource.get_default(),
                false
            );
            const schema = source.lookup(BLUR_SCHEMA, true);
            return schema ? new Gio.Settings({settings_schema: schema}) : null;
        } catch (error) {
            console.warn(`[dock-tone] blur settings unavailable: ${error?.message ?? error}`);
            return null;
        }
    }

    _isContentWindow(win) {
        try {
            if (win.minimized || win.is_hidden?.())
                return false;
            const type = win.get_window_type();
            if (type !== Meta.WindowType.NORMAL && type !== Meta.WindowType.DIALOG)
                return false;
            const title = `${win.get_title?.() ?? ''}`.toLowerCase();
            return !title.includes('desktop icons');
        } catch (error) {
            return false;
        }
    }

    // The window on top of this monitor, focused or not.
    _windowForMonitor(index) {
        const workspace = global.workspace_manager.get_active_workspace();
        const focus = global.display.get_focus_window?.() ?? global.display.focus_window;
        if (focus && focus.get_monitor() === index && this._isContentWindow(focus))
            return focus;

        const windows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, workspace);
        return windows.find(win => win.get_monitor() === index && this._isContentWindow(win)) ?? null;
    }

    // The toolbar and page header at the top of a window stay put while the
    // content scrolls, unlike pictures and video in the middle.
    _samplePoints(strip) {
        const monitor = Main.layoutManager.monitors[strip.index];
        if (!monitor)
            return [];

        const inside = (x, y) =>
            x >= monitor.x && x < monitor.x + monitor.width &&
            y >= monitor.y && y < monitor.y + monitor.height;

        const win = strip.window;
        let rect = null;
        try {
            rect = win?.get_frame_rect() ?? null;
        } catch (error) {
            rect = null;
        }

        const points = [];
        if (rect && rect.width > 80 && rect.height > 80) {
            const xs = [0.25, 0.5, 0.75];
            const ys = [14, 40].map(offset => Math.min(rect.y + offset, rect.y + rect.height / 3));
            for (const y of ys) {
                for (const fraction of xs)
                    points.push([rect.x + rect.width * fraction, y]);
            }
        } else {
            const area = Main.layoutManager.getWorkAreaForMonitor(strip.index);
            for (const yFraction of [0.4, 0.65]) {
                for (const xFraction of [0.3, 0.5, 0.7])
                    points.push([area.x + area.width * xFraction, area.y + area.height * yFraction]);
            }
        }
        return points.filter(([x, y]) => inside(x, y) && !this._pointOnBar(strip, x, y));
    }

    _pointOnBar(strip, x, y) {
        const bar = strip.bar;
        if (!bar.get_parent())
            return false;
        const [barX, barY] = bar.get_transformed_position();
        return x >= barX && x <= barX + bar.width && y >= barY && y <= barY + bar.height;
    }

    _windowsAnimating() {
        return (Main.wm._minimizing?.size ?? 0) > 0 ||
            (Main.wm._unminimizing?.size ?? 0) > 0 ||
            (Main.wm._mapping?.size ?? 0) > 0 ||
            (Main.wm._destroying?.size ?? 0) > 0;
    }

    async _sampleAll() {
        if (this._busy || Main.overview.visible || !this._shot)
            return;

        // A pixel readback in the middle of an animation drops frames.
        if (this._windowsAnimating()) {
            this._pending = true;
            return;
        }

        this._tick = (this._tick ?? 0) + 1;
        this._busy = true;
        try {
            for (const strip of this._strips) {
                // eslint-disable-next-line no-await-in-loop
                await this._sampleStrip(strip);
            }
        } finally {
            this._busy = false;
            if (this._pending) {
                this._pending = false;
                this._schedule();
            }
        }
    }

    async _sampleStrip(strip) {
        if (!this._shot || !strip.bar.visible)
            return;

        const win = this._windowForMonitor(strip.index);
        const switched = win !== strip.window;
        strip.window = win;

        // A tone that has held for a while gets checked every third poll.
        if (!switched && (strip.stableTicks ?? 0) >= 4 && this._tick % 3 !== 0)
            return;

        const reds = [];
        const greens = [];
        const blues = [];
        for (const [x, y] of this._samplePoints(strip)) {
            // eslint-disable-next-line no-await-in-loop
            const [color] = await this._shot.pick_color(Math.round(x), Math.round(y));
            if (!color)
                continue;
            reds.push(channel(color.red));
            greens.push(channel(color.green));
            blues.push(channel(color.blue));
        }

        if (reds.length < 3)
            return;

        const rgb = [median(reds), median(greens), median(blues)];

        if (switched || !strip.rgb) {
            // Another window took this monitor: follow it right away.
            strip.candidate = null;
            strip.candidateCount = 0;
            strip.stableTicks = 0;
            this._apply(strip, rgb);
            return;
        }

        if (colorDistance(rgb, strip.rgb) < SAME_TONE) {
            strip.candidate = null;
            strip.candidateCount = 0;
            strip.stableTicks = (strip.stableTicks ?? 0) + 1;
            return;
        }
        strip.stableTicks = 0;

        if (strip.candidate && colorDistance(rgb, strip.candidate) < SAME_TONE) {
            strip.candidateCount += 1;
        } else {
            strip.candidate = rgb;
            strip.candidateCount = 1;
        }

        if (strip.candidateCount >= CONFIRM_POLLS) {
            this._apply(strip, strip.candidate);
            strip.candidate = null;
            strip.candidateCount = 0;
        }
    }

    _apply(strip, rgb) {
        strip.rgb = rgb;
        const next = toHex(rgb);
        if (next === strip.color)
            return;
        strip.color = next;
        strip.bar.style = `background-color: ${next};`;
    }
}
