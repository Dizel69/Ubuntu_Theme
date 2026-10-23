import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const MINIMIZE_EFFECT_NAME = 'minimize-magic-lamp-effect';
const UNMINIMIZE_EFFECT_NAME = 'unminimize-magic-lamp-effect';
const GENIE_DURATION_MS = 520;

function easeInCubic(value) {
    return value ** 3;
}

function easeOutCubic(value) {
    return 1 - (1 - value) ** 3;
}

function genieClosed(amount) {
    return {
        k: Math.min(1, amount * 1.28),
        j: Math.max(0, (amount - 0.22) / 0.78),
    };
}

export default class MacScaleExtension extends Extension {
    enable() {
        const removedMinimize = this._dropSignal('minimize');
        const removedUnminimize = this._dropSignal('unminimize');
        this._replacedShell = removedMinimize > 0 || removedUnminimize > 0;

        this._minimizeId = global.window_manager.connect('minimize', (_wm, actor) => {
            this._play(actor, true);
        });
        this._unminimizeId = global.window_manager.connect('unminimize', (_wm, actor) => {
            this._play(actor, false);
        });
        log(`[mac-scale] genie handlers removed ${removedMinimize}+${removedUnminimize}`);
    }

    _dropSignal(name) {
        const obj = global.window_manager;
        let removed = 0;

        try {
            const signalId = GObject.signal_lookup(name, obj.constructor.$gtype);

            while (signalId && removed < 8) {
                const handler = GObject.signal_handler_find(
                    obj,
                    GObject.SignalMatchType.ID,
                    signalId,
                    null,
                    null,
                    null,
                    null);

                if (!handler)
                    break;

                obj.disconnect(handler);
                removed += 1;
            }
        } catch (error) {
            log(`[mac-scale] could not replace ${name}: ${error}`);
        }

        return removed;
    }

    _play(actor, minimize) {
        const finish = minimize
            ? Main.wm._minimizeWindowDone.bind(Main.wm)
            : Main.wm._unminimizeWindowDone.bind(Main.wm);

        if (!actor || Main.overview.visible) {
            if (minimize)
                global.window_manager.completed_minimize(actor);
            else
                global.window_manager.completed_unminimize(actor);
            return;
        }

        if (!minimize)
            actor.show();

        try {
            actor.remove_all_transitions();
            actor.set_scale(1, 1);
            actor.opacity = 255;
            actor.set_pivot_point(0, 0);

            const icon = this._icon(actor);
            const effectName = minimize ? MINIMIZE_EFFECT_NAME : UNMINIMIZE_EFFECT_NAME;
            const old = actor.get_effect(effectName);

            if (old)
                old.destroy();

            if (minimize)
                Main.wm._minimizing.add(actor);
            else
                Main.wm._unminimizing.add(actor);

            actor.add_effect_with_name(
                effectName,
                minimize
                    ? new GenieMinimizeEffect({icon})
                    : new GenieUnminimizeEffect({icon}));
        } catch (error) {
            log(`[mac-scale] animation failed: ${error}`);
            finish(global.window_manager, actor);
        }
    }

    _icon(actor) {
        const [success, icon] = actor.meta_window.get_icon_geometry();

        if (success)
            return {x: icon.x, y: icon.y, width: icon.width, height: icon.height};

        const monitor = Main.layoutManager.monitors[actor.meta_window.get_monitor()];

        return {
            x: monitor.x + monitor.width / 2,
            y: monitor.y + monitor.height,
            width: 48,
            height: 48,
        };
    }

    disable() {
        if (this._minimizeId) {
            global.window_manager.disconnect(this._minimizeId);
            this._minimizeId = 0;
        }

        if (this._unminimizeId) {
            global.window_manager.disconnect(this._unminimizeId);
            this._unminimizeId = 0;
        }

        global.get_window_actors().forEach(actor => {
            for (const name of [MINIMIZE_EFFECT_NAME, UNMINIMIZE_EFFECT_NAME]) {
                const effect = actor.get_effect(name);

                if (effect)
                    effect.destroy();
            }
        });

        if (this._replacedShell && Main.wm?._minimizeWindow) {
            global.window_manager.connect('minimize', Main.wm._minimizeWindow.bind(Main.wm));
            global.window_manager.connect('unminimize', Main.wm._unminimizeWindow.bind(Main.wm));
            this._replacedShell = false;
        }
    }
}

