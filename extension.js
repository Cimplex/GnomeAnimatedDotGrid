import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const FPS = 24;
const BASE_OPACITY = 0.10;
const GLOW_OPACITY = 0.16;
const MAX_CIRCLES = 12;

function colorFromHex(value) {
    const match = /^#([0-9a-f]{6})$/i.exec(value);
    if (!match)
        return [0, 0, 0];

    const number = Number.parseInt(match[1], 16);
    return [
        ((number >> 16) & 0xff) / 255,
        ((number >> 8) & 0xff) / 255,
        (number & 0xff) / 255,
    ];
}

const DECLARATIONS = `
uniform vec2 resolution;
uniform float elapsed;
uniform float spacing;
uniform float radius;
uniform vec3 dotColor;
uniform vec3 backgroundColor;
uniform float baseOpacity;
uniform float glowOpacity;
uniform float circleSize;
uniform float circleDirection;
uniform float circleCount;
uniform float circleBlur;
uniform float circleSpeed;
uniform float randomDirection;
uniform float debugLayer;
`;

const FRAGMENT_CODE = `
vec2 pixel = cogl_tex_coord0_in.xy * resolution;
vec2 cell = mod(pixel + spacing * 0.5, spacing) - spacing * 0.5;

// Keep dots crisp at fractional display scaling without expensive multisampling.
float dotMask = 1.0 - smoothstep(radius - 0.65, radius + 0.65, length(cell));

float glow = 0.0;
for (int i = 0; i < ${MAX_CIRCLES}; i++) {
    if (float(i) >= circleCount)
        break;

    float seed = float(i) + 1.0;
    vec2 start = fract(vec2(sin(seed * 91.17), sin(seed * 47.63)) * 43758.5453);
    float randomAngle = fract(sin(seed * 12.9898) * 43758.5453) * 6.2831853;
    float angle = mix(radians(circleDirection), randomAngle, randomDirection);
    vec2 direction = vec2(cos(angle), sin(angle));
    vec2 center = fract(start + direction * elapsed * circleSpeed / resolution) * resolution;

    // Measure across wrapped edges so circles enter and leave without popping.
    vec2 delta = abs(pixel - center);
    delta = min(delta, resolution - delta);
    float circle = 1.0 - smoothstep(circleSize, circleSize + circleBlur, length(delta));
    glow = max(glow, circle);
}

float dotAlpha = dotMask * (baseOpacity + glowOpacity * glow);
vec3 color = mix(backgroundColor, dotColor, dotAlpha);
// A red top-left marker makes the persistent shader easy to identify in a
// frame-by-frame recording.
if (debugLayer > 0.5 && pixel.x < 64.0 && pixel.y < 64.0)
    color = debugLayer < 1.5 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
cogl_color_out = vec4(color, 1.0);
`;

const DotGridEffect = GObject.registerClass(
class DotGridEffect extends Shell.GLSLEffect {
    _uniforms = null;

    vfunc_build_pipeline() {
        this.add_glsl_snippet(
            Cogl.SnippetHook.FRAGMENT,
            DECLARATIONS,
            FRAGMENT_CODE,
            false
        );
    }

    _ensureUniforms() {
        if (this._uniforms)
            return;

        this._uniforms = {
            resolution: this.get_uniform_location('resolution'),
            elapsed: this.get_uniform_location('elapsed'),
            spacing: this.get_uniform_location('spacing'),
            radius: this.get_uniform_location('radius'),
            dotColor: this.get_uniform_location('dotColor'),
            backgroundColor: this.get_uniform_location('backgroundColor'),
            baseOpacity: this.get_uniform_location('baseOpacity'),
            glowOpacity: this.get_uniform_location('glowOpacity'),
            circleSize: this.get_uniform_location('circleSize'),
            circleDirection: this.get_uniform_location('circleDirection'),
            circleCount: this.get_uniform_location('circleCount'),
            circleBlur: this.get_uniform_location('circleBlur'),
            circleSpeed: this.get_uniform_location('circleSpeed'),
            randomDirection: this.get_uniform_location('randomDirection'),
            debugLayer: this.get_uniform_location('debugLayer'),
        };
    }

    update(width, height, elapsed, options) {
        this._ensureUniforms();
        const u = this._uniforms;

        this.set_uniform_float(u.resolution, 2, [width, height]);
        this.set_uniform_float(u.elapsed, 1, [elapsed]);
        this.set_uniform_float(u.spacing, 1, [options.dotSpacing]);
        this.set_uniform_float(u.radius, 1, [options.dotSize / 2]);
        this.set_uniform_float(u.dotColor, 3, options.dotColor);
        this.set_uniform_float(u.backgroundColor, 3, options.backgroundColor);
        this.set_uniform_float(u.baseOpacity, 1, [BASE_OPACITY]);
        this.set_uniform_float(u.glowOpacity, 1, [GLOW_OPACITY]);
        this.set_uniform_float(u.circleSize, 1, [options.circleSize / 2]);
        this.set_uniform_float(u.circleDirection, 1, [options.circleDirection]);
        this.set_uniform_float(u.circleCount, 1, [options.circleCount]);
        this.set_uniform_float(u.circleBlur, 1, [options.circleBlur]);
        this.set_uniform_float(u.circleSpeed, 1, [options.circleSpeed]);
        this.set_uniform_float(u.randomDirection, 1, [options.randomDirection ? 1 : 0]);
        this.set_uniform_float(u.debugLayer, 1, [options.debugLayer ?? 0]);
        this.queue_repaint();
    }
});

