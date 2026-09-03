import { Hexcrawl, registerHexcrawlSettings } from "./hexcrawl.js";

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

class Merlin extends Hexcrawl{

  constructor() {
    super();
    Hooks.on("ready", this._onReady.bind(this));
    Hooks.on("canvasReady", this._onCanvasReady.bind(this));
    Hooks.on("canvasPan", this._onCanvasPan.bind(this));
    Hooks.on("renderSceneNavigation", this._onRenderSceneNavigation.bind(this));
    Hooks.on("updateAmbientLight", this._onUpdateLight.bind(this));
    Hooks.on("controlToken", this._onControlToken.bind(this));
    Hooks.on("updateToken", this._onUpdateToken.bind(this));
    Hooks.on("getSceneControlButtons", this._getSceneControlButtons.bind(this));
    Hooks.on("updateTile", this._onUpdateTile.bind(this));
    Hooks.on("hoverTile", this._onHoverTile.bind(this));

    // Register fonts
    CONFIG.fontDefinitions["Jubilee Medium"] = {
        editor: true,
        fonts: [
            {
                urls: ["modules/merlins-miscellany/fonts/JubileeMedium.ttf"]
            }
        ]
    };
  }

  usersUseMerlinVideo = {};
  // Map of tile teleportIdentifiers to tile IDs for tiles with teleport OUT enabled. An identifier can be linked to multiple tiles.
  teleportTileIds = {};
  // Scene IDs where we have already built the base teleport tile map
  builtTeleportTileScenes = new Set();
  // Active hover caption for tiles
  tileCaption = null;
  tileCaptionTileId = null;
  tileCaptionText = "";
  tileCaptionFont = "";
  tileCaptionFontSize = 18;
  tileCaptionBoardListenersBound = false;
  bShowingTileCaption = false;

  prevPanPosition = {x: 0, y: 0, scale: 0};
  
  // The scene control (left-side control buttons) that was previously active
  prevActiveControl = "";
  async _onReady() {
    console.log("Merlin Module | Ready");

    // Extend ambient light sheet class with our custom class
    CONFIG.AmbientLight.sheetClasses.base['core.AmbientLightConfig'].cls = WithActiveLightConfig(CONFIG.AmbientLight.sheetClasses.base['core.AmbientLightConfig'].cls);

    const oldSheetClass = CONFIG.Tile.sheetClasses.base['core.TileConfig'].cls;

    // Declare our custom TileConfig class
    class MerlinTileConfig extends oldSheetClass {
        static #MERLIN_TRIGGERS = ["enter", "exit", "stop within", "click", "double click"];

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
          const stableId = String(merlinFlags.stableId ?? "").trim();
          if (!stableId) {
            ui.notifications.error("Merlin: Stable ID cannot be empty.");
            throw new Error("Merlin stable ID cannot be empty.");
          }
          if (this._getUsedStableIds().has(stableId)) {
            ui.notifications.error(`Merlin: The stable ID "${stableId}" is already used by another tile in this scene.`);
            throw new Error(`Merlin stable ID "${stableId}" is already in use.`);
          }

          // Store top-left tile coords
          const coords = game.merlin._getTileTopLeftCoords(options.x, options.y, options.width, options.height);
          merlinFlags.topLeftX = coords.x;
          merlinFlags.topLeftY = coords.y;

          // Update identifier map if teleportIdentifier changed
          if(merlinFlags.teleportIdentifier !== merlinFlags.teleportIdentifierPrev){
            // Remove the old identifier from the map
            if(merlinFlags.teleportIdentifierPrev){
              const tileIds = game.merlin.teleportTileIds[merlinFlags.teleportIdentifierPrev];
              if(tileIds){
                tileIds.delete(`${this.document.parent._id}:${this.document._id}`);
              }
            }
            // Add the new identifier to the map
            if(merlinFlags.teleportIdentifier && merlinFlags.teleportOut){
              if(!game.merlin.teleportTileIds[merlinFlags.teleportIdentifier]){
                game.merlin.teleportTileIds[merlinFlags.teleportIdentifier] = new Set();
              }
              game.merlin.teleportTileIds[merlinFlags.teleportIdentifier].add(`${this.document.parent._id}:${this.document._id}`);
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
            stableId,
            isPOI: !!merlinFlags.isPOI,
            caption: merlinFlags.caption ?? "",
            captionFont: merlinFlags.captionFont ?? CONFIG.defaultFontFamily,
            captionFontSize: Number(merlinFlags.captionFontSize ?? 18) || 18,
            topLeftX: merlinFlags.topLeftX ?? null,
            topLeftY: merlinFlags.topLeftY ?? null
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
              stableId: this._getStableId(),
              isPOI: this.document.getFlag("merlin", "isPOI") ?? false,
              caption: this.document.getFlag("merlin", "caption") ?? "",
              captionFont: this.document.getFlag("merlin", "captionFont") ?? CONFIG.defaultFontFamily,
              captionFontSize: this.document.getFlag("merlin", "captionFontSize") ?? 18,
              topLeftX: this.document.getFlag("merlin", "topLeftX") ?? null,
              topLeftY: this.document.getFlag("merlin", "topLeftY") ?? null
            }
          });
          return data;
        }