class GenieEffect extends Clutter.DeformEffect {
    static {
        GObject.registerClass(this);
    }

    _init(params = {}) {
        super._init();
        this.EPSILON = 40;
        this.icon = {
            x: params.icon?.x ?? 0,
            y: params.icon?.y ?? 0,
            width: params.icon?.width ?? 0,
            height: params.icon?.height ?? 0,
        };
        this.k = 0;
        this.j = 0;
        this.x = 0;
        this.y = 0;
        this.offsetX = 0;
        this.offsetY = 0;
        this.width = 0;
        this.height = 0;
        this.expandWidth = 0;
        this.expandHeight = 0;
        this.fullWidth = 0;
        this.fullHeight = 0;
        this.window = {x: 0, y: 0, width: 0, height: 0};
        this.iconMonitor = {x: 0, y: 0, width: 0, height: 0};
        this.monitor = {x: 0, y: 0, width: 0, height: 0};
        this.initialized = false;
        this._loggedFrame = false;
        this.timerId = null;
        this.newFrameEvent = null;
        this.completedEvent = null;
    }

    vfunc_set_actor(actor) {
        super.vfunc_set_actor(actor);

        if (!this.actor || this.initialized)
            return;

        this.initialized = true;
        this.monitor = Main.layoutManager.monitors[actor.meta_window.get_monitor()];
        [this.window.x, this.window.y] = [this.actor.get_x() - this.monitor.x, this.actor.get_y() - this.monitor.y];
        [this.window.width, this.window.height] = actor.get_size();

        if (this.icon.x === 0 && this.icon.y === 0 && this.icon.width === 0 && this.icon.height === 0) {
            this.icon.x = this.monitor.x + this.monitor.width / 2;
            this.icon.y = this.monitor.height + this.monitor.y;
        }

        Main.layoutManager.monitors.forEach(monitor => {
            if (this.icon.x >= monitor.x && this.icon.x <= monitor.x + monitor.width &&
                this.icon.y >= monitor.y && this.icon.y <= monitor.y + monitor.height)
                this.iconMonitor = monitor;
        });

        if (!this.iconMonitor.width)
            this.iconMonitor = this.monitor;

        this.icon.x -= this.monitor.x;
        this.icon.y -= this.monitor.y;

        if (this.icon.y + this.icon.height >= this.monitor.height - this.EPSILON)
            this.iconPosition = St.Side.BOTTOM;
        else if (this.icon.x <= this.EPSILON)
            this.iconPosition = St.Side.LEFT;
        else if (this.icon.x + this.icon.width >= this.monitor.width - this.EPSILON)
            this.iconPosition = St.Side.RIGHT;
        else
            this.iconPosition = St.Side.TOP;

        // Across the window the shape is linear, so a few tiles are enough;
        // the bend runs along the axis towards the dock.
        const towardsHorizontalDock = this.iconPosition === St.Side.BOTTOM || this.iconPosition === St.Side.TOP;
        this.set_n_tiles(towardsHorizontalDock ? 4 : 32, towardsHorizontalDock ? 32 : 4);

        const stage = this.actor.get_stage();
        this.timerId = new Clutter.Timeline({
            actor: this.actor,
            duration: GENIE_DURATION_MS,
            frame_clock: stage?.get_frame_clock?.() ?? null,
        });
        this.newFrameEvent = this.timerId.connect('new-frame', this.on_tick_elapsed.bind(this));
        this.completedEvent = this.timerId.connect('completed', this.destroy.bind(this));
        this.timerId.start();
    }

    on_tick_elapsed(_timer) {}

    destroy() {
        if (this.timerId) {
            if (this.newFrameEvent)
                this.timerId.disconnect(this.newFrameEvent);
            if (this.completedEvent)
                this.timerId.disconnect(this.completedEvent);
            this.timerId = null;
            this.newFrameEvent = null;
            this.completedEvent = null;
        }

        const actor = this.get_actor();

        if (actor) {
            actor.remove_effect(this);
            this.destroy_actor(actor);
        }
    }

    destroy_actor(_actor) {}