export default class AnimatedDotGridExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._settingsChangedId = this._settings.connect('changed', () => {
            this._syncOverview();
            this._tick();
        });
        this._actors = [];
        this._workspaceBackgrounds = new Map();
        this._overviewFrames = new Map();
        this._workspaceAnimationActors = new Map();
        this._overviewGroupOriginalStyle =
            Main.layoutManager.overviewGroup.get_style();
        this._timerId = 0;
        this._startedAt = GLib.get_monotonic_time();
        this._shellBackgroundOriginalOpacity =
            Main.layoutManager._backgroundGroup.opacity;
        Main.layoutManager._backgroundGroup.opacity = 0;
        this._monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed', () => this._rebuildActors()
        );
        this._uiGroupChildAddedId = Main.uiGroup.connect(
            'child-added', (_group, actor) =>
                this._syncWorkspaceAnimation(actor)
        );
        this._overviewShowingId = Main.overview.connect(
            'showing', () => {
                this._debugLog('overview showing');
                this._syncOverview();
            }
        );
        this._overviewHidingId = Main.overview.connect(
            'hiding', () => {
                this._debugLog('overview hiding');
                if (this._workspaceAnimationActors.size === 0)
                    this._restackActors();
                this._tick();
            }
        );
        this._overviewHiddenId = Main.overview.connect(
            'hidden', () => {
                this._debugLog('overview hidden');
                if (this._workspaceAnimationActors.size === 0)
                    this._restackActors();
            }
        );
        // Gesture updates and Shell actor creation run independently of our
        // 24 FPS shader timer. Suppress preview surfaces after those updates,
        // before every paint, including the final overview closing frames.
        this._beforePaintId = global.stage.connect('before-paint', () => {
            if (Main.layoutManager.overviewGroup.visible &&
                this._settings.get_boolean('apply-to-overview'))
                this._updateWorkspaceBackgrounds();
        });

        this._rebuildActors();
        this._syncOverview();
        this._timerId = GLib.timeout_add(
            GLib.PRIORITY_LOW,
            Math.round(1000 / FPS),
            () => this._tick()
        );
        GLib.Source.set_name_by_id(this._timerId, '[animated-dot-grid] animation');
    }

    disable() {
        if (this._beforePaintId) {
            global.stage.disconnect(this._beforePaintId);
            this._beforePaintId = 0;
        }

        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }

        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }

        if (this._uiGroupChildAddedId) {
            Main.uiGroup.disconnect(this._uiGroupChildAddedId);
            this._uiGroupChildAddedId = 0;
        }

        if (this._overviewShowingId) {
            Main.overview.disconnect(this._overviewShowingId);
            this._overviewShowingId = 0;
        }

        if (this._overviewHidingId) {
            Main.overview.disconnect(this._overviewHidingId);
            this._overviewHidingId = 0;
        }

        if (this._overviewHiddenId) {
            Main.overview.disconnect(this._overviewHiddenId);
            this._overviewHiddenId = 0;
        }

        this._destroyOverview();
        Main.layoutManager.overviewGroup.set_style(
            this._overviewGroupOriginalStyle);
        this._overviewGroupOriginalStyle = null;
        this._restoreWorkspaceAnimations();
        this._destroyActors();
        if (this._shellBackgroundOriginalOpacity !== null) {
            Main.layoutManager._backgroundGroup.opacity =
                this._shellBackgroundOriginalOpacity;
            this._shellBackgroundOriginalOpacity = null;
        }
        this._startedAt = 0;
        this._settings = null;
    }

    _rebuildActors() {
        this._destroyActors();

        for (const monitor of Main.layoutManager.monitors) {
            // A painted widget gives the offscreen GLSL effect an input texture.
            // Use CSS here: Clutter.Color is no longer constructible in Shell 50.
            const actor = new St.Widget({
                x: monitor.x,
                y: monitor.y,
                width: monitor.width,
                height: monitor.height,
                reactive: false,
                style: 'background-color: black;',
            });
            const effect = new DotGridEffect();
            actor.add_effect(effect);

            // Keep one permanent shader outside both the wallpaper and window
            // hierarchies. Shell is then free to animate workspaces without
            // treating this actor as either a background or a window.
            global.stage.add_child(actor);
            global.stage.set_child_below_sibling(actor, Main.uiGroup);
            this._actors.push({actor, effect});
        }

        this._tick();
    }

    _destroyActors() {
        for (const {actor} of this._actors ?? [])
            actor.destroy();
        this._actors = [];
    }

    _restackActors() {
        for (const {actor} of this._actors ?? []) {
            if (actor.get_parent() !== global.stage) {
                actor.get_parent()?.remove_child(actor);
                global.stage.add_child(actor);
            }
            global.stage.set_child_below_sibling(actor, Main.uiGroup);
        }
    }

    _stackActorsForWorkspaceAnimation() {
        for (const {actor} of this._actors ?? []) {
            if (actor.get_parent() !== Main.uiGroup) {
                actor.get_parent()?.remove_child(actor);
                Main.uiGroup.add_child(actor);
            }

            // Cover the real windows, which remain in window_group, while
            // keeping Shell's moving window clones above the grid.
            Main.uiGroup.set_child_above_sibling(actor, global.window_group);
        }
    }

    _syncOverview() {
        const enabled = this._settings?.get_boolean('apply-to-overview') ?? false;
        if (!enabled) {
            this._destroyOverview();
            Main.layoutManager.overviewGroup.set_style(
                this._overviewGroupOriginalStyle);
            if (this._workspaceAnimationActors.size === 0)
                this._restackActors();
            return;
        }

        Main.layoutManager.overviewGroup.set_style(
            'background-color: transparent; transition-duration: 0ms;');
        this._updateWorkspaceBackgrounds();
    }

    _walkActors(actor, callback) {
        callback(actor);
        for (const child of actor.get_children?.() ?? [])
            this._walkActors(child, callback);
    }

    _updateWorkspaceBackgrounds() {
        this._walkActors(Main.layoutManager.overviewGroup, actor => {
            if (!(actor instanceof Shell.WorkspaceBackground))
                return;

            const workspaceActor = actor.get_parent();
            if (workspaceActor?.has_style_class_name?.('window-picker'))
                this._hideOverviewFrame(workspaceActor);

            // Shell.WorkspaceBackground uses private, state-dependent content
            // geometry that ordinary extension actors cannot reproduce. Hide
            // it as a unit and let the overview shader be the one continuous
            // background behind workspace windows and the app grid.
            this._hideTrackedBackground(actor);
        });
    }

    _hideOverviewFrame(actor) {
        if (!this._overviewFrames.has(actor)) {
            const entry = {
                originalStyle: actor.get_style(),
                destroyId: 0,
            };
            entry.destroyId = actor.connect('destroy', () => {
                this._overviewFrames.delete(actor);
            });
            this._overviewFrames.set(actor, entry);
        }

        // Skin extensions may use a selector more specific than our CSS.
        // An inline style reliably removes the large Workspace surface while
        // leaving its window-preview container and top thumbnails untouched.
        const style =
            'background-color: transparent; background-image: none; ' +
            'border: none; box-shadow: none; transition-duration: 0ms;';
        if (actor.get_style() !== style)
            actor.set_style(style);
    }

    _syncWorkspaceAnimation(root = Main.uiGroup) {
        this._walkActors(root, actor => {
            if (actor.has_style_class_name?.('workspace-animation'))
                this._makeWorkspaceAnimationTransparent(actor);

            if (!(actor instanceof Meta.BackgroundGroup))
                return;

            // The normal desktop background group is already hidden in
            // enable(). Workspace switching creates additional background
            // groups inside its temporary MonitorGroup actors, above our
            // stage shader. Hide those copies while retaining window clones.
            if (actor === Main.layoutManager._backgroundGroup ||
                !this._isInsideWorkspaceAnimation(actor))
                return;

            this._hideTrackedBackground(actor);
        });
    }

    _makeWorkspaceAnimationTransparent(actor) {
        if (!this._workspaceAnimationActors.has(actor)) {
            const entry = {
                originalStyle: actor.get_style(),
                destroyId: 0,
            };
            entry.destroyId = actor.connect('destroy', () => {
                this._workspaceAnimationActors.delete(actor);
                if (this._workspaceAnimationActors.size === 0)
                    this._restackActors();
            });
            this._workspaceAnimationActors.set(actor, entry);
        }

        // GNOME Shell themes give .workspace-animation an opaque fallback
        // color. Once its copied wallpapers are hidden, that fallback would
        // otherwise cover the persistent shader with a solid gray rectangle.
        actor.set_style('background-color: transparent;');
        this._stackActorsForWorkspaceAnimation();
    }

    _restoreWorkspaceAnimations() {
        for (const [actor, entry] of this._workspaceAnimationActors ?? []) {
            actor.disconnect(entry.destroyId);
            actor.set_style(entry.originalStyle);
        }
        this._workspaceAnimationActors?.clear();
        this._restackActors();
    }

    _isInsideWorkspaceAnimation(actor) {
        for (let parent = actor.get_parent(); parent; parent = parent.get_parent()) {
            if (parent.has_style_class_name?.('workspace-animation'))
                return true;
        }

        return false;
    }

    _hideTrackedBackground(actor) {
        if (!this._workspaceBackgrounds.has(actor)) {
            const entry = {
                originalOpacity: actor.opacity,
                destroyId: 0,
            };
            entry.destroyId = actor.connect('destroy', () => {
                this._workspaceBackgrounds.delete(actor);
            });
            this._workspaceBackgrounds.set(actor, entry);
        }

        actor.opacity = 0;
    }

    _debugLog(message) {
        if (!this._settings?.get_boolean('debug-transitions'))
            return;

        const desktop = this._actors?.map(({actor}) =>
            `${actor.visible ? 'v' : '-'}${actor.mapped ? 'm' : '-'}`).join(',') ?? '';
        console.log(
            `[animated-dot-grid][transition] ${message}; ` +
            `overviewVisible=${Main.overview.visible}; shader=${desktop}`
        );
    }

    _destroyOverview() {
        for (const [actor, entry] of this._workspaceBackgrounds ?? []) {
            actor.disconnect(entry.destroyId);
            actor.opacity = entry.originalOpacity;
        }
        this._workspaceBackgrounds?.clear();

        for (const [actor, entry] of this._overviewFrames ?? []) {
            actor.disconnect(entry.destroyId);
            actor.set_style(entry.originalStyle);
        }
        this._overviewFrames?.clear();

    }

    _tick() {
        const elapsed = (GLib.get_monotonic_time() - this._startedAt) / 1_000_000;
        const options = {
            dotColor: colorFromHex(this._settings.get_string('dot-color')),
            dotSpacing: this._settings.get_double('dot-spacing'),
            dotSize: this._settings.get_double('dot-size'),
            circleSize: this._settings.get_double('circle-size'),
            circleDirection: this._settings.get_double('circle-direction'),
            randomDirection: this._settings.get_boolean('random-direction'),
            circleCount: this._settings.get_int('circle-count'),
            circleBlur: this._settings.get_double('circle-blur'),
            circleSpeed: this._settings.get_double('circle-speed'),
            backgroundColor: colorFromHex(this._settings.get_string('background-color')),
            debugLayer: this._settings.get_boolean('debug-transitions') ? 1 : 0,
        };

        for (const {actor, effect} of this._actors) {
            if (actor.visible && actor.width > 0 && actor.height > 0)
                effect.update(actor.width, actor.height, elapsed, options);
        }

        this._syncWorkspaceAnimation();

        return GLib.SOURCE_CONTINUE;
    }
}