        /** @override */
        async _preparePartContext(partId, context, options) {
          const partContext = await super._preparePartContext(partId, context, options);
          if (partId === "appearance") {
            const fontChoices = foundry.applications?.settings?.menus?.FontConfig?.getAvailableFontChoices?.() ?? {};
            const currentFont = partContext.source?.flags?.merlin?.captionFont;
            fontChoices[CONFIG.defaultFontFamily] ??= CONFIG.defaultFontFamily;
            if (currentFont) fontChoices[currentFont] ??= currentFont;
            partContext.captionFontChoices = Object.keys(fontChoices).length ? fontChoices : {
              [CONFIG.defaultFontFamily]: CONFIG.defaultFontFamily
            };
          }
          if (partId === "merlin") {
            partContext.triggerOptions = MerlinTileConfig.#MERLIN_TRIGGERS.map(trigger => ({
              value: trigger,
              label: trigger.replace(/\b\w/g, char => char.toUpperCase())
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

        _getUsedStableIds() {
          const tileId = this.document.id;
          return new Set([...(this.document.parent?.tiles ?? [])]
            .filter(tile => tile.id !== tileId)
            .map(tile => String(tile?.flags?.merlin?.stableId ?? "").trim())
            .filter(Boolean));
        }

        _getStableId() {
          const currentId = String(this.document?.flags?.merlin?.stableId ?? "").trim();
          if (currentId) return currentId;

          const usedIds = this._getUsedStableIds();
          let index = 0;
          while (usedIds.has(`tile${String(index).padStart(4, "0")}`)) index += 1;
          return `tile${String(index).padStart(4, "0")}`;
        }

        /** @override */
        _attachPartListeners(partId, htmlElement, options) {
          super._attachPartListeners(partId, htmlElement, options);
          if (partId !== "merlin") return;

          const select = htmlElement.querySelector("[data-merlin-trigger-select]");
          const list = htmlElement.querySelector("[data-merlin-trigger-list]");
          const hidden = htmlElement.querySelector('input[name="flags.merlin.triggers"]');
          const stableIdInput = htmlElement.querySelector('input[name="flags.merlin.stableId"]');
          const copyStableIdButton = htmlElement.querySelector("[data-merlin-copy-stable-id]");

          copyStableIdButton?.addEventListener("click", async () => {
            try {
              await navigator.clipboard.writeText(stableIdInput?.value ?? "");
              ui.notifications.info("Merlin: Stable ID copied to the clipboard.");
            } catch (error) {
              console.error("Merlin | Failed to copy stable ID", error);
              ui.notifications.error("Merlin: Could not copy the stable ID to the clipboard.");
            }
          });

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
    this.builtTeleportTileScenes = new Set();
    for(let scene of game.scenes){
      await this._ensureSceneStableIds(scene);
      this._buildTeleportTileIdsMap(scene);

      // Also check all tiles are in the correct position due to  v13 -> v14 position fuckery
      for(let tileData of scene.tiles){
        const topLeftX = tileData.flags?.merlin?.topLeftX;
        const topLeftY = tileData.flags?.merlin?.topLeftY;
        if(topLeftX != null && topLeftY != null){
          const coords = this._getTileCoords(topLeftX, topLeftY, tileData.width, tileData.height);
          if(tileData.x !== coords.x || tileData.y !== coords.y){
            tileData.update({x: coords.x, y: coords.y});
          }
        }
        else{
          // If we don't have stored top-left coords, calculate and store them
          const coords = this._getTileTopLeftCoords(tileData.x, tileData.y, tileData.width, tileData.height);
          tileData.update({"flags.merlin.topLeftX": coords.x, "flags.merlin.topLeftY": coords.y});
        }
      }
    }

    // Extend Foundry's base tile sheet class with our custom class
    CONFIG.Tile.sheetClasses.base['core.TileConfig'].cls = MerlinTileConfig;

    this._bindMerlinDocumentClickListener();

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
    await this._ensureSceneStableIds(canvas.scene);
    this.overlays = [];
    this.tileCaption = null;
    this._hideTileCaption();
    this._bindTileCaptionListeners();
    this.prevPanPosition.scale = 0;
    setTimeout(() => {
      this._updatePOITilesVisibility();
    }, 100);
    
    this._buildTeleportTileIdsMap();

    // Hide grid outside of the background if there is padding
    if(canvas.scene.padding > 0){
      const padding = canvas.scene.padding;
      const sceneWidth = canvas.dimensions.sceneWidth;
      const sceneHeight = canvas.dimensions.sceneHeight;
      let padX = (canvas.interface.grid.mesh._width - sceneWidth)  / 2;
      let padY = (canvas.interface.grid.mesh._height - sceneHeight) / 2;
      // Deal with hex column even grids (todo: other grid types)
      if(canvas.scene.grid.type == 5){
        // Round to nearest multiple of grid size
        const gridY = canvas.scene.grid.size / 2;
        const gridX = gridY * 1.1547 / 2;
        padX = Math.round(padX / gridX) * gridX;
        padY = Math.round(padY / gridY) * gridY;
      }

      const mask = new PIXI.Graphics();
      mask.beginFill(0xffffff);
      mask.drawRect(
          padX - canvas.scene.background.offsetX,
          padY - canvas.scene.background.offsetY,
          sceneWidth,
          sceneHeight
      );
      mask.endFill();

      canvas.interface.grid.mesh.parent.addChild(mask);
      canvas.interface.grid.mesh.mask = mask;
    }

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
  
  overworldZoomOutThreshold = 0.65;

  _onCanvasPan(canvas, position) {    
    if(!canvas.ready) return;
    // Only trigger on zoom changes, not panning
    if(position.x != this.prevPanPosition?.x || position.y != this.prevPanPosition?.y){
      this.prevPanPosition = position;
      return;
    }
   
    if(canvas?.scene?.flags?.merlin?.parentSceneId){
      if(position.scale <= this.overworldZoomOutThreshold
        && this.prevPanPosition.scale == position.scale){
        this._viewParentScene();
      }
    }

    Hooks.callAll("merlinCanvasPan", position, this.prevPanPosition);

    this.prevPanPosition = position;
  }

  async _onRenderSceneNavigation(app, html) {
    const parentSceneId = canvas.scene?.flags?.merlin?.parentSceneId;
    if(!parentSceneId) return;

    const button = document.createElement("a");
    button.id = "parent-scene-button";
    button.classList.add("ui-control");
    button.innerHTML = `<i class="fa-solid fa-map"></i>`;
    button.setAttribute("data-tooltip", "Parent Scene");
    button.setAttribute("aria-label", "Parent Scene");
    button.addEventListener("click", () => {
      this._viewParentScene();      
    });
    
    html.appendChild(button);
  }

  async _viewParentScene(){
    const parentSceneId = canvas.scene?.flags?.merlin?.parentSceneId;
    const parentSceneView = canvas.scene?.flags?.merlin?.parentSceneView;
    
    if(!parentSceneId) return;
    let parentScene = game.scenes.get(parentSceneId);
    if(!parentScene){
      for (const scene of game.scenes) {
        if(scene?.flags?.merlin?.stableId == parentSceneId) {
          parentScene = scene;
          break;
        }
      }
    }
    if(parentScene){
      await parentScene.view();
      if(parentSceneView){
        await canvas.animatePan({
          x: parentSceneView.x,
          y: parentSceneView.y,
          scale: parentSceneView.scale
        });
      }
    }
  }

  async _ensureSceneStableIds(scene) {
    if (!game.user.isGM || !scene) return;

    const usedIds = new Set();
    const tilesWithoutStableIds = [];
    for (const tile of scene.tiles) {
      const stableId = String(tile?.flags?.merlin?.stableId ?? "").trim();
      if (stableId) usedIds.add(stableId);
      else tilesWithoutStableIds.push(tile);
    }

    const updates = tilesWithoutStableIds.map(tile => {
      let index = 0;
      let stableId;
      do {
        stableId = `tile${String(index).padStart(4, "0")}`;
        index += 1;
      } while (usedIds.has(stableId));
      usedIds.add(stableId);
      return { _id: tile.id, "flags.merlin.stableId": stableId };
    });

    if (updates.length) await scene.updateEmbeddedDocuments("Tile", updates);
  }

  _buildTeleportTileIdsMap(){
    for(let scene of game.scenes){
      if(this.builtTeleportTileScenes.has(scene.id)) continue;
      this.builtTeleportTileScenes.add(scene.id);

      for(let tileData of scene.tiles){
        const teleportOut = tileData.flags?.merlin?.teleportOut;
        if(teleportOut){
          const identifier = tileData.flags?.merlin?.teleportIdentifier;
          if(identifier){
            if(!this.teleportTileIds[identifier]){
              this.teleportTileIds[identifier] = new Set();
            }
            this.teleportTileIds[identifier].add(`${scene.id}:${tileData.id}`);
          }
        }
      }
    }
  }

  _onUpdateTile(tileDocument, changes, options, userId){
    if(changes.x || changes.y || changes.width || changes.height){
      const tile = canvas.scene.tiles.get(tileDocument._id);
      const coords = this._getTileTopLeftCoords(tileDocument.x, tileDocument.y, tileDocument.width, tileDocument.height);
      tileDocument.update({"flags.merlin.topLeftX": coords.x});
      tileDocument.update({"flags.merlin.topLeftY": coords.y});
    }    
  }

  _onHoverTile(tile, hovered) {
    if (!tile) return;
    if (!hovered || ui.controls?.control?.name === "tiles") {
      if (this.tileCaptionTileId === tile.id) this._hideTileCaption();
    }
  }

  _bindTileCaptionListeners() {
    if (this.tileCaptionBoardListenersBound) return;

    const board = document.querySelector("#board");
    if (!board) return;

    board.addEventListener("mousemove", this._handleTileCaptionMouseMove.bind(this));
    board.addEventListener("mouseleave", () => this._hideTileCaption());
    this.tileCaptionBoardListenersBound = true;
  }

  _handleTileCaptionMouseMove(event) {
    if (!canvas?.ready || !canvas.scene || !canvas.app?.view?.contains(event.target)) return;
    if (ui.controls?.control?.name === "tiles") {
      this._hideTileCaption();
      return;
    }

    const {x, y} = canvas.canvasCoordinatesFromClient({x: event.clientX, y: event.clientY});
    const pointer = new PIXI.Point(x, y);
    const tiles = canvas.tiles?.placeables ?? [];

    let targetTile = null;
    for (const tile of tiles) {
      const merlinFlags = tile?.document?.flags?.merlin;
      if (!merlinFlags?.active) continue;
      if (!this._tileContainsPoint(tile, pointer)) continue;
      if (merlinFlags.isPOI && !this.userPOIVisibility[game.userId]) continue;
      const caption = merlinFlags.caption?.trim?.() ?? "";
      if (!caption) continue;
      targetTile = tile;
      break;
    }

    if (!targetTile) {
      this._hideTileCaption();
      return;
    }

    const caption = targetTile.document?.flags?.merlin?.caption?.trim?.() ?? "";
    const captionFont = targetTile.document?.flags?.merlin?.captionFont?.trim?.() || CONFIG.defaultFontFamily;
    const captionFontSize = Number(targetTile.document?.flags?.merlin?.captionFontSize ?? 18) || 18;

    if (
      this.tileCaptionTileId === targetTile.id &&
      this.tileCaptionText === caption &&
      this.tileCaptionFont === captionFont &&
      this.tileCaptionFontSize === captionFontSize
    ) {
      return;
    }

    this._showTileCaption(targetTile, caption, captionFont, captionFontSize);
  }

  _showTileCaption(tile, caption, captionFont = CONFIG.defaultFontFamily, captionFontSize = 18) {
    this._hideTileCaption();

    const parent = canvas?.interface ?? canvas?.stage;
    const bounds = tile?.bounds;
    if (!parent || !bounds) return;

    this.bShowingTileCaption = true;

    const text = new PIXI.Text(caption, {
      fontFamily: captionFont,
      fontSize: captionFontSize,
      fill: "#ffffff",
      align: "center",
      stroke: "#000000",
      strokeThickness: 4,
      dropShadow: true,
      dropShadowColor: "#000000",
      dropShadowBlur: 2,
      dropShadowDistance: 0
    });

    text.anchor.set(0.5, 0);
    text.eventMode = "none";
    text.interactive = false;
    text.interactiveChildren = false;
    text.zIndex = 1000000;
    text.position.set(bounds.x + (bounds.width / 2), bounds.y + bounds.height + 8);

    parent.addChild(text);
    this.tileCaption = text;
    this.tileCaptionTileId = tile.id;
    this.tileCaptionText = caption;
    this.tileCaptionFont = captionFont;
    this.tileCaptionFontSize = captionFontSize;
  }

  _hideTileCaption() {
    this.bShowingTileCaption = false;

    if (this.tileCaption && this.tileCaption != null) {
      this.tileCaption?.parent?.removeChild(this.tileCaption);
      this.tileCaption?.destroy();
    }
    this.tileCaption = null;
    this.tileCaptionTileId = null;
    this.tileCaptionText = "";
    this.tileCaptionFont = "";
    this.tileCaptionFontSize = 18;
  }

  _getTileTopLeftCoords(x, y, width, height){
    if(game.version >= 14){
      return {x: x - width / 2, y: y - height / 2};
    }
    return {x, y};
  }

  _getTileCoords(topLeftX, topLeftY, width, height){
    if(game.version >= 14){
      return {x: topLeftX + width / 2, y: topLeftY + height / 2};
    }
    return {x: topLeftX, y: topLeftY};
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
      const exploration = await fogExplorationCls.load({scene: scene, user: user});
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
      const sceneTiles = doc.parent?.tiles ?? canvas.scene?.tiles;
      const ids = tileIds.split(",").map(s => s.trim()).filter(Boolean);
      for (let id of ids) {
        let inverted = false;
        if(id[0] === '-'){
          inverted = true;
          id = id.slice(1);
        }
        const tile = sceneTiles?.get(id) ?? [...(sceneTiles ?? [])].find(tile =>
          String(tile?.flags?.merlin?.stableId ?? "").trim() === id);
        if (tile) {
          await tile.update({ alpha: (doc.hidden == inverted ? 1 : 0), hidden: false });
        }
      }
    }
  }

  _bindMerlinDocumentClickListener() {
    if (this._merlinDocumentClickListenerBound) return;
    this._merlinDocumentClickHandler = this._handleMerlinDocumentClick.bind(this);
    document.addEventListener("click", this._merlinDocumentClickHandler, true);
    this._merlinDocumentClickListenerBound = true;
    this._merlinTileClickTimers = new Map();
  }

  _cancelMerlinTileTrigger(tileId) {
    const timer = this._merlinTileClickTimers?.get(tileId);
    if (timer) {
      clearTimeout(timer);
      this._merlinTileClickTimers.delete(tileId);
    }
  }

  _handleMerlinDocumentClick(event) {
    if (!canvas?.ready || !canvas.scene || !canvas.app?.view?.contains(event.target)) return;
    if (event.button !== 0) return;
    if (ui.controls.control.name === "tiles") return;

    const {x, y} = canvas.canvasCoordinatesFromClient({x: event.clientX, y: event.clientY});
    const clickPoint = new PIXI.Point(x, y);
    const detail = Number(event.detail ?? 1);
    const tiles = canvas.tiles?.placeables ?? [];

    for (const tile of tiles) {
      const merlinFlags = tile?.document?.flags?.merlin;
      if (!merlinFlags?.active) continue;
      if (!this._tileContainsPoint(tile, clickPoint)) continue;
      if (tile?.document?.flags?.["merlin"]?.isPOI && !this.userPOIVisibility[game.userId]) continue;

      const triggers = merlinFlags.triggers ?? [];
      if (detail >= 2) {
        this._cancelMerlinTileTrigger(tile.id);
        if (triggers.includes("double click")) this._runMerlinTileTrigger(tile, null, "double click");
        continue;
      }

      if (!triggers.includes("click")) continue;
      this._cancelMerlinTileTrigger(tile.id);
      const timer = setTimeout(() => {
        this._merlinTileClickTimers.delete(tile.id);
        this._runMerlinTileTrigger(tile, null, "click");
      }, 260);
      this._merlinTileClickTimers.set(tile.id, timer);
    }
  }

  _tileContainsPoint(tile, point) {
    const shape = tile?.document?.shape;
    if (shape?.testPoint) return shape.testPoint(point);
    const topLeftCoords = game.merlin._getTileTopLeftCoords(tile.document.x, tile.document.y, tile.document.width, tile.document.height);
    const tileRect = new PIXI.Rectangle(topLeftCoords.x, topLeftCoords.y, tile.document.width, tile.document.height);
    return this._rectsIntersect(tileRect, new PIXI.Rectangle(point.x, point.y, 1, 1));
  }

  _runMerlinTileTrigger(tile, token = null, triggerType = "movement") {
    const merlinFlags = tile?.document?.flags?.merlin;
    if (!merlinFlags?.active) return;
    this.lastTriggerType = triggerType;

    const code = merlinFlags.runCode;
    if (code) {
      try {
        console.log(`Merlin | Running code for tile ${tile.id} triggered by ${triggerType}${token ? ` token ${token.id}` : ""}`);
        // eslint-disable-next-line no-eval
        eval(code);
      } catch (err) {
        console.error("Merlin | Error in runCode:", err);
        ui.notifications.error(`Merlin: Error in runCode for tile ${tile.id}`);
      }
    }

    // Deal with teleport tiles
    if (!token || !merlinFlags.teleportIn) return;

    const identifier = merlinFlags.teleportIdentifier;
    const destinations = Array.from(this.teleportTileIds[identifier] ?? []);
    if (destinations.length === 0) return;

    // Make sure we don't select the tile we are already on, if there are other options
    const checkedIndexes = new Set();
    let [sceneId, tileId] = ["", ""];
    while (checkedIndexes.size < destinations.length) {
      let randomIndex = Math.floor(Math.random() * destinations.length);
      while(checkedIndexes.has(randomIndex)) {
        randomIndex++;
        if(randomIndex >= destinations.length) randomIndex = 0;
      }
      checkedIndexes.add(randomIndex);
      [sceneId, tileId] = destinations[randomIndex].split(":");
      if (tileId !== tile.document._id) break;
    }
    if(tileId === tile.document._id || !sceneId || !tileId) return;

    if (!merlinFlags.relativeLocation) {
      this.teleportTokenToTile(tile.document.parent._id, sceneId, tileId, token.document._id);
    } else if (triggerType === "movement") {
      this.teleportTokenToTileRelative(tile.document.parent._id, tile.document._id, sceneId, tileId, token.document._id);
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
            this._runMerlinTileTrigger(tile, token, "movement");
          }
        } catch (err) {
          console.error("Merlin | Error processing tile:", err);
        }
      }

      this._hexcrawlOnUpdateToken(token.id, movement.destination, token.width, token.height);
    }
  }

  _checkMovementTrigger(token, tile, triggerType){    
    const prevMovement = this.prevMovementMap.get(token.document._id);
    if(!prevMovement) return false;
    const tokenWidth = token.document.width * canvas.grid.size;
    const tokenHeight = token.document.height * canvas.grid.size;
    const tileRect = new PIXI.Rectangle(tile.flags.merlin.topLeftX, tile.flags.merlin.topLeftY, tile.width, tile.height);    
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
  sceneMerlinRain = {};
  sceneMerlinWind = {};
  sceneMerlinTime = {};
  // Map of keys to filenames
  sceneBackgroundFilenames = {};
  sceneForegroundFilenames = {};
  sceneForgroundFOWFilenames = {};
  sceneRainOverlayFilenames = {noRain: [], light: [], heavy: []};
  currentBackgroundInfo = {};
  activeLevel = null;
  rainOverlays = [];
  
  async _getSceneControlButtons(controls){
    console.log("Merlin | Adding scene control buttons", controls);
    let bContainsPoiButton = false;
    if(canvas?.scene?.tiles){
      for (const tile of canvas?.scene?.tiles) {
        if (tile?.flags?.merlin?.isPOI === true) {
            bContainsPoiButton = true;
            break;
        }
      }
    }
    if(bContainsPoiButton){
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
    }

    this._configureHexcrawlSceneControls(controls);

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
    if(!backgroundPath) return;
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
    const hasRainTypes = new Set();
    hasRainTypes.add(backgroundInfo.rain);
    const hasWindTypes = new Set();
    hasWindTypes.add(backgroundInfo.wind);
    const hasTimes = new Set();
    hasTimes.add(backgroundInfo.time);
    this.sceneBackgroundFilenames = {};
    this.sceneForegroundFilenames = {};
    this.sceneForgroundFOWFilenames = {};
    let key = this._getKeyFromBackgroundInfo(backgroundInfo);
    this.sceneBackgroundFilenames[key] = backgroundPath;
    let fileBackgroundInfos = {};
    fileBackgroundInfos[key] = backgroundInfo;

    // Get all files in directory that share the same stem    
    const result = await foundry.applications.apps.FilePicker.browse("data", dir);
    const filenames = result.files.map(path => path.split("/").pop());
    
    let allValidFilenames = [];
    for(let f of filenames){      
      if(f === filename) continue;
      const fBackgroundInfo = this._getBackgroundTypeFromFilename(f);
      if(fBackgroundInfo.stem === backgroundInfo.stem){
        allValidFilenames.push(dir + "/" + f);
        if(fBackgroundInfo.isFG) {
          this.sceneForegroundFilenames[this._getKeyFromBackgroundInfo(fBackgroundInfo)] = dir + "/" + f;
          continue;
        }
        if(fBackgroundInfo.isFOW) {
          this.sceneForgroundFOWFilenames[this._getKeyFromBackgroundInfo(fBackgroundInfo)] = dir + "/" + f;
          continue;
        }
        hasStatic |= !fBackgroundInfo.isVideo;
        hasAnimated |= fBackgroundInfo.isVideo;
        if(fBackgroundInfo.rain) hasRainTypes.add(fBackgroundInfo.rain);
        if(fBackgroundInfo.wind) hasWindTypes.add(fBackgroundInfo.wind);
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
    canvas.scene.update({"flags.merlin.altImages": allValidFilenames});

    // Get any rain overlay filenames
    this.sceneRainOverlayFilenames = {noRain: [], light: [], heavy: []};
    if(canvas.scene.flags?.merlin?.rainOverlays){
      for(const rainFile of canvas.scene.flags?.merlin?.rainOverlays?.noRain ?? []){
        if(await this.assetExists(rainFile)) this.sceneRainOverlayFilenames.noRain.push(rainFile);
      }
      for(const rainFile of canvas.scene.flags?.merlin?.rainOverlays?.light ?? []){
        console.log('light', rainFile);
        if(await this.assetExists(rainFile)) this.sceneRainOverlayFilenames.light.push(rainFile);
      }
      for(const rainFile of canvas.scene.flags?.merlin?.rainOverlays?.heavy ?? []){
        console.log('heavy', rainFile);
        if(await this.assetExists(rainFile)) this.sceneRainOverlayFilenames.heavy.push(rainFile);
      }
      if(this.sceneRainOverlayFilenames.light.length > 0){
        hasRainTypes.add("rain");
      }
      if(this.sceneRainOverlayFilenames.heavy.length > 0){
        hasRainTypes.add("heavyRain");
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
          const sameTimeKey = this._getKeyFromBackgroundInfo({ ...bgInfo, rain: "none", wind: "none" });
          const sameWeatherKey = this._getKeyFromBackgroundInfo({ ...bgInfo, time: "day" });
          const sameWeatherTimeVideoKey = this._getKeyFromBackgroundInfo({ ...bgInfo, isVideo: !bgInfo.isVideo });
          const sameTimeVideoKey = this._getKeyFromBackgroundInfo({ ...bgInfo, rain: "none", wind: "none", isVideo: !bgInfo.isVideo });
          const sameWeatherVideoKey = this._getKeyFromBackgroundInfo({ ...bgInfo, time: "day", isVideo: !bgInfo.isVideo });
          fgPath = this.sceneForegroundFilenames[sameWeatherTimeKey] || this.sceneForegroundFilenames[sameTimeKey] || this.sceneForegroundFilenames[sameWeatherKey] 
            || this.sceneForegroundFilenames[sameWeatherTimeVideoKey] || this.sceneForegroundFilenames[sameTimeVideoKey] || this.sceneForegroundFilenames[sameWeatherVideoKey]
            || Object.values(this.sceneForegroundFilenames)[0] || null;
        }
        sceneForegroundFallbacks[key] = fgPath;
      }
      this.sceneForegroundFilenames = sceneForegroundFallbacks;
    }

    // Create a mapping of fallback fog images for each background, prioritizing same weather and time, then same time, then same weather, then any
    if(Object.keys(this.sceneForgroundFOWFilenames).length > 1){
      let sceneForgroundFOWFallbacks = {};
      for(let key in this.sceneBackgroundFilenames){
        const bgInfo = this._getBackgroundTypeFromFilename(this.sceneBackgroundFilenames[key].split("/").pop());
        let fowPath = null;
        if(this.sceneForgroundFOWFilenames[key]){
          fowPath = this.sceneForgroundFOWFilenames[key];
        }
        else{
          const sameWeatherTimeKey = this._getKeyFromBackgroundInfo(bgInfo);
          const sameTimeKey = this._getKeyFromBackgroundInfo({ ...bgInfo, rain: "none", wind: "none" });
          const sameWeatherKey = this._getKeyFromBackgroundInfo({ ...bgInfo, time: "day" });
          const sameWeatherTimeVideoKey = this._getKeyFromBackgroundInfo({ ...bgInfo, isVideo: !bgInfo.isVideo });
          const sameTimeVideoKey = this._getKeyFromBackgroundInfo({ ...bgInfo, rain: "none", wind: "none", isVideo: !bgInfo.isVideo });
          const sameWeatherVideoKey = this._getKeyFromBackgroundInfo({ ...bgInfo, time: "day", isVideo: !bgInfo.isVideo });
          fowPath = this.sceneForgroundFOWFilenames[sameWeatherTimeKey] || this.sceneForgroundFOWFilenames[sameTimeKey] || this.sceneForgroundFOWFilenames[sameWeatherKey] 
            || this.sceneForgroundFOWFilenames[sameWeatherTimeVideoKey] || this.sceneForgroundFOWFilenames[sameTimeVideoKey] || this.sceneForgroundFOWFilenames[sameWeatherVideoKey]
            || Object.values(this.sceneForgroundFOWFilenames)[0] || null;
        }
        sceneForgroundFOWFallbacks[key] = fowPath;
      }
      this.sceneForgroundFOWFilenames = sceneForgroundFOWFallbacks;
    }

    // Determine target background for this scene
    this.currentBackgroundInfo = backgroundInfo;
    let desiredBackgroundInfo = {};
    if(this.globalMerlinWeatherEnabled){
      if(!this.globalMerlinRain){
        this.globalMerlinRain = backgroundInfo.rain;
      }
      if(!this.globalMerlinWind){
        this.globalMerlinWind = backgroundInfo.wind;
      }
      if(!this.globalMerlinTime){
        this.globalMerlinTime = backgroundInfo.time;
      }
      desiredBackgroundInfo.rain = this.globalMerlinRain;
      desiredBackgroundInfo.wind = this.globalMerlinWind;
      desiredBackgroundInfo.time = this.globalMerlinTime;
    }
    else{
      if(!this.sceneMerlinRain[canvas.scene.id]){
        this.sceneMerlinRain[canvas.scene.id] = backgroundInfo.rain;
      }      
      if(!this.sceneMerlinWind[canvas.scene.id]){
        this.sceneMerlinWind[canvas.scene.id] = backgroundInfo.wind;
      }
      if(!this.sceneMerlinTime[canvas.scene.id]){
        this.sceneMerlinTime[canvas.scene.id] = backgroundInfo.time;
      }
      desiredBackgroundInfo.rain = this.sceneMerlinRain[canvas.scene.id];
      desiredBackgroundInfo.wind = this.sceneMerlinWind[canvas.scene.id];
      desiredBackgroundInfo.time = this.sceneMerlinTime[canvas.scene.id];
    }
    desiredBackgroundInfo.isVideo = this.usersUseMerlinVideo[game.userId] ?? backgroundInfo.isVideo;
    // Attempt to switch to it if we have a suitable background, else fall back to the current background
    this._updateBackground(desiredBackgroundInfo);

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

          let desiredBackgroundInfo = {...this.currentBackgroundInfo};
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
        toggle: game.version < 14,
        active: this.currentBackgroundInfo.time === "night" ?? false,
        onChange: (toggle) => {
          let desiredBackgroundInfo = {...this.currentBackgroundInfo};
          desiredBackgroundInfo.time = this.currentBackgroundInfo.time === "day" ? "night" : "day";
          console.log("Merlin | " + "Switching time to " + desiredBackgroundInfo.time);
          this._updateBackground(desiredBackgroundInfo);
        }
      };
      controls.lighting.tools[timeSelect.name] = timeSelect;

      // Hide default day/night controls
      delete controls.lighting.tools.day;
      delete controls.lighting.tools.night;
    }
    
    if(hasRainTypes.size > 1) {
      let states = ["none"];
      if(hasRainTypes.has("rain")){
        states.push("rain");
      }
      if(hasRainTypes.has("heavyRain")){
        states.push("heavyRain");
      }
      const weatherSelect = {
        name: "selectMerlinWeather",
        title: "Switch Rain",
        icon: "fas fa-cloud-rain",
        button: hasRainTypes.size === 3,
        toggle: hasRainTypes.size === 2,
        active: (hasRainTypes.size === 2 && this.currentBackgroundInfo.rain !== "none"),
        onChange: (toggle) => {          
          const current = this.currentBackgroundInfo.rain;
          const currentIndex = states.indexOf(current);
          const next = states[(currentIndex + 1) % states.length];
          let desiredBackgroundInfo = {...this.currentBackgroundInfo};
          desiredBackgroundInfo.rain = next;
          this._updateBackground(desiredBackgroundInfo);
        }
      };
      controls.lighting.tools[weatherSelect.name] = weatherSelect;
    }

    if(hasWindTypes.size > 1) {
      let states = ["none"];
      if(hasWindTypes.has("wind")){
        states.push("wind");
      }
      if(hasWindTypes.has("highWind")){
        states.push("highWind");
      }
      const windSelect = {
        name: "selectMerlinWind",
        title: "Switch Wind",
        icon: "fas fa-wind",
        button: hasWindTypes.size === 3,
        toggle: hasWindTypes.size === 2,
        active: (hasWindTypes.size === 2 && this.currentBackgroundInfo.wind !== "none"),
        onChange: (toggle) => {
          const current = this.currentBackgroundInfo.wind;
          const currentIndex = states.indexOf(current);
          const next = states[(currentIndex + 1) % states.length];
          let desiredBackgroundInfo = {...this.currentBackgroundInfo};
          desiredBackgroundInfo.wind = next;
          console.log("Merlin | Switching wind to: " + next);
          this._updateBackground(desiredBackgroundInfo);
        }
      };
      controls.lighting.tools[windSelect.name] = windSelect;
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

  _getOrAddElement(id, parentId, isNewObj = { isNew: false }, append = true, insertBefore = null){    
    let element = document.getElementById(id);
    if (!element){
      const parent = document.getElementById(parentId);
      if(!parent){
        console.warn(`Merlin | Could not find parent element with id ${parentId} to attach ${id} to.`);
        return null;
      }
      element = document.createElement("div");
      element.id = id;
      isNewObj.isNew = true;
      if(append){
        parent.appendChild(element);
      }
      else{
        const insertBeforeElement = parent.querySelector("#" + insertBefore);
        parent.insertBefore(element, insertBeforeElement || parent.firstChild);          
      }
    }    
    return element;
  }

  _getBackgroundTypeFromFilename(filename){
    const ext = filename.split('.').pop().toLowerCase();
    const base = filename.substring(0, filename.lastIndexOf('.'));
    // Simple heuristic: if it's a video format, treat it as animated. Otherwise static.
    const videoFormats = ["mp4", "webm", "ogg"];
    const weatherTypes = new Map([
      ["rain", "rain"],
      ["heavyrain", "heavyRain"],
      ["wind", "wind"],
      ["highwind", "highWind"]
    ]);
    const times = new Map([
      ["day", "day"],
      ["night", "night"],
      ["dusk", "dusk"],
      ["dawn", "dawn"]
    ]);
    
    const parts = base.split("_");
    const stem = parts.slice(0, Math.max(1, parts.length-4)).join("_");
    const suffixes = parts.slice(Math.max(1, parts.length-4), parts.length);
    let rainType = "none";
    let windType = "none";
    let time = "day";
    let isFG = false;
    let isFOW = false;
    let miscSuffix = false;
    for(let s of suffixes){
      const normalized = s.toLowerCase();
      if(weatherTypes.has(normalized)){
        const weatherType = weatherTypes.get(normalized);
        if(weatherType === "rain" || weatherType === "heavyRain"){
          rainType = weatherType;
        }
        else{
          windType = weatherType;
        }
      }
      else if(times.has(normalized)){
        time = times.get(normalized);
      }
      else if(normalized === "fg"){
        isFG = true;
      }
      else if(normalized === "fow"){
        isFOW = true;
      }
      else{
        miscSuffix = true;
      }
    }
    
    return { 
      isVideo: videoFormats.includes(ext),
      isFG: isFG,
      isFOW: isFOW,
      rain: rainType,
      wind: windType,
      time: time,
      miscSuffix: miscSuffix,
      stem: stem,
      ext: ext
    }
  }

  _getActiveSceneVariantInfo(){
    if(!canvas.scene) return null;

    let backgroundPath = canvas.scene.background?.src ?? "";
    let activeLevel = null;
    if(game.version >= 14){
      activeLevel = canvas.scene.levels.get(canvas.scene._view);
      backgroundPath = activeLevel?.background?.src ?? backgroundPath;
    }

    const filename = backgroundPath.split("/").pop();
    const backgroundInfo = filename ? this._getBackgroundTypeFromFilename(filename) : {
      isVideo: false,
      rain: "none",
      wind: "none",
      time: "day"
    };

    return {
      backgroundPath,
      activeLevel,
      rain: this.sceneMerlinRain[canvas.scene.id] ?? backgroundInfo.rain,
      wind: this.sceneMerlinWind[canvas.scene.id] ?? backgroundInfo.wind,
      time: this.sceneMerlinTime[canvas.scene.id] ?? backgroundInfo.time,
      isVideo: this.usersUseMerlinVideo[game.userId] ?? backgroundInfo.isVideo
    };
  }

  async _resolveVariantPath(filePath, variantInfo = null){
    if(!filePath) return filePath;

    const parts = filePath.split("/");
    const filename = parts.pop();
    const dir = parts.join("/");
    if(!dir || !filename){
      return filePath;
    }

    const baseInfo = this._getBackgroundTypeFromFilename(filename);
    const targetInfo = {
      isVideo: variantInfo?.isVideo ?? baseInfo.isVideo,
      rain: variantInfo?.rain ?? baseInfo.rain,
      wind: variantInfo?.wind ?? baseInfo.wind,
      time: variantInfo?.time ?? baseInfo.time
    };

    try {
      const result = await foundry.applications.apps.FilePicker.browse("data", dir);
      let bestCandidate = filePath;
      let bestScore = [-1, -1, -1, -1];

      for(const path of result.files){
        const f = path.split("/").pop();
        if(f === filename) continue;

        const fInfo = this._getBackgroundTypeFromFilename(f);
        if(fInfo.stem !== baseInfo.stem) continue;
        if(fInfo.isFG) continue;

        const score = [
          fInfo.time === targetInfo.time ? 1 : 0,
          fInfo.rain === targetInfo.rain ? 1 : 0,
          fInfo.wind === targetInfo.wind ? 1 : 0,
          fInfo.isVideo === targetInfo.isVideo ? 1 : 0,
          fInfo.miscSuffix ? 0 : 1
        ];

        let isBetter = false;
        for(let i = 0; i < score.length; i++){
          if(score[i] > bestScore[i]){
            isBetter = true;
            break;
          }
          if(score[i] < bestScore[i]){
            break;
          }
        }

        if(isBetter){
          bestScore = score;
          bestCandidate = `${dir}/${f}`;
        }
      }

      return bestCandidate;
    } catch (err) {
      console.warn("Merlin | Failed to resolve popup image variant:", err);
      return filePath;
    }
  }

  async showPopupImage(filePath, options = {}){
    const variantInfo = this._getActiveSceneVariantInfo();
    const resolvedPath = await this._resolveVariantPath(filePath, variantInfo);
    const title = options.title ?? resolvedPath.split("/").pop();
    const safeTitle = foundry.utils.escapeHTML(title);
    const safePath = foundry.utils.escapeHTML(resolvedPath);

    new foundry.applications.apps.ImagePopout({
      src: safePath,
      window: {
          title: safeTitle
      }
    }).render(true);
  }

  _getKeyFromBackgroundInfo(backgroundInfo){
    return `${backgroundInfo.isVideo}_${backgroundInfo.rain}_${backgroundInfo.wind}_${backgroundInfo.time}`;
  }

  async _updateBackground(backgroundInfo){
    if(JSON.stringify(backgroundInfo) === JSON.stringify(this.currentBackgroundInfo)) return false;

    // De/activate night and rain sounds if any
    for(let sound of canvas.scene.sounds){
      if(sound.flags?.merlin?.nightSound){
        sound.update({hidden: backgroundInfo.time !== "night"});
      }
      if(sound.flags?.merlin?.rainSound){
        sound.update({hidden: backgroundInfo?.rain == "none" || backgroundInfo?.rain == ""});
      }
      if(sound.flags?.merlin?.windSound){
        sound.update({hidden: backgroundInfo?.wind == "none" || backgroundInfo?.wind == ""});
      }
    }

    // Update rain overlay, fallback to other rain type if needed
    this.clearOverlays();
    let newRainOverlays = [];
    if(backgroundInfo.rain == "none" && this.sceneRainOverlayFilenames.noRain.length > 0){
      newRainOverlays = this.sceneRainOverlayFilenames.noRain;
    }
    else if(backgroundInfo.rain == "rain"){
      if(this.sceneRainOverlayFilenames.light.length > 0) {
        newRainOverlays = this.sceneRainOverlayFilenames.light;
      }
      else if(this.sceneRainOverlayFilenames.heavy.length > 0) {
        newRainOverlays = this.sceneRainOverlayFilenames.heavy;
      }
    }
    if(backgroundInfo.rain == "heavyRain"){
      if(this.sceneRainOverlayFilenames.heavy.length > 0) {
        newRainOverlays = this.sceneRainOverlayFilenames.heavy;
      }
      else if(this.sceneRainOverlayFilenames.light.length > 0) {
        newRainOverlays = this.sceneRainOverlayFilenames.light;
      }
    }
    this.displayOverlays(newRainOverlays);

    // Update background, fallback to nearby weather variants if needed
    let targetKey = this._getKeyFromBackgroundInfo(backgroundInfo);
    let bChangedBG = false;
    if(!this.sceneBackgroundFilenames[targetKey]){
      const fallbackCandidates = [];
      const addCandidate = (candidate) => {
        const candidateKey = this._getKeyFromBackgroundInfo(candidate);
        if(!fallbackCandidates.some(entry => this._getKeyFromBackgroundInfo(entry) === candidateKey)){
          fallbackCandidates.push(candidate);
        }
      };
      const rainOrder = backgroundInfo.rain === "none"
        ? ["none", "rain", "heavyRain"]
        : [backgroundInfo.rain, backgroundInfo.rain === "rain" ? "heavyRain" : "rain", "none"];
      const windOrder = backgroundInfo.wind === "none"
        ? ["none", "wind", "highWind"]
        : [backgroundInfo.wind, backgroundInfo.wind === "wind" ? "highWind" : "wind", "none"];

      for(const rain of rainOrder){
        for(const wind of windOrder){
          addCandidate({ ...backgroundInfo, rain, wind });
        }
      }
      for(const candidate of fallbackCandidates){
        const candidateKey = this._getKeyFromBackgroundInfo(candidate);
        if(this.sceneBackgroundFilenames[candidateKey]){
          targetKey = candidateKey;
          break;
        }
      }
    }
    if(this.sceneBackgroundFilenames[targetKey]){
      let object = { background: { src: this.sceneBackgroundFilenames[targetKey] } };
      if(this.sceneForegroundFilenames[targetKey]){
        object.foreground = this.sceneForegroundFilenames[targetKey];
      }
      if(this.sceneForgroundFOWFilenames[targetKey]){
        object.fog = { overlay: this.sceneForgroundFOWFilenames[targetKey] };
      }
      // Update canvas images
      if(game.version >= 14 && !Object.entries(object).every(([key, value]) => this.activeLevel[key] === value)) {
        this.activeLevel.update(object);
      }
      else if(!Object.entries(object).every(([key, value]) => canvas.scene[key] === value)) {
        await canvas.scene.update(object);
      }

      bChangedBG = true;
    }

    this.currentBackgroundInfo = backgroundInfo;
    this.sceneMerlinTime[canvas.scene.id] = backgroundInfo.time;
    this.sceneMerlinRain[canvas.scene.id] = backgroundInfo.rain;
    this.sceneMerlinWind[canvas.scene.id] = backgroundInfo.wind;
    if(this.globalMerlinWeatherEnabled){
      this.globalMerlinTime = backgroundInfo.time;
      this.globalMerlinRain = backgroundInfo.rain;
      this.globalMerlinWind = backgroundInfo.wind;
      game.settings.set("merlins-miscellany", "globalMerlinRain", this.globalMerlinRain);
      game.settings.set("merlins-miscellany", "globalMerlinWind", this.globalMerlinWind);
      game.settings.set("merlins-miscellany", "globalMerlinTime", this.globalMerlinTime);
    }
    return bChangedBG;
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
    else if (data.action === "displayOverlays") {
      this.#displayOverlays(data.filepaths);
    }
    else if (data.action === "clearOverlays") {
      this.#clearOverlays();
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

  overlays = [];
  displayOverlays(filepaths) {    
    game.socket.emit("module.merlins-miscellany", {
      action: "displayOverlays",
      filepaths: filepaths
    });
    this.#displayOverlays(filepaths);
  }

  async #displayOverlays(filepaths) {
    while (this.bIsClearingOverlays) {
        await new Promise(resolve => setTimeout(resolve, interval));
    }
    
    for(const filepath of filepaths){
      let sprite;

      if (/\.(mp4|webm|ogg|mov)$/i.test(filepath)) {
          const video = document.createElement("video");

          video.src = filepath;
          video.loop = true;
          video.muted = true;
          video.autoplay = true;
          video.playsInline = true;

          await video.play();

          sprite = new PIXI.Sprite(PIXI.Texture.from(video));
      }
      else {
          sprite = PIXI.Sprite.from(filepath);
      }
      if(!sprite) return;

      sprite.position.set(canvas.dimensions.sceneX, canvas.dimensions.sceneY);
      sprite.width = canvas.dimensions.sceneWidth;
      sprite.height = canvas.dimensions.sceneHeight;

      canvas.interface.addChild(sprite);
      this.overlays.push(sprite);
    }
  }

  clearOverlays(){
    game.socket.emit("module.merlins-miscellany", {
      action: "clearOverlays"
    });
    this.#clearOverlays();
  }

  bIsClearingOverlays = false;
  #clearOverlays(){
    this.bIsClearingOverlays = true;
    for(const overlay of this.overlays){
      if(overlay){
        canvas.interface.removeChild(overlay);
        overlay.destroy();
      }
    }
    this.overlays = [];
    this.bIsClearingOverlays = false;
  }

  async assetExists(filepath) {
    try {
      const response = await fetch(filepath, {
        method: "HEAD"
      });

      return response.ok;
    } catch {
      return false;
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

  game.settings.register("merlins-miscellany", "globalMerlinWeatherEnabled", {
    name: "Global Merlin Weather",
    hint: "If enabled, Merlin's weather settings will be synchronised across all scenes. If disabled, each scene can have its own weather settings. (Must refresh to take effect.)",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register("merlins-miscellany", "globalMerlinRain", {
    name: "Global Merlin Rain String",
    hint: "Current rain to use for all Merlin scenes.",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
  game.settings.register("merlins-miscellany", "globalMerlinWind", {
    name: "Global Merlin Wind String",
    hint: "Current wind to use for all Merlin scenes.",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
  game.settings.register("merlins-miscellany", "globalMerlinTime", {
    name: "Global Merlin Time String",
    hint: "Current time to use for all Merlin scenes.",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
  game.merlin.globalMerlinWeatherEnabled = game.settings.get("merlins-miscellany", "globalMerlinWeatherEnabled");
  game.merlin.globalMerlinRain = game.settings.get("merlins-miscellany", "globalMerlinRain");
  game.merlin.globalMerlinWind = game.settings.get("merlins-miscellany", "globalMerlinWind");
  game.merlin.globalMerlinTime = game.settings.get("merlins-miscellany", "globalMerlinTime");

  registerHexcrawlSettings(game);
});
