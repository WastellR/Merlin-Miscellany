// Adds a Merlin tab to the Configure Scene window, for editing the scene flags Merlin uses (flags.merlin.*).
// Flags Merlin writes itself (e.g. altImages) are not editable here.

const CLIMATES = ["standard", "frigid", "jungle"];

// Builds the Merlin scene config sheet from Foundry's scene config class.
// temperatures is the map of temperature presets (id -> { label, alpha }), coolest to hottest.
export function createMerlinSceneConfig(BaseSceneConfig, temperatures) {
  class MerlinSceneConfig extends BaseSceneConfig {
    /** @override */
    static PARTS = (() => {
      // Put our tab before the footer, which has to stay last
      const { footer, ...parts } = super.PARTS;
      return {
        ...parts,
        merlin: { template: "modules/merlins-miscellany/templates/scene-merlin.hbs", scrollable: [""] },
        ...(footer ? { footer } : {})
      };
    })();

    /** @override */
    static TABS = {
      ...super.TABS,
      sheet: {
        ...super.TABS.sheet,
        tabs: [
          ...super.TABS.sheet.tabs,
          { id: "merlin", icon: "fa-solid fa-hat-wizard", label: "Merlin" }
        ]
      }
    };

    /** @override */
    async _preparePartContext(partId, context, options) {
      context = await super._preparePartContext(partId, context, options);
      if (partId === "merlin") this.#prepareMerlinContext(context);
      return context;
    }

    #prepareMerlinContext(context) {
      const flags = this.document.flags?.merlin ?? {};
      const lines = list => (Array.isArray(list) ? list : []).join("\n");

      const packages = game.merlin?._getMerlinSceneData?.().packages ?? [];
      const parentSceneId = flags.parentSceneId ?? "";
      const parentOptions = game.scenes.contents
        .filter(scene => scene.id !== this.document.id)
        .map(scene => {
          const value = scene.flags?.merlin?.stableId || scene.id;
          return { value, label: scene.name, selected: value === parentSceneId || scene.id === parentSceneId };
        });
      // Keep a parent that no longer matches any scene, rather than silently dropping it on save
      if (parentSceneId && !parentOptions.some(option => option.selected)) {
        parentOptions.push({ value: parentSceneId, label: `${parentSceneId} (not found)`, selected: true });
      }

      const defaultClimate = game.merlin?.hexcrawlDefaultClimate ?? "standard";
      const climate = flags.hexcrawlClimate ?? "";

      context.merlin = {
        packages,
        merlinPackageId: flags.merlinPackageId ?? "",
        merlinLevelId: flags.merlinLevelId ?? "",
        merlinCameraId: flags.merlinCameraId ?? "",
        stableId: flags.stableId ?? "",
        parentOptions,
        parentView: flags.parentSceneView ?? {},
        fogMask: flags.fogMask ?? "",
        rain: {
          noRain: lines(flags.rainOverlays?.noRain),
          light: lines(flags.rainOverlays?.light),
          heavy: lines(flags.rainOverlays?.heavy)
        },
        temperatures: Object.entries(temperatures).map(([id, preset]) => {
          const tint = flags.temperatureTints?.[id];
          const tintObject = typeof tint === "string" ? { color: tint } : tint;
          return {
            id,
            label: preset.label,
            tintEnabled: !!tintObject?.color,
            color: tintObject?.color ?? "#ffffff",
            alpha: tintObject?.alpha ?? preset.alpha,
            overlays: lines([].concat(flags.temperatureOverlays?.[id] ?? []))
          };
        }),
        hexcrawl: flags.hexcrawl === true,
        climateOptions: [
          { value: "", label: `Default (${defaultClimate})`, selected: climate === "" },
          ...CLIMATES.map(value => ({ value, label: value.replace(/\b\w/g, char => char.toUpperCase()), selected: climate === value }))
        ],
        hexcrawlTerrain: flags.hexcrawlTerrain ?? ""
      };
    }

    // This has to happen here rather than in _processSubmitData: before that, Foundry validates and cleans the submitted
    // data against the scene schema, which would strip our form's values for not being part of it
    /** @override */
    _processFormData(event, form, formData) {
      const submitData = super._processFormData(event, form, formData);
      const input = submitData.merlinScene;
      if (input) {
        delete submitData.merlinScene;
        submitData.flags ??= {};
        submitData.flags.merlin = { ...submitData.flags.merlin, ...this.#buildFlagUpdates(input) };
      }
      return submitData;
    }

    // Turns the form's values into a flags.merlin update, removing any flag that has been cleared
    #buildFlagUpdates(input) {
      const flags = {};
      const text = value => String(value ?? "").trim();
      const lines = value => text(value).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const set = (key, value, empty) => {
        if (empty) flags[`-=${key}`] = null;
        else flags[key] = value;
      };

      for (const key of ["merlinPackageId", "merlinLevelId", "merlinCameraId", "stableId", "parentSceneId", "fogMask", "hexcrawlTerrain", "hexcrawlClimate"]) {
        set(key, text(input[key]), !text(input[key]));
      }
      set("hexcrawl", true, !input.hexcrawl);

      // The view to return to in the parent scene, which needs all three values
      const view = input.parentSceneView ?? {};
      const hasView = ["x", "y", "scale"].some(key => text(view[key]) !== "");
      set("parentSceneView", {
        x: Number(view.x) || 0,
        y: Number(view.y) || 0,
        scale: Number(view.scale) || 1
      }, !hasView);

      // Rain overlays are always saved with all three sets, as the whole object is read as one
      const rain = {
        noRain: lines(input.rain?.noRain),
        light: lines(input.rain?.light),
        heavy: lines(input.rain?.heavy)
      };
      set("rainOverlays", rain, !rain.noRain.length && !rain.light.length && !rain.heavy.length);

      const tints = {};
      const overlays = {};
      for (const id of Object.keys(temperatures)) {
        const preset = input.temperature?.[id] ?? {};
        if (preset.tint && text(preset.color)) {
          const alpha = Number(preset.alpha);
          tints[id] = { color: text(preset.color), alpha: Number.isFinite(alpha) ? Math.clamp(alpha, 0, 1) : temperatures[id].alpha };
        } else {
          tints[`-=${id}`] = null;
        }
        const files = lines(preset.overlays);
        if (files.length) overlays[id] = files;
        else overlays[`-=${id}`] = null;
      }
      const hasTints = Object.keys(tints).some(key => !key.startsWith("-="));
      const hasOverlays = Object.keys(overlays).some(key => !key.startsWith("-="));
      set("temperatureTints", tints, !hasTints);
      set("temperatureOverlays", overlays, !hasOverlays);

      return flags;
    }
  }

  Object.defineProperty(MerlinSceneConfig, "name", { value: "MerlinSceneConfig" });
  return MerlinSceneConfig;
}
