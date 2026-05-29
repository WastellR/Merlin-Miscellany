/**
 * Light Watcher Module
 * - Adds flags to AmbientLight config
 * - Watches lights for toggles
 * - Runs custom code + toggles tiles
 */

const WithActiveLightConfig = (LightConfig) => {
  class ActiveLightConfig extends LightConfig {
    
    /** @override */
    // Use our custom HTML instead
    static PARTS = {
      ...super.PARTS,
      advanced: {
        template: "modules/merlins-miscellany/templates/active-light-advanced.hbs"
      }
    };
    
    /** @override */
    async _updateObject(event, formData) {
      // Extract our custom fields
      const runCode = formData["flags.merlin.runCode"] || "";
      const switchTiles = formData["flags.merlin.switchTiles"] || "";

      // Clean so they don’t cause duplicate HTML inputs
      delete formData["flags.merlin.runCode"];
      delete formData["flags.merlin.switchTiles"];

      // Update the document with remaining formData
      await super._updateObject(event, formData);

      // Write our flags explicitly
      await this.document.setFlag("merlin", "runCode", runCode);
      await this.document.setFlag("merlin", "switchTiles", switchTiles);
    }

    /** @override */
    getData(options) {
      const data = super.getData(options);
      data.flags = foundry.utils.mergeObject(data.flags ?? {}, {
        "merlin": {
          runCode: this.document.getFlag("merlin", "runCode") ?? "",
          switchTiles: this.document.getFlag("merlin", "switchTiles") ?? ""
        }
      });
      return data;
    }

    /** @override */
    activateListeners(html) {
      super.activateListeners(html);
      // nothing fancy yet
    }

    /** @override */
    _getSubmitData(updateData={}) {
      const data = super._getSubmitData(updateData);
      return data;
    }
   
  }

  const constructorName = "ActiveLightConfig";
  Object.defineProperty(ActiveLightConfig.prototype.constructor, "name", { value: constructorName });
  return ActiveLightConfig;
};

class Merlin{

  constructor() {
    Hooks.on("ready", this._onReady.bind(this));
    Hooks.on("canvasReady", this._onCanvasReady.bind(this));
    Hooks.on("updateAmbientLight", this._onUpdateLight.bind(this));
    Hooks.on("controlToken", this._onControlToken.bind(this));
    Hooks.on("updateToken", this._onUpdateToken.bind(this));
    Hooks.on("getSceneControlButtons", this._getSceneControlButtons.bind(this));
  }

  usersUseMerlinVideo = {};
  // Map of tile teleportIdentifiers to tile IDs for tiles with teleport OUT enabled. An identifier can be linked to multiple tiles.
  teleportTileIds = {};
  
