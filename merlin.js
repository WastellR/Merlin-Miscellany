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
  
  // The scene control (left-side control buttons) that was previously active
  prevActiveControl = "";
  async _onReady() {
    console.log("Merlin Module | Ready");

    // Extend ambient light sheet class with our custom class
    CONFIG.AmbientLight.sheetClasses.base['core.AmbientLightConfig'].cls = WithActiveLightConfig(CONFIG.AmbientLight.sheetClasses.base['core.AmbientLightConfig'].cls);

    const { WithActiveTileConfig } = await import("/modules/monks-active-tiles/apps/active-tile-config.js");
    const oldSheetClass = CONFIG.Tile.sheetClasses.base['core.TileConfig'].cls;
    const ActiveTileConfig = WithActiveTileConfig(oldSheetClass);

    // Declare our custom TileConfig class
    const MerlinActiveTileConfig = (TileConfig) => {
      class MerlinTileConfig extends ActiveTileConfig {
        /** @override */
        // Use our custom HTML instead
        static PARTS = {
          ...super.PARTS,
          appearance: { template: "modules/merlins-miscellany/templates/appearance.hbs" }
        };       

        async _processSubmitData(event, form, submitData, options = {}) {
          const isPOI = foundry.utils.getProperty(submitData.flags, "merlin.isPOI") ?? false;
          super._processSubmitData(event, form, submitData, options);          
          foundry.utils.setProperty(this.document.flags, "merlin.isPOI", isPOI);
        }

        /** @override */
        getData(options) {
          const data = super.getData(options);
          data.source.flags = foundry.utils.mergeObject(data.source.flags ?? {}, {
            "merlin": {
              isPOI: this.document.getFlag("merlin", "isPOI") ?? "",
            }
          });
          return data;
        }
        
        // Remove the extra 'save template' button that gets added when we extend ActiveTileConfig
        // for some fucking reason
        async _prepareContext(options) {
          const context = await super._prepareContext(options);
          context.buttons.splice(0, 1);
          return context;
        }
      }

      Object.defineProperty(MerlinTileConfig.prototype.constructor, "name", { value: "MerlinTileConfig" });
      return MerlinTileConfig;
    };
    
    // Extend monk's tile sheet class with custom class
    CONFIG.Tile.sheetClasses.base['core.TileConfig'].cls = MerlinActiveTileConfig(oldSheetClass);

    if (game.user.isGM) {
      game.socket.on(`module.merlins-miscellany`, this._onSocket.bind(this));
    }

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
    }
  }

  userPOIVisibility = {};
  // The weather and time settings for this scene, if any
  sceneMerlinWeather = {};
  sceneMerlinTime = {};
  // Map of keys to filenames
  sceneBackgroundFilenames = {};
  sceneForegroundFilenames = {};
  currentBackgroundInfo = {};
  
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

    // Split into directory + filename
    if(!canvas.scene) return;
    const backgroundPath = canvas.scene.background.src;
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
    const targetKey = this._getKeyFromBackgroundInfo(this.currentBackgroundInfo);
    if(this.sceneBackgroundFilenames[targetKey]){
      let object = { background: { src: this.sceneBackgroundFilenames[targetKey] } };
      if(this.sceneForegroundFilenames[targetKey]){
        object.foreground = this.sceneForegroundFilenames[targetKey];
      }
      await canvas.scene.update(object);
    }
    else{
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

    if(hasTimes.size > 1){
      const timeSelect = {
        name: "selectMerlinTime",
        title: "Switch Time of Day",
        icon: "fas fa-sun",
        toggle: true,
        active: this.currentBackgroundInfo.time === "day" ?? false,
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
      await canvas.scene.update(object);

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
    if (!game.user.isGM) return;

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
    const snapped = targetScene.grid.getSnappedPosition(targetTile.x, targetTile.y, 1);
    
    this.#teleportTokenToPosition(sourceSceneId,targetSceneId, snapped, tokenId);
  }

   async #teleportTokenToTileRelative(sourceSceneId, sourceTileId, targetSceneId, targetTileId, tokenId) {
    const sourceScene = game.scenes.get(sourceSceneId);
    const sourceTile = sourceScene.tiles.get(sourceTileId);
    const targetScene = game.scenes.get(targetSceneId);
    const targetTile = targetScene.tiles.get(targetTileId);
    const token = sourceScene.tokens.get(tokenId);

    const relativeX = token.x - sourceTile.x;
    const relativeY = token.y - sourceTile.y;
    const snapped = targetScene.grid.getSnappedPosition(targetTile.x + relativeX, targetTile.y + relativeY, 1);
    
    this.#teleportTokenToPosition(sourceSceneId,targetSceneId, snapped, tokenId);
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

    // For any users controlling the original token, pull them to the new scene
    const actor = game.actors.get(duplToken.actorId);
    const owners = actor ? game.users.filter(u => actor.testUserPermission(u, "OWNER")) : [];
    await owners.forEach(user => {
      if(!(user.isGM && !this.GMControlledTokenIds.has(tokenId))){
        // Players will keep control of their token automatically.
        // GMs need to manually take control of the new token after the canvas is loaded.
        if(user.isGM){
          Hooks.once("canvasReady", (canvas) => {
            const newToken = canvas.tokens.get(created[0]._id);
            newToken.control();
          });
        }
        game.socket.emit("pullToScene", targetScene.id, user.id);
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
    this.teleportedTokenIds.add(created[0]._id);
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
