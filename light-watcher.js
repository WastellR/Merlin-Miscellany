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
        template: "modules/merlins-miscellany/active-light-advanced.hbs"
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
    Hooks.on("updateAmbientLight", this._onUpdateLight.bind(this));
    Hooks.on("controlToken", this._onControlToken.bind(this));
    Hooks.on("updateToken", this._onUpdateToken.bind(this));
  }

  _onReady() {
    console.log("Merlin Module | Ready");

    // Extend ambient light sheet class with our custom class
    CONFIG.AmbientLight.sheetClasses.base['core.AmbientLightConfig'].cls = WithActiveLightConfig(CONFIG.AmbientLight.sheetClasses.base['core.AmbientLightConfig'].cls);

    if (game.user.isGM) {
      game.socket.on(`module.merlins-miscellany`, this._onSocket.bind(this));
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
  prevMovementMap = new Map();
  _onUpdateToken(scene, tokenData, updateData, options, userId) {
    if (updateData._movement?.[tokenData._id]) {
      this.prevMovementMap.set(tokenData._id, updateData._movement[tokenData._id]);
    }
  }

  _onSocket(data) {
    if (!game.user.isGM) return;

    if (data.action === "teleportToken") {
      this.#teleportTokenToTile(data.sourceSceneId, data.targetSceneId, data.targetTileId, data.tokenId);
    }
  }

  // Set of tokens currently being teleported
  teleportingTokenIds = new Set();
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
  // Internal implementation
  async #teleportTokenToTile(sourceSceneId, targetSceneId, targetTileId, tokenId) {
    if(this.teleportingTokenIds.has(tokenId)){
      return;
    }
    this.teleportingTokenIds.add(tokenId);

    const sourceScene = game.scenes.get(sourceSceneId);
    const targetScene = game.scenes.get(targetSceneId);
    const targetTile = targetScene.tiles.get(targetTileId);
    const token = sourceScene.tokens.get(tokenId);

    const snapped = targetScene.grid.getSnappedPosition(targetTile.x, targetTile.y, 1);
    
    // Duplicate the token document
    const duplToken = foundry.utils.duplicate(token);
    duplToken.x = snapped.x - duplToken.width / 2;
    duplToken.y = snapped.y - duplToken.height / 2;
    
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
      game.multilevel.refreshAll();
    }, 100);

    this.teleportingTokenIds.delete(tokenId);
  }
}

// Register our hook + sheet override
Hooks.once("init", () => {
  console.log("Merlin Module | Initializing");
  game.merlin = new Merlin();
});