  // The scene control (left-side control buttons) that was previously active
  prevActiveControl = "";
  async _onReady() {
    console.log("Merlin Module | Ready");

    // Extend ambient light sheet class with our custom class
    CONFIG.AmbientLight.sheetClasses.base['core.AmbientLightConfig'].cls = WithActiveLightConfig(CONFIG.AmbientLight.sheetClasses.base['core.AmbientLightConfig'].cls);

    const oldSheetClass = CONFIG.Tile.sheetClasses.base['core.TileConfig'].cls;

    // Declare our custom TileConfig class
    class MerlinTileConfig extends oldSheetClass {
        static #MERLIN_TRIGGERS = ["enter", "exit", "stop within"];

        /** @override */
        // Use our custom HTML instead
        static PARTS = {
          ...super.PARTS,
          appearance: { template: "modules/merlins-miscellany/templates/appearance.hbs" },
          merlin: { template: "modules/merlins-miscellany/templates/merlin.hbs" }
        };

        /** @override */
        static TABS = {
          sheet: {
            tabs: [
              { id: "position", icon: "fa-solid fa-location-dot", label: "TILE.TABS.position" },
              { id: "appearance", icon: "fa-solid fa-image", label: "TILE.TABS.appearance" },
              { id: "overhead", icon: "fa-solid fa-house", label: "TILE.TABS.overhead" },
              { id: "merlin", icon: "fa-solid fa-hat-wizard", label: "Merlin" }
            ],
            initial: "position"
          }
        };

        async _processSubmitData(event, form, submitData, options = {}) {
          const merlinFlags = foundry.utils.getProperty(submitData, "flags.merlin") ?? {};

          // Update identifier map if teleportIdentifier changed
          if(merlinFlags.teleportIdentifier !== merlinFlags.teleportIdentifierPrev){
            // Remove the old identifier from the map
            if(merlinFlags.teleportIdentifierPrev){
              const tileIds = game.merlin.teleportTileIds[merlinFlags.teleportIdentifierPrev];
              if(tileIds){
                const index = tileIds.indexOf(this.document.id);
                if(index > -1){
                  tileIds.splice(index, 1);
                }
              }
            }
            // Add the new identifier to the map
            if(merlinFlags.teleportIdentifier && merlinFlags.teleportOut){
              if(!game.merlin.teleportTileIds[merlinFlags.teleportIdentifier]){
                game.merlin.teleportTileIds[merlinFlags.teleportIdentifier] = [];
              }
              game.merlin.teleportTileIds[merlinFlags.teleportIdentifier].push([this.document.parent._id, this.document._id]);
            }
          }
          merlinFlags.teleportIdentifierPrev = merlinFlags.teleportIdentifier;

          submitData.flags ??= {};
          submitData.flags.merlin = {
            active: !!merlinFlags.active,
            triggers: this._normalizeMerlinTriggers(merlinFlags.triggers),
            runCode: merlinFlags.runCode ?? "",
            teleportIn: !!merlinFlags.teleportIn,
            teleportOut: !!merlinFlags.teleportOut,
            relativeLocation: !!merlinFlags.relativeLocation,
            teleportIdentifier: merlinFlags.teleportIdentifier ?? "",
            teleportIdentifierPrev: merlinFlags.teleportIdentifierPrev ?? "",
            isPOI: !!merlinFlags.isPOI
          };
          
          await super._processSubmitData(event, form, submitData, options);
        }

        /** @override */
        getData(options) {
          const data = super.getData(options);
          const triggers = this._normalizeMerlinTriggers(this.document.getFlag("merlin", "triggers"));
          data.source.flags = foundry.utils.mergeObject(data.source.flags ?? {}, {
            "merlin": {
              active: this.document.getFlag("merlin", "active") ?? true,
              triggers,
              runCode: this.document.getFlag("merlin", "runCode") ?? "",
              teleportIn: this.document.getFlag("merlin", "teleportIn") ?? false,
              teleportOut: this.document.getFlag("merlin", "teleportOut") ?? false,
              relativeLocation: this.document.getFlag("merlin", "relativeLocation") ?? false,
              teleportIdentifier: this.document.getFlag("merlin", "teleportIdentifier") ?? "",
              teleportIdentifierPrev: this.document.getFlag("merlin", "teleportIdentifierPrev") ?? "",
              isPOI: this.document.getFlag("merlin", "isPOI") ?? false,
            }
          });
          return data;
        }

        /** @override */
        async _preparePartContext(partId, context, options) {
          const partContext = await super._preparePartContext(partId, context, options);
          if (partId === "merlin") {
            partContext.triggerOptions = MerlinTileConfig.#MERLIN_TRIGGERS.map(trigger => ({
              value: trigger,
              label: trigger.charAt(0).toUpperCase() + trigger.slice(1)
            }));
            partContext.triggerJson = JSON.stringify(partContext.source.flags?.merlin?.triggers ?? []);
          }
          return partContext;
        }

        _normalizeMerlinTriggers(value) {
          const allowed = new Set(MerlinTileConfig.#MERLIN_TRIGGERS);
          let triggers = [];

          if (Array.isArray(value)) {
            triggers = value;
          } else if (typeof value === "string") {
            const trimmed = value.trim();
            if (trimmed) {
              try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) triggers = parsed;
                else triggers = trimmed.split(",");
              } catch {
                triggers = trimmed.split(",");
              }
            }
          }

          return [...new Set(triggers.map(trigger => String(trigger).trim().toLowerCase()).filter(trigger => allowed.has(trigger)))];
        }

        /** @override */
        _attachPartListeners(partId, htmlElement, options) {
          super._attachPartListeners(partId, htmlElement, options);
          if (partId !== "merlin") return;

          const select = htmlElement.querySelector("[data-merlin-trigger-select]");
          const list = htmlElement.querySelector("[data-merlin-trigger-list]");
          const hidden = htmlElement.querySelector('input[name="flags.merlin.triggers"]');
          if (!select || !list || !hidden) return;

          const renderTriggerList = () => {
            const triggers = this._normalizeMerlinTriggers(hidden.value);
            list.replaceChildren(...triggers.map(trigger => {
              const chip = document.createElement("span");
              chip.className = "merlin-trigger-chip";
              chip.dataset.trigger = trigger;

              const label = document.createElement("span");
              label.textContent = trigger;

              const remove = document.createElement("button");
              remove.type = "button";
              remove.className = "merlin-trigger-remove";
              remove.dataset.merlinRemoveTrigger = trigger;
              remove.setAttribute("aria-label", `Remove ${trigger}`);
              remove.innerHTML = "&times;";

              chip.append(label, remove);
              return chip;
            }));
          };

          const commitTriggers = (triggers) => {
            hidden.value = JSON.stringify(this._normalizeMerlinTriggers(triggers));
            hidden.dispatchEvent(new Event("change", { bubbles: true }));
            renderTriggerList();
          };

          select.addEventListener("change", () => {
            const value = select.value;
            if (!value) return;
            const triggers = this._normalizeMerlinTriggers(hidden.value);
            if (!triggers.includes(value)) {
              triggers.push(value);
              commitTriggers(triggers);
            }
            select.value = "";
          });

          list.addEventListener("click", event => {
            const button = event.target.closest("[data-merlin-remove-trigger]");
            if (!button) return;
            const trigger = button.dataset.merlinRemoveTrigger;
            const triggers = this._normalizeMerlinTriggers(hidden.value).filter(value => value !== trigger);
            commitTriggers(triggers);
          });

          renderTriggerList();
        }

    }

    Object.defineProperty(MerlinTileConfig.prototype.constructor, "name", { value: "MerlinTileConfig" });
    // Loop through all tiles in all scenes and build our teleportTileIds map for tiles with teleport OUT enabled
    this.teleportTileIds = {};
    for(let scene of game.scenes){
      for(let tileData of scene.tiles){
        const teleportOut = tileData.flags?.merlin?.teleportOut;
        if(teleportOut){
          const identifier = tileData.flags?.merlin?.teleportIdentifier;
          if(identifier){
            if(!this.teleportTileIds[identifier]){
              this.teleportTileIds[identifier] = [];
            }
            this.teleportTileIds[identifier].push([scene.id, tileData.id]);
          }
        }
      }
    }

    // Extend Foundry's base tile sheet class with our custom class
    CONFIG.Tile.sheetClasses.base['core.TileConfig'].cls = MerlinTileConfig;

    game.socket.on(`module.merlins-miscellany`, this._onSocket.bind(this));

    // Get the scene controls buttons. Add a call to update POI visibility whenever any of them is clicked.
    const layersMenu = document.getElementById("scene-controls-layers");
    if (layersMenu) {
      // Find all buttons inside its list items
      const buttons = layersMenu.querySelectorAll("button");

      // Loop through each button and attach a click handler
      buttons.forEach(button => {
        button.addEventListener("click", event => {
          if(this.prevActiveControl == "tiles"){
            setTimeout(() => {
              this._updatePOITilesVisibility();
            }, 100);
          }
          // Optionally, get the data-control name (like 'tokens', 'tiles', etc.)
          this.prevActiveControl = button.dataset.control;
        });
      });
    }
  }

  async _onCanvasReady(canvas) {
    console.log("Merlin | Canvas Ready");
    setTimeout(() => {
      this._updatePOITilesVisibility();
    }, 100);

    if(!game.user.isGM) return;

    // If this scene has a fog mask configured, seed every user's fog the first time it is encountered.
    const fogMaskPath = canvas.scene?.flags?.merlin?.fogMask;
    if (game.user.isGM && fogMaskPath) {
      try {
        await this.seedInitialFogMaskForScene(canvas.scene, fogMaskPath, false, false);
      } catch (err) {
        console.error("Merlin | Failed to seed scene fog mask:", err);
        ui.notifications.error(`Merlin: Failed to initialize fog mask for scene "${canvas.scene.name}".`);
      }
    }

    // Automatic thumbnail regeneration
    const scene = canvas.scene;
    if (!scene) return;

    const thumb = scene.thumb;
    if(await this._isValidFilePath(thumb)) return;
    if (this._regenInProgress) return;
    this._regenInProgress = true;

    console.warn(`Invalid thumbnail detected for scene "${scene.name}", "${scene.thumb}", regenerating all...`);

    try {
      let count = 0;
      for (let s of game.scenes) {
        if(await this._isValidFilePath(s.thumb)) continue;
        const t = await s.createThumbnail();
        await s.update({ thumb: t.thumb });
        count++;
      }

      if(count > 0) {
        ui.notifications.info("All missing scene thumbnails regenerated.");
      }
    } catch (err) {
      console.error("Thumbnail regeneration failed:", err);
    } finally {
      this._regenInProgress = false;
    }
  }

  async _isValidFilePath(path) {
    if (!path || typeof path !== "string") return false;

    // Ignore base64 thumbnails (these are always "valid")
    if (path.startsWith("data:image")) return true;

    try {
      // Split into directory + filename
      const parts = path.split("/");
      const filename = parts.pop();
      const dir = parts.join("/");

      // Determine source (data/public/s3)
      const source = dir.startsWith("systems") || dir.startsWith("modules") || dir.startsWith("icons")
        ? "public"
        : "data";

      const result = await FilePicker.browse(source, dir);

      return result.files.some(f => f.endsWith(filename));
    } catch (e) {
      return false;
    }
  }

  /**
   * Define a fog mask for a Scene and seed every user's FogExploration the first time they connect.
   * White areas in the mask become explored; black areas remain unexplored.
   * @param {Scene|string} sceneOrId
   * @param {string} maskPath
   * @param {boolean} persistFlag=true  If true, store the mask path on the Scene as `flags.merlin.fogMask`.
   * @returns {Promise<void>}
   */
  async seedInitialFogMaskForScene(sceneOrId, maskPath, persistFlag = true, overwrite = true) {
    const scene = typeof sceneOrId === "string" ? game.scenes.get(sceneOrId) : sceneOrId;
    if (!scene) throw new Error("Scene not found.");
    if (!maskPath) throw new Error("A mask PNG path is required.");
    if (!game.user.isGM) {
      throw new Error("Only a GM can seed fog masks for all users.");
    }

    if (persistFlag) {
      await scene.update({"flags.merlin.fogMask": maskPath});
    }

    const dims = scene.getDimensions();
    const maskTexture = await this._loadTexture(maskPath);
    const explored = await this._maskTextureToExploredBase64(maskTexture, dims);
    maskTexture?.destroy?.(true);

    if (!explored) return;
    const levelId = scene._view ?? scene.initialLevel?.id ?? scene.firstLevel?.id ?? scene.constructor.metadata.defaultLevelId;
    const fogExplorationCls = foundry.documents.FogExploration;
    const targets = [...game.users].filter(user => !!user?.id);

    let updated = false;
    for (const user of targets) {
      const exploration = await fogExplorationCls.load({scene: scene.id, user});
      if (exploration && !overwrite) continue;

      updated = true;
      await fogExplorationCls.create({
        scene: scene.id,
        level: levelId,
        user: user.id,
        explored,
        timestamp: Date.now()
      }, {loadFog: false});
    }

    if(updated) {
      game.socket.emit("module.merlins-miscellany", { action: "windowReload" });
      window.location.reload();
    }
  }

  async _loadTexture(src) {
    const asset = await PIXI.Assets.load(src);
    const texture = asset instanceof PIXI.Texture
      ? asset
      : asset?.baseTexture
        ? new PIXI.Texture(asset.baseTexture)
        : asset instanceof PIXI.BaseTexture
          ? new PIXI.Texture(asset)
          : null;

    if (!texture) throw new Error(`Unable to load texture from "${src}".`);
    if (texture.baseTexture && !texture.baseTexture.valid) {
      await new Promise(resolve => texture.once("update", resolve));
    }
    return texture;
  }

  async _maskTextureToExploredBase64(maskTexture, dims) {
    const sprite = new PIXI.Sprite(maskTexture);
    sprite.position.set(0, 0);
    sprite.width = dims.width;
    sprite.height = dims.height;

    const extracted = canvas.app.renderer.extract.canvas(sprite);
    sprite.destroy({children: true, texture: false, baseTexture: false});

    const context = extracted.getContext("2d");
    const imageData = context.getImageData(0, 0, extracted.width, extracted.height);
    const pixels = imageData.data;

    for (let i = 0; i < pixels.length; i += 4) {
      const alpha = Math.round((pixels[i] * pixels[i + 3]) / 255);
      pixels[i] = 255;
      pixels[i + 1] = 255;
      pixels[i + 2] = 255;
      pixels[i + 3] = alpha;
    }

    context.putImageData(imageData, 0, 0);
    return extracted.toDataURL("image/png");
  }

  // Watch for light updates
  async _onUpdateLight(doc, changes, options, userId){
    if (!("hidden" in changes)) return;

    const state = doc.hidden ? "OFF" : "ON";
    console.log(`Merlin | Light [${doc.id}] toggled ${state}`);

    // Run custom code if provided
    const code = doc.flags.merlin.runCode;
    if (code) {
      try {
        console.log(`Merlin | Running code for light ${doc.id}`);
        // eslint-disable-next-line no-eval
        eval(code);
      } catch (err) {
        console.error("Merlin | Error in runCode:", err);
        ui.notifications.error(`Merlin: Error in runCode for light ${doc.id}`);
      }
    }

    // Toggle tiles if specified
    const tileIds = doc.flags.merlin.switchTiles;
    if (tileIds) {
      const ids = tileIds.split(",").map(s => s.trim()).filter(Boolean);
      for (let id of ids) {
        let inverted = false;
        if(id[0] === '-'){
          inverted = true;
          id = id.slice(1);
        }
        const tile = canvas.tiles.get(id);
        if (tile) {
          await tile.document.update({ alpha: (doc.hidden == inverted ? 1 : 0), hidden: false });
        }
      }
    }
  }

  // Supposed to keep track of tokens controlled by the primary GM
  // But not sure how it will interact with additional GMs who can also control tokens
  GMControlledTokenIds = new Set();
  _onControlToken(token, controlled) {
    console.log('Merlin | Token control changed', token.document._id, controlled);
    if (controlled) {
      if (game.user.isGM) {
        this.GMControlledTokenIds.add(token.document._id);
      }
    } else {
      this.GMControlledTokenIds.delete(token.document._id);
    }
  }

  // Store the previous movement of each token when it updates
  // This is mainly so that clients can get an accurate movement origin for selective tile triggers
  prevMovementMap = new Map();
  _onUpdateToken(scene, tokenData, updateData, options, userId) {
    if (updateData._movement?.[tokenData._id]) {
      // We mark a new token as no longer 'freshly teleported' the first time it moves
      const movement = updateData._movement[tokenData._id];
      if(movement.destination.x !== movement.origin.x
          || movement.destination.y !== movement.origin.y){
        this.teleportedTokenIds.delete(tokenData._id);
      }
      // Store previous movement
      this.prevMovementMap.set(tokenData._id, updateData._movement[tokenData._id]);

      // For each tile in the scene with a Merlin trigger, check if it should be triggered by this movement and if so, run its code
      const token = canvas.tokens.get(tokenData._id);
      if(!token) return;
      for(let tile of canvas.tiles.placeables){
        try{
          const merlinFlags = tile.document.flags?.merlin;
          if(!merlinFlags?.active) continue;
          const triggers = merlinFlags.triggers ?? [];
          const shouldTrigger = (triggers.includes("enter") && this._checkMovementTrigger(token, tile.document, "enter"))
            || (triggers.includes("exit") && this._checkMovementTrigger(token, tile.document, "exit"))
            || (triggers.includes("stop within") && this._checkMovementTrigger(token, tile.document, "stop within"));
          if(shouldTrigger){
            // Run the tile's code
            const code = merlinFlags.runCode;
            if (code) {
              try {
                console.log(`Merlin | Running code for tile ${tile.id} triggered by token ${token.id}`);
                // eslint-disable-next-line no-eval
                eval(code);
              } catch (err) {
                console.error("Merlin | Error in runCode:", err);
                ui.notifications.error(`Merlin: Error in runCode for tile ${tile.id}`);
              }
            }
            // Trigger the tile's teleport if enabled
            if(merlinFlags.teleportIn){
              const identifier = merlinFlags.teleportIdentifier;
              const destinations = this.teleportTileIds[identifier];
              if(destinations){
                let destination = destinations[Math.floor(Math.random() * destinations.length)];
                if(!merlinFlags.relativeLocation){
                  this.teleportTokenToTile(tile.document.parent._id, destination[0], destination[1], token.document._id);
                } else {
                  this.teleportTokenToTileRelative(tile.document.parent._id, tile.document._id,destination[0], destination[1], token.document._id);
                }
              }
            }
          }
        } catch (err) {
          console.error("Merlin | Error processing tile:", err);
        }
      }
    }
  }
  _checkMovementTrigger(token, tile, triggerType){    
    const prevMovement = this.prevMovementMap.get(token.document._id);
    if(!prevMovement) return false;
    const tokenWidth = token.document.width * canvas.grid.size;
    const tokenHeight = token.document.height * canvas.grid.size;
    const tileRect = new PIXI.Rectangle(tile.x - tile.width / 2, tile.y - tile.height / 2, tile.width, tile.height);
    const destinationRect = new PIXI.Rectangle(prevMovement.destination.x, prevMovement.destination.y, tokenWidth, tokenHeight);
    const originRect = new PIXI.Rectangle(prevMovement.origin.x, prevMovement.origin.y, tokenWidth, tokenHeight);
    if(triggerType === "enter"){
      return !this._rectsIntersect(originRect, tileRect) && this._rectsIntersect(destinationRect, tileRect);
    }
    else if(triggerType === "exit"){
      return this._rectsIntersect(originRect, tileRect) && !this._rectsIntersect(destinationRect, tileRect);
    }
    else if(triggerType === "stop within"){
      return this._rectsIntersect(destinationRect, tileRect);
    }
    return false;
  }

  _rectsIntersect(rect1, rect2, margin = 0){
    return rect1.x < rect2.x + rect2.width + margin && rect1.x + rect1.width > rect2.x - margin && rect1.y < rect2.y + rect2.height + margin && rect1.y + rect1.height > rect2.y - margin;
  }

  userPOIVisibility = {};
  // The weather and time settings for this scene, if any
  sceneMerlinWeather = {};
  sceneMerlinTime = {};
  // Map of keys to filenames
  sceneBackgroundFilenames = {};
  sceneForegroundFilenames = {};
  currentBackgroundInfo = {};
  activeLevel = null;
  
  async _getSceneControlButtons(controls){
    console.log("Merlin | Adding scene control buttons", controls);
    // Add our toggle button to the tools array
    const poiButton = {
      name: "toggleCustomNote",
      title: "Toggle Points of Interest",
      icon: "fas fa-eye",
      toggle: true, // allows Foundry to treat it like a toggle button
      active: this.userPOIVisibility[game.userId] ?? false,
      onClick: (toggle) => {
        // Flip the local variable for this user
        this.userPOIVisibility[game.userId] = toggle;
        console.log("Merlin | " + (toggle ? "Showing" : "Hiding") + " Point of Interest Tiles");
        this._updatePOITilesVisibility();
      },
      button: true
    };
    controls.tokens.tools[poiButton.name] = poiButton;

    const fogResetTool = controls.lighting?.tools?.reset;
    if (fogResetTool && !fogResetTool._merlinFogMaskWrapped) {
      fogResetTool.onChange = () => {
        const fogMaskPath = canvas.scene?.flags?.merlin?.fogMask;
        if (!game.user.isGM || !fogMaskPath) return;

        const sceneName = canvas.scene?.name ?? "this scene";
        new Dialog({
          title: "Reset Fog of War?",
          content: `<p>This will clear fog exploration progress for <strong>${sceneName}</strong> and force all connected players to reload.</p><p>Do you want to continue?</p>`,
          buttons: {
            confirm: {
              label: "Reset",
              callback: () => {
                setTimeout(async () => {
                  try {
                    await this.seedInitialFogMaskForScene(canvas.scene, fogMaskPath, false, true);
                    ui.notifications.info("Fog of War exploration progress was reset for this Scene");
                  } catch (err) {
                    console.error("Merlin | Failed to restore scene fog mask after fog reset:", err);
                    ui.notifications.error(`Merlin: Failed to restore fog mask for scene "${canvas.scene.name}".`);
                  }
                }, 250);
              }
            },
            cancel: {
              label: "Cancel"
            }
          },
          default: "cancel"
        }).render(true);
      };
      fogResetTool._merlinFogMaskWrapped = true;
    }

    // Split into directory + filename
    if(!canvas.scene) return;
    let backgroundPath = canvas.scene.background.src;
    this.activeLevel = null;
    // Handle multilevel scenes in 14+
    if(game.version >= 14){
      this.activeLevel = canvas.scene.levels.get(canvas.scene._view);
      backgroundPath = this.activeLevel?.background?.src;
    }
    const parts = backgroundPath.split("/");
    const filename = parts.pop();
    const dir = parts.join("/");
    const backgroundInfo = this._getBackgroundTypeFromFilename(filename);

    let hasStatic = !backgroundInfo.isVideo;
    let hasAnimated = backgroundInfo.isVideo;
    const hasWeatherTypes = new Set();
    hasWeatherTypes.add(backgroundInfo.weather);
    const hasTimes = new Set();
    hasTimes.add(backgroundInfo.time);
    this.sceneBackgroundFilenames = {};
    this.sceneForegroundFilenames = {};
    let key = this._getKeyFromBackgroundInfo(backgroundInfo);
    this.sceneBackgroundFilenames[key] = backgroundPath;
    let fileBackgroundInfos = {};
    fileBackgroundInfos[key] = backgroundInfo;

    // Get all files in directory that share the same stem    
    const result = await foundry.applications.apps.FilePicker.browse("data", dir);
    const filenames = result.files.map(path => path.split("/").pop());
    
    for(let f of filenames){      
      if(f === filename) continue;
      const fBackgroundInfo = this._getBackgroundTypeFromFilename(f);
      if(fBackgroundInfo.stem === backgroundInfo.stem){
        if(fBackgroundInfo.isFG) {
          this.sceneForegroundFilenames[this._getKeyFromBackgroundInfo(fBackgroundInfo)] = dir + "/" + f;
          continue;
        }
        hasStatic |= !fBackgroundInfo.isVideo;
        hasAnimated |= fBackgroundInfo.isVideo;
        if(fBackgroundInfo.weather) hasWeatherTypes.add(fBackgroundInfo.weather);
        if(fBackgroundInfo.time) hasTimes.add(fBackgroundInfo.time);

        key = this._getKeyFromBackgroundInfo(fBackgroundInfo);
        if(!this.sceneBackgroundFilenames[key]
          || (!fBackgroundInfo.miscSuffix && fileBackgroundInfos[key].miscSuffix)
        ){
          this.sceneBackgroundFilenames[key] = dir + "/" + f;
          fileBackgroundInfos[key] = fBackgroundInfo;
        }
      }
    }
    // Create a mapping of fallback foregrounds for each background, prioritizing same weather and time, then same time, then same weather, then any
    if(Object.keys(this.sceneForegroundFilenames).length > 1){
      let sceneForegroundFallbacks = {};
      for(let key in this.sceneBackgroundFilenames){
        const bgInfo = this._getBackgroundTypeFromFilename(this.sceneBackgroundFilenames[key].split("/").pop());
        let fgPath = null;
        if(this.sceneForegroundFilenames[key]){
          fgPath = this.sceneForegroundFilenames[key];
        }
        else{
          const sameWeatherTimeKey = this._getKeyFromBackgroundInfo(bgInfo);
          const sameTimeKey = this._getKeyFromBackgroundInfo({ ...bgInfo, weather: "none" });
          const sameWeatherKey = this._getKeyFromBackgroundInfo({ ...bgInfo, time: "day" });
          const sameWeatherTimeVideoKey = this._getKeyFromBackgroundInfo( bgInfo, {isVideo: !bgInfo.isVideo});
          const sameTimeVideoKey = this._getKeyFromBackgroundInfo({ ...bgInfo, weather: "none", isVideo: !bgInfo.isVideo });
          const sameWeatherVideoKey = this._getKeyFromBackgroundInfo({ ...bgInfo, time: "day", isVideo: !bgInfo.isVideo });
          fgPath = this.sceneForegroundFilenames[sameWeatherTimeKey] || this.sceneForegroundFilenames[sameTimeKey] || this.sceneForegroundFilenames[sameWeatherKey] 
            || this.sceneForegroundFilenames[sameWeatherTimeVideoKey] || this.sceneForegroundFilenames[sameTimeVideoKey] || this.sceneForegroundFilenames[sameWeatherVideoKey]
            || Object.values(this.sceneForegroundFilenames)[0] || null;
        }
        sceneForegroundFallbacks[key] = fgPath;
      }
      this.sceneForegroundFilenames = sceneForegroundFallbacks;
    }

    // Determine target background for this scene
    if(!this.sceneMerlinWeather[canvas.scene.id]){
      this.sceneMerlinWeather[canvas.scene.id] = backgroundInfo.weather;
    }
    this.currentBackgroundInfo.weather = this.sceneMerlinWeather[canvas.scene.id];
    if(!this.sceneMerlinTime[canvas.scene.id]){
      this.sceneMerlinTime[canvas.scene.id] = backgroundInfo.time;
    }
    this.currentBackgroundInfo.time = this.sceneMerlinTime[canvas.scene.id];
    this.currentBackgroundInfo.isVideo = this.usersUseMerlinVideo[game.userId] ?? backgroundInfo.isVideo;
    // Attempt to switch to it if we have a suitable background, else fall back to the current background
    if(!this._updateBackground(this.currentBackgroundInfo)){
       this.currentBackgroundInfo = backgroundInfo;
    }

    if(hasAnimated && hasStatic){
      const videoButton = {
        name: "toggleMerlinVideo",
        title: "Toggle Animated Background",
        icon: "fas fa-video",
        toggle: true, // allows Foundry to treat it like a toggle button
        active: this.usersUseMerlinVideo[game.userId] ?? false,
        onClick: (toggle) => {
          // Flip the local variable for this user
          this.usersUseMerlinVideo[game.userId] = !this.usersUseMerlinVideo[game.userId];
          // Save settings
          game.settings.set("merlins-miscellany", "usersUseMerlinVideo", this.usersUseMerlinVideo);
          toggle = this.usersUseMerlinVideo[game.userId];
          console.log("Merlin | " + "Switching to " + (toggle ? "animated" : "static") + " backgrounds.");

          let desiredBackgroundInfo = this.currentBackgroundInfo;
          desiredBackgroundInfo.isVideo = toggle;
          this._updateBackground(desiredBackgroundInfo);
        },
        button: true
      };
      controls.lighting.tools[videoButton.name] = videoButton;
    }

    if(hasTimes.size > 1){
      const timeSelect = {
        name: "selectMerlinTime",
        title: this.currentBackgroundInfo.time === "day" ? "Switch To Night" : "Switch To Day",
        icon: this.currentBackgroundInfo.time === "day" ? "fas fa-moon" : "fas fa-sun",
        onClick: (toggle) => {
          let desiredBackgroundInfo = this.currentBackgroundInfo;
          desiredBackgroundInfo.time = this.currentBackgroundInfo.time === "day" ? "night" : "day";
          console.log("Merlin | " + "Switching time to " + desiredBackgroundInfo.time);
          if(this._updateBackground(desiredBackgroundInfo)){
            this.sceneMerlinTime[canvas.scene.id] = desiredBackgroundInfo.time;
          }
        }
      };
      controls.lighting.tools[timeSelect.name] = timeSelect;

      // Hide default day/night controls
      delete controls.lighting.tools.day;
      delete controls.lighting.tools.night;
    }
    
    if(hasWeatherTypes.size > 1){
      const weatherSelect = {
        name: "selectMerlinWeather",
        title: "Toggle Rain",
        icon: "fas fa-cloud-rain",
        toggle: true, 
        active: this.currentBackgroundInfo.weather === "rain" ?? false,
        onClick: (toggle) => {
          let desiredBackgroundInfo = this.currentBackgroundInfo;
          desiredBackgroundInfo.weather = this.currentBackgroundInfo.weather === "rain" ? "none" : "rain";
          console.log("Merlin | " + "Switching weather to " + desiredBackgroundInfo.weather);
          if(this._updateBackground(desiredBackgroundInfo)){
            this.sceneMerlinWeather[canvas.scene.id] = desiredBackgroundInfo.weather;
          }
        }
      };
      controls.lighting.tools[weatherSelect.name] = weatherSelect;
    }

    // Refresh controls UI after background reload.
    if(controls.lighting.active){
      const button = document.querySelector(
        'button[data-control="tokens"]'
      );
      const button2 = document.querySelector(
        'button[data-control="lighting"]'
      );
      if (button && button2) {
        button.click();
        button2.click();
      }
    }
  }

  _getBackgroundTypeFromFilename(filename){
    const ext = filename.split('.').pop().toLowerCase();
    const base = filename.substring(0, filename.lastIndexOf('.'));
    // Simple heuristic: if it's a video format, treat it as animated. Otherwise static.
    const videoFormats = ["mp4", "webm", "ogg"];
    const weatherTypes = ["none", "rain"];
    const times = ["day", "night", "dusk", "dawn"];
    
    const parts = base.split("_");
    const stem = parts.slice(0, Math.max(1, parts.length-3)).join("_");
    const suffixes = parts.slice(Math.max(1, parts.length-3), parts.length);
    let weatherType = "none";
    let time = "day";
    let isFG = false;
    let miscSuffix = false;
    for(let s of suffixes){
      s = s.toLowerCase();      
      if(weatherTypes.includes(s)){
        weatherType = s;
      }
      else if(times.includes(s)){
        time = s;
      }
      else if(s === "fg"){
        isFG = true;
      }
      else{
        miscSuffix = true;
      }
    }
    
    return { 
      isVideo: videoFormats.includes(ext),
      isFG: isFG,
      weather: weatherType,
      time: time,
      miscSuffix: miscSuffix,
      stem: stem,
      ext: ext
    }
  }

  _getKeyFromBackgroundInfo(backgroundInfo){
    return `${backgroundInfo.isVideo}_${backgroundInfo.weather}_${backgroundInfo.time}`;
  }

  async _updateBackground(backgroundInfo){
    const targetKey = this._getKeyFromBackgroundInfo(backgroundInfo);
    if(this.sceneBackgroundFilenames[targetKey]){      
      let object = { background: { src: this.sceneBackgroundFilenames[targetKey] } };
      if(this.sceneForegroundFilenames[targetKey]){
        object.foreground = this.sceneForegroundFilenames[targetKey];
      }
      if(game.version >= 14){
        this.activeLevel.update(object);
      }
      else{
        await canvas.scene.update(object);
      }

      this.currentBackgroundInfo = backgroundInfo;
      return true;
    }
    return false;
  }

  // Update the local visibility of all POI tiles in scene depending on user setting
  async _updatePOITilesVisibility(){
    const shouldShow = this.userPOIVisibility[game.userId] ?? false;
    for (let tileDoc of canvas.scene.tiles) {
      if(tileDoc.flags?.["merlin"]?.isPOI ?? false){
        async function toggleTile() {
          const tile = await canvas.tiles.get(tileDoc._id);
          if(!tile.mesh){
            setTimeout(() => {
              toggleTile();
            }, 0);
          }
          else{
            tile.mesh.alpha = shouldShow ? 1 : 0;
          }
        }
        toggleTile();
      }
    }
  }

  _onSocket(data) {
    if (data.action === "windowReload") {
      window.location.reload();
    }
    
    if(!game.user.isGM) return;

    if (data.action === "teleportToken") {
      this.#teleportTokenToTile(data.sourceSceneId, data.targetSceneId, data.targetTileId, data.tokenId);
    }
    else if (data.action === "teleportTokenRelative") {
      this.#teleportTokenToTileRelative(data.sourceSceneId, data.sourceTileId, data.targetSceneId, data.targetTileId, data.tokenId);
    }
  }

  // Set of tokens currently being teleported
  teleportingTokenIds = new Set();
  // Set of tokens just been teleported and not yet moved
  teleportedTokenIds = new Set();
  // Teleports a token to a tile
  // Wrapper selects client or server call
  teleportTokenToTile(sourceSceneId, targetSceneId, targetTileId, tokenId) {
    if (game.user.isGM) {
      console.log('Merlin | Teleporting token directly as GM');
      this.#teleportTokenToTile(sourceSceneId, targetSceneId, targetTileId, tokenId);
    } else {
      console.log('Merlin | Requesting token teleport via socket');
      game.socket.emit("module.merlins-miscellany", {
        action: "teleportToken",
        sourceSceneId,
        targetSceneId,
        targetTileId,
        tokenId
      });
    }
  }  
  teleportTokenToTileRelative(sourceSceneId, sourceTileId, targetSceneId, targetTileId, tokenId) {
    if (game.user.isGM) {
      console.log('Merlin | Teleporting token directly as GM');
      this.#teleportTokenToTileRelative(sourceSceneId, sourceTileId, targetSceneId, targetTileId, tokenId);
    } else {
      console.log('Merlin | Requesting token teleport via socket');
      game.socket.emit("module.merlins-miscellany", {
        action: "teleportTokenRelative",
        sourceSceneId,
        sourceTileId,
        targetSceneId,
        targetTileId,
        tokenId
      });
    }
  }

  // Internal implementation
  async #teleportTokenToTile(sourceSceneId, targetSceneId, targetTileId, tokenId) {
    const targetScene = game.scenes.get(targetSceneId);
    const targetTile = targetScene.tiles.get(targetTileId);
    let snapped = this.getSnappedPosition(targetTile, targetScene);
    
    this.#teleportTokenToPosition(sourceSceneId,targetSceneId, snapped, tokenId);
  }

   async #teleportTokenToTileRelative(sourceSceneId, sourceTileId, targetSceneId, targetTileId, tokenId) {
    const sourceScene = game.scenes.get(sourceSceneId);
    const sourceTile = sourceScene.tiles.get(sourceTileId);
    const targetScene = game.scenes.get(targetSceneId);
    const targetTile = targetScene.tiles.get(targetTileId);
    const token = sourceScene.tokens.get(tokenId);
    const prevMovement = this.prevMovementMap.get(tokenId);

    let relativeX = (prevMovement.destination.x - sourceTile.x) * (targetTile.width / sourceTile.width);
    let relativeY = (prevMovement.destination.y - sourceTile.y) * (targetTile.height / sourceTile.height);
    const snapped = this.getSnappedPosition({x: targetTile.x + relativeX, y: targetTile.y + relativeY}, targetScene);
    
    this.#teleportTokenToPosition(sourceSceneId,targetSceneId, snapped, tokenId);
  }

  getSnappedPosition(targetTile, targetScene){
    // Not sure when this was deprecated but 14 seems like a good guess.
    if(game.version >= 14){
      return targetScene.grid.getSnappedPoint({x: targetTile.x - 1, y: targetTile.y - 1}, {mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_CORNER, resolution: 1});      
    }
    else{
      return targetScene.grid.getSnappedPosition(targetTile.x, targetTile.y, 1);
    }
  }

  async #teleportTokenToPosition(sourceSceneId, targetSceneId, targetPosition, tokenId) {
    // Checks to stop teleporting on arrival loops
    if(this.teleportingTokenIds.has(tokenId)){
      return;
    }    
    if(this.teleportedTokenIds.has(tokenId)){
      return;
    }
    this.teleportingTokenIds.add(tokenId);

    const sourceScene = game.scenes.get(sourceSceneId);
    const targetScene = game.scenes.get(targetSceneId);
    const token = sourceScene.tokens.get(tokenId);

    // Duplicate the token document
    const duplToken = foundry.utils.duplicate(token);
    duplToken.x = targetPosition.x - duplToken.width / 2;
    duplToken.y = targetPosition.y - duplToken.height / 2;
    
    const created = await targetScene.createEmbeddedDocuments("Token", [duplToken]);
    const createdId = created[0]._id;

    // For any users controlling the original token, pull them to the new scene (if any) + grab the new token
    const actor = game.actors.get(duplToken.actorId);
    const owners = actor ? game.users.filter(u => actor.testUserPermission(u, "OWNER")) : [];
    await owners.forEach(user => {
      if(!(user.isGM && !this.GMControlledTokenIds.has(tokenId))){
        if(user.viewedScene !== targetScene.id){
          if(game.version >= 14){
            targetScene.pullUsers([user.id]);
          }
          else{
            game.socket.emit("pullToScene", targetScene.id, user.id);
          }
          
          // Players will keep control of their token automatically.
          // GMs need to manually take control of the new token after the canvas is loaded.
          if(user.isGM){
            Hooks.once("canvasReady", (canvas) => {
              this.controlToken(createdId);
            });
          }
        }
        else {
          this.controlToken(createdId);
        }
      }
    })

    token.delete();

    // Clear multilevel tokens of replicated player tokens
    setTimeout(() => {
      if(game.modules.has("multilevel")){
        game.multilevel.refreshAll();
      }
    }, 100);

    this.teleportingTokenIds.delete(tokenId);
    this.teleportedTokenIds.add(createdId);
  }

  async controlToken(tokenId){
      const token = canvas.tokens.get(tokenId);
      if(token){
        token.control();
      }
      else{
        setTimeout(() => {
          this.controlToken(tokenId);
        }, 100);
      }
  }

}

// Register our hook + sheet override
Hooks.once("init", () => {
  console.log("Merlin Module | Initializing");
  game.merlin = new Merlin();

  game.settings.register("merlins-miscellany", "usersUseMerlinVideo", {
    name: "Users Use Merlin Video",
    hint: "Users' use Merlin video preference.",
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });
  game.merlin.usersUseMerlinVideo = game.settings.get("merlins-miscellany", "usersUseMerlinVideo");
});