    vfunc_deform_vertex(w, h, v) {
        if (!this.initialized || !this.window.width || !this.window.height)
            return;

        const propX = w / this.window.width;
        const propY = h / this.window.height;

        if (this.iconPosition === St.Side.LEFT) {
            this.width = this.window.width - this.icon.width + this.window.x * this.k;
            this.x = (this.width - this.j * this.width) * v.tx;
            this.y = v.ty * this.window.height * (this.x + (this.width - this.x) * (1 - this.k)) / this.width +
                v.ty * this.icon.height * (this.width - this.x) / this.width;
            this.offsetX = this.icon.width - this.window.x * this.k;
            this.offsetY = (this.icon.y - this.window.y) * ((this.width - this.x) / this.width) * this.k;
        } else if (this.iconPosition === St.Side.TOP) {
            this.height = this.window.height - this.icon.height + this.window.y * this.k;
            this.y = (this.height - this.j * this.height) * v.ty;
            this.x = v.tx * this.window.width * (this.y + (this.height - this.y) * (1 - this.k)) / this.height +
                v.tx * this.icon.width * (this.height - this.y) / this.height;
            this.offsetX = (this.icon.x - this.window.x) * ((this.height - this.y) / this.height) * this.k;
            this.offsetY = this.icon.height - this.window.y * this.k;
        } else if (this.iconPosition === St.Side.RIGHT) {
            this.expandWidth = this.iconMonitor.width - this.icon.width - this.window.x - this.window.width;
            this.fullWidth = (this.iconMonitor.width - this.icon.width - this.window.x) - this.expandWidth * (1 - this.k);
            this.width = this.fullWidth - this.j * this.fullWidth;
            this.x = v.tx * this.width;
            this.y = v.ty * this.icon.height +
                v.ty * (this.window.height - this.icon.height) * (1 - this.j) * (1 - v.tx) +
                v.ty * (this.window.height - this.icon.height) * (1 - this.k) * v.tx;
            this.offsetY = (this.icon.y - this.window.y) * (this.x / this.fullWidth) * this.k + (this.icon.y - this.window.y) * this.j;
            this.offsetX = this.iconMonitor.width - this.icon.width - this.window.x - this.width - this.expandWidth * (1 - this.k);
        } else if (this.iconPosition === St.Side.BOTTOM) {
            this.expandHeight = this.iconMonitor.height - this.icon.height - this.window.y - this.window.height;
            this.fullHeight = (this.iconMonitor.height - this.icon.height - this.window.y) - this.expandHeight * (1 - this.k);
            this.height = this.fullHeight - this.j * this.fullHeight;
            this.y = v.ty * this.height;
            this.x = v.tx * this.icon.width +
                v.tx * (this.window.width - this.icon.width) * (1 - this.j) * (1 - v.ty) +
                v.tx * (this.window.width - this.icon.width) * (1 - this.k) * v.ty;
            this.offsetX = (this.icon.x - this.window.x) * (this.y / this.fullHeight) * this.k + (this.icon.x - this.window.x) * this.j;
            this.offsetY = this.iconMonitor.height - this.icon.height - this.window.y - this.height - this.expandHeight * (1 - this.k);
        }

        v.x = (this.x + this.offsetX) * propX;
        v.y = (this.y + this.offsetY) * propY;
    }

    vfunc_modify_paint_volume(_pv) {
        return false;
    }

    _applyClosed(amount) {
        const closed = genieClosed(amount);
        this.k = closed.k;
        this.j = closed.j;
        this.invalidate();
    }
}

class GenieMinimizeEffect extends GenieEffect {
    static {
        GObject.registerClass(this);
    }

    _init(params = {}) {
        super._init(params);
        this.k = 0;
        this.j = 0;
    }

    on_tick_elapsed(timer) {
        this._applyClosed(easeInCubic(timer.get_progress()));
    }

    destroy_actor(actor) {
        Main.wm._minimizeWindowDone(global.window_manager, actor);
    }
}

class GenieUnminimizeEffect extends GenieEffect {
    static {
        GObject.registerClass(this);
    }

    _init(params = {}) {
        super._init(params);
        this.k = 1;
        this.j = 1;
    }

    on_tick_elapsed(timer) {
        this._applyClosed(1 - easeOutCubic(timer.get_progress()));
    }

    destroy_actor(actor) {
        Main.wm._unminimizeWindowDone(global.window_manager, actor);
    }
}
