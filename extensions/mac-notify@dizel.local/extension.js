import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class MacNotifyExtension extends Extension {
    enable() {
        this._previousAlignment = Main.messageTray.bannerAlignment;
        Main.messageTray.bannerAlignment = Clutter.ActorAlign.END;
    }

    disable() {
        Main.messageTray.bannerAlignment = this._previousAlignment ?? Clutter.ActorAlign.CENTER;
        this._previousAlignment = null;
    }
}
