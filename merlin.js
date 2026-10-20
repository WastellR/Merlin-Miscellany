import { Hexcrawl, registerHexcrawlSettings } from "./hexcrawl.js";
import { createMerlinSceneConfig } from "./sceneconfig.js";

// Zoomed in, Merlin renders only the part of the scene we're looking at (see _updateMerlinView).
// How long after asking Merlin for a new part to wait before showing the stream as that part, while its frames catch up
const MERLIN_VIEW_APPLY_DELAY_MS = 250;
// Foundry lines the stream up with a new view when the stream's frames visibly change (see _applyMerlinViewWhenFramesChange).
// Average difference (0-255) between a frame and the one before, sampled very small, that counts as the view having changed
const MERLIN_VIEW_CHANGE_THRESHOLD = 4;
// If no change is seen by then, line up anyway
const MERLIN_VIEW_APPLY_TIMEOUT_MS = 1000;
// Every change of view makes Merlin hitch (new detail has to stream in, and its lighting and anti-aliasing history are
// disturbed), so while panning and zooming it changes at most this often, and only when it has to. The settle time is
// how long the canvas must be still before checking whether zooming in has left the view much bigger than needed
const MERLIN_VIEW_THROTTLE_MS = 300;
const MERLIN_VIEW_SETTLE_MS = 350;
// How much of the on-screen size to add on each side of the part of the scene we ask for. Each change of view shows in
// Merlin as the camera jumping, so there is just the one margin: a wide one while moving that was sharpened up when still
// made the camera jump out and then back in.
const MERLIN_VIEW_PADDING = 0.12;
// Once the canvas is still, the part we asked for is asked for again if it is more than this many times the size of what's
// on screen plus the margin (i.e. after zooming in). While moving, only running out of the part we asked for matters.
const MERLIN_VIEW_SETTLED_MAX_OVERSIZE = 1.3;
// With this much of the scene's width and height on screen, Merlin just renders the whole image
const MERLIN_VIEW_WHOLE_FRACTION = 0.95;

// The weather window's sliders, by the name Merlin knows them by, with how many steps each has
const MERLIN_WEATHER_STEPS = { timeOfDay: 288, rain: 100, windStrength: 100 };

// The buttons Merlin adds to the lighting controls which set the weather, temperature and time
const MERLIN_LIGHTING_TOOLS = ["selectMerlinTime", "selectMerlinWeather", "selectMerlinWind", "selectMerlinTemperature"];

// Value names for the levels of Merlin's video settings
const MERLIN_QUALITY_LABELS = ["Low", "Medium", "High", "Epic", "Cinematic"];
const MERLIN_OFF_QUALITY_LABELS = ["Off", "Low", "Medium", "High", "Epic", "Cinematic"];
const MERLIN_POST_PROCESSING_LABELS = ["Low", "Medium", "High", "Very High", "Highest"];
// Temperature presets, coolest to hottest
const MERLIN_TEMPERATURES = {
  freezing: { label: "Freezing", icon: "fa-snowflake", alpha: 0.3 },
  cold: { label: "Cold", icon: "fa-temperature-low", alpha: 0.2 },
  normal: { label: "Normal", icon: "fa-temperature-half", alpha: 0.2 },
  hot: { label: "Hot", icon: "fa-temperature-high", alpha: 0.2 },
  boiling: { label: "Boiling", icon: "fa-fire", alpha: 0.3 }
};

// The sliders in Merlin's video settings window, in order: [name Merlin knows it by, label, highest value, value names, values].
// Where values is given, the slider's positions stand for those values in Merlin rather than for 0, 1, 2...
const MERLIN_VIDEO_SLIDERS = [
  ["viewDistance", "View Distance", 4, ["Near", "Medium", "Far", "Epic", "Cinematic"]],
  ["aaQuality", "Anti-Aliasing Quality", 4, MERLIN_OFF_QUALITY_LABELS],
  ["aaMode", "Anti-Aliasing Mode", 4, ["Off", "FXAA", "TAA", "MSAA", "TSR"]],
  ["postProcessing", "Post Processing", 4, MERLIN_POST_PROCESSING_LABELS],
  ["shadowQuality", "Shadow Quality", 4, MERLIN_QUALITY_LABELS],
  ["textureQuality", "Texture Quality", 4, MERLIN_QUALITY_LABELS],
  ["foliageQuality", "Foliage Quality", 4, MERLIN_QUALITY_LABELS],
  ["shadingQuality", "Shading Quality", 4, MERLIN_QUALITY_LABELS],
  ["motionBlur", "Motion Blur", 4, MERLIN_QUALITY_LABELS],
  ["effects", "Effects", 4, MERLIN_OFF_QUALITY_LABELS],
  ["globalIllumination", "Global Illumination", 4, MERLIN_OFF_QUALITY_LABELS],
  ["ambientOcclusion", "Ambient Occlusion", 3, MERLIN_OFF_QUALITY_LABELS],
  ["screenSpaceReflections", "Screen Space Reflections", 4, MERLIN_POST_PROCESSING_LABELS],
  ["volumetricFog", "Volumetric Fog", 4, MERLIN_OFF_QUALITY_LABELS],
  ["resolutionScale", "Render Resolution", 5, ["50%", "60%", "70%", "80%", "90%", "100%"], [50, 60, 70, 80, 90, 100]],
  ["frameRateLimit", "Frame Rate Limit", 4, ["15 FPS", "30 FPS", "45 FPS", "60 FPS", "Unlimited"], [15, 30, 45, 60, 0]]
];
const MERLIN_VIDEO_CHECKBOXES = [
  ["vsync", "VSync"],
  ["dynamicShadows", "Dynamic Shadows"],
  ["contactShadows", "Contact Shadows"],
  ["subsurfaceScattering", "Subsurface Scattering"]
];

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
    Hooks.on("canvasPan", () => this._updateTileCaptionResolution());
    Hooks.on("renderSceneNavigation", this._onRenderSceneNavigation.bind(this));
    Hooks.on("updateAmbientLight", this._onUpdateLight.bind(this));
    Hooks.on("updateWall", this._onUpdateWall.bind(this));
    Hooks.on("renderWallConfig", this._onRenderWallConfig.bind(this));
    Hooks.on("controlToken", this._onControlToken.bind(this));
    Hooks.on("updateToken", this._onUpdateToken.bind(this));
    Hooks.on("getSceneControlButtons", this._getSceneControlButtons.bind(this));
    Hooks.on("updateTile", this._onUpdateTile.bind(this));
    Hooks.on("updateScene", this._onUpdateScene.bind(this));
    Hooks.on("hoverTile", this._onHoverTile.bind(this));
    Hooks.on("renderSettings", this._onRenderSettings.bind(this));
    Hooks.on("renderPlayers", () => this._positionMerlinStatusWidget());
    Hooks.on("renderSceneControls", () => this._updateMerlinLightingControls());
    // Before Foundry destroys the scene's canvas: put its own background back on the mesh so that it is released with it
    Hooks.on("canvasTearDown", () => {
      this._restoreSceneBackground(false);
      // The weather and temperature overlays are children of the canvas that Foundry is about to destroy, which doesn't free their
      // textures, so the videos among them would keep playing. Free them here.
      this.#clearOverlays();
      this._temperatureApplyId++;
      this._clearTemperature();
    });

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
  // Status of the local Merlin instance: null if it isn't running, else "disconnected" | "waiting" | "linked".
  merlinStatus = null;
  // The last status response from Merlin, including its download/level progress. Null if Merlin isn't running.
  merlinInfo = null;
  // True from the GM pressing "Connect to Merlin" until they press "Disconnect Merlin" (or Merlin ends the link).
  // While enabled we look for Merlin, link to it as soon as it's found, then stop polling once linked.
  merlinEnabled = false;
  _merlinPollTimer = null;
  // True once we've asked Merlin to link (or found it waiting for the user), so that a drop back to
  // "disconnected" means the user declined
  _merlinLinkRequested = false;
  _merlinStatusObserver = null;
  // The video settings window, while open: { element, snapshot, current, recommended, queue }
  _merlinSettings = null;
  // The PixelStreaming connection to Merlin, if any: { url, streamerId, ps, parent, video, texture }
  merlinStream = null;
  // The scene's original background texture, while it's replaced by Merlin's stream
  _originalBackground = null;
  // While zoomed in, Merlin renders just the part of the scene we're looking at, so the stream isn't upscaled.
  // The part we last asked for ({x, y, width, height} as fractions of the scene), or null for the whole scene
  _merlinViewRequest = null;
  // The part of the scene the stream actually shows (same units), as last reported by Merlin; null for the whole scene
  _merlinAppliedView = null;
  _merlinViewTimer = null;
  _merlinViewApplyTimer = null;
  _merlinViewInFlight = false;
  _merlinViewDirty = false;

  get _merlinUrl() {
    const port = game.settings.get("merlins-miscellany", "merlinServerPort");
    return `http://127.0.0.1:${port}`;
  }

  // Returns Merlin's link status, or null if it can't be reached
  async _fetchMerlinStatus() {
    try {
      const response = await fetch(`${this._merlinUrl}/ping`, { signal: AbortSignal.timeout(1500) });
      if (!response.ok) return null;
      return this._readMerlinResponse(await response.json());
    } catch (err) {
      return null;
    }
  }

  _setMerlinStatus(status) {
    if (status === this.merlinStatus) return;
    this.merlinStatus = status;
    console.log(`Merlin | Merlin status: ${status ?? "not running"}`);
    // The settings window is only for a live link, however the link ended
    if (status !== "linked") {
      this._closeMerlinSettings();
      this._closeMerlinWeather();
    }
  }

  // The merlin.merlinPackageId / merlin.merlinLevelId flags identify which Merlin package and level a scene corresponds to.
  // merlin.merlinCameraId is the name of the camera in that level which Merlin should render.
  _getMerlinSceneData() {
    const packages = new Set();
    for (const scene of game.scenes) {
      const packageId = scene.flags?.merlin?.merlinPackageId ?? "";
      if (packageId) packages.add(packageId);
    }
    return {
      packages: [...packages],
      packageId: canvas.scene?.flags?.merlin?.merlinPackageId ?? "",
      levelId: canvas.scene?.flags?.merlin?.merlinLevelId ?? "",
      cameraId: canvas.scene?.flags?.merlin?.merlinCameraId ?? ""
    };
  }

  // text/plain keeps these CORS "simple requests" (no preflight); Merlin parses the body as JSON regardless.
  async _postToMerlin(path) {
    console.log('body', JSON.stringify(this._getMerlinSceneData()));
    const response = await fetch(`${this._merlinUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(this._getMerlinSceneData()),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return this._readMerlinResponse(await response.json());
  }

  // Reads Merlin's status response, which also tells us where to find its video stream. Returns the link status.
  // delayView is for the response to a request to change the part of the scene Merlin renders: the stream takes a moment
  // to show the new view, so wait until it does before lining the texture up with it.
  _readMerlinResponse(json, delayView = false) {
    const status = json?.status ?? null;
    this.merlinInfo = json;
    if (delayView) {
      this._applyMerlinViewWhenFramesChange(json?.streamRegion, json?.viewRect);
    } else if (!this._merlinViewPending) {
      this._setMerlinStreamView(json?.streamRegion, json?.viewRect);
    }
    this._notifyMerlinPackageErrors(json?.packageErrors);
    const linked = status === "linked" && json.streamUrl;
    this._updateMerlinStream(linked ? json.streamUrl : null, json.streamerId);
    return status;
  }

  // What to tell the user when Merlin couldn't get a package
  _describeMerlinPackageError(error) {
    switch (error.reason) {
      case "notEntitled": {
        const tier = error.tier ? ` at tier '${error.tier}'` : "";
        const link = error.url ? `; get it here: ${error.url}` : "";
        return `This map requires a subscription to '${error.creator || "its creator"}'${tier}${link}`;
      }
      case "noAuth":
        return `This map ('${error.packageId}') requires a Patreon subscription. Log in to Patreon in Merlin to download it.`;
      case "incompatible":
        return `Package '${error.packageId}' was made with a different version of the Merlin SDK than this version of Merlin can read, so it can't be loaded. Its creator needs to make it again.`;
      case "notFound":
        return `Package '${error.packageId}' isn't available from the Merlin server.`;
      default:
        return `Merlin couldn't download package '${error.packageId}'.`;
    }
  }

  // Merlin reports packages it couldn't download on every status response; tell the user once per package
  _notifyMerlinPackageErrors(errors) {
    this._merlinPackageErrors = errors ?? [];
    this._notifiedMerlinErrors ??= new Set();
    for (const error of this._merlinPackageErrors) {
      const key = `${error.packageId}|${error.reason}`;
      if (this._notifiedMerlinErrors.has(key)) continue;
      this._notifiedMerlinErrors.add(key);
      ui.notifications.error(`Merlin: ${this._describeMerlinPackageError(error)}`, { permanent: true });
    }
  }

  // Merlin streams its camera view via PixelStreaming; we show it as the current scene's background.
  async _updateMerlinStream(url, streamerId) {
    if (!url) return this._stopMerlinStream();
    if (this.merlinStream?.url === url && this.merlinStream?.streamerId === streamerId) return;
    this._stopMerlinStream();

    // Claim the slot synchronously so concurrent responses don't start a second stream
    const stream = this.merlinStream = { url, streamerId, ps: null, parent: null, video: null, texture: null };
    try {
      const { Config, PixelStreaming, Logger, LogLevel } = await import("./lib/pixelstreamingfrontend.js");
      // The library logs every data channel message at Info level, with a stack trace each time
      Logger.InitLogging(LogLevel.Warning, false);
      if (this.merlinStream !== stream) return;

      // Kept in the DOM and technically rendered (browsers may stop delivering frames for display:none or
      // fully transparent video), but 2px, almost transparent and behind everything. The video is only a source
      // for the scene background texture; its on-screen size doesn't affect the texture.
      stream.parent = document.createElement("div");
      stream.parent.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0.01;z-index:-1;pointer-events:none;";
      // Not a child of <body>: Foundry lays body out as a flex row alongside #interface, so a stray child could squash it
      document.documentElement.appendChild(stream.parent);

      const config = new Config({
        useUrlParams: false,
        initialSettings: {
          ss: url,
          StreamerId: streamerId,
          AutoConnect: true,
          AutoPlayVideo: true,
          StartVideoMuted: true,
          WaitForStreamer: true,
          // Merlin's signalling server never answers the frontend's keepalive pings, which would make the frontend
          // drop the connection as timed out every minute. It's a localhost connection, so it doesn't need one.
          KeepaliveDelay: 0,
          MaxReconnectAttempts: 100
        }
      });
      stream.ps = new PixelStreaming(config, { videoElementParent: stream.parent });

      // Whatever the library creates, make sure no video it owns ends up visible in Foundry's UI
      stream.observer = new MutationObserver(() => this._parkMerlinStreamVideo(stream));
      stream.observer.observe(document.documentElement, { childList: true, subtree: true });
      stream.ps.addEventListener("videoInitialized", () => {
        this._parkMerlinStreamVideo(stream);
        console.log("Merlin | Merlin video stream connected");
        this._applyMerlinStreamBackground();
        this._updateMerlinView(true);
      });
      stream.ps.addEventListener("webRtcDisconnected", () => {
        this._restoreSceneBackground();
        // The stream dropping is how we find out Merlin has closed, as we no longer poll once linked
        if (this.merlinStream === stream) this._checkMerlinAfterStreamLoss();
      });
      // A stream that can't be (re)established at all, e.g. the signalling server is gone because Merlin crashed
      stream.ps.addEventListener("webRtcFailed", () => {
        if (this.merlinStream === stream) this._checkMerlinAfterStreamLoss();
      });
    } catch (err) {
      console.error("Merlin | Failed to start Merlin video stream:", err);
      if (this.merlinStream === stream) this._stopMerlinStream();
    }
  }

  // Moves the library's video element into our off-screen holder and finds it for use as a texture source
  _parkMerlinStreamVideo(stream) {
    for (const video of document.querySelectorAll("video#streamingVideo")) {
      if (video.parentElement !== stream.parent) {
        console.log("Merlin | Moving stream video out of", video.parentElement);
        stream.parent.appendChild(video);
      }
      for (const [prop, value] of Object.entries({ position: "absolute", left: "0", top: "0", width: "2px", height: "2px", "pointer-events": "none" })) {
        video.style.setProperty(prop, value, "important");
      }
      video.muted = true;
      video.playsInline = true;
      stream.video = video;
    }
  }

  _stopMerlinStream() {
    const stream = this.merlinStream;
    if (!stream) return;
    this.merlinStream = null;
    stream.observer?.disconnect();
    clearTimeout(this._merlinViewTimer);
    clearTimeout(this._merlinSettleTimer);
    this._cancelMerlinViewWatch();
    this._merlinViewTimer = this._merlinSettleTimer = null;
    this._merlinViewRequest = this._merlinAppliedView = null;
    this._restoreSceneBackground();
    // disconnect() doesn't stop the library reconnecting by itself, so a Merlin which has gone away would keep being
    // retried (and logging refused connections) forever. It only auto-reconnects while this is above zero.
    try { stream.ps?.config?.setNumericSetting("MaxReconnectAttempts", 0); } catch (err) { /* setting not available */ }
    try { stream.ps?.disconnect(); } catch (err) { console.warn("Merlin | Error closing Merlin video stream:", err); }
    stream.texture?.destroy?.(false);
    stream.parent?.remove();
    this._updateMerlinSceneDisplayed();
  }

  // The mesh showing the current scene's (or level's) background image
  get _sceneBackgroundMesh() {
    return canvas.primary?.background ?? null;
  }

  // Replaces the current scene's background with Merlin's video stream
  _applyMerlinStreamBackground() {
    const stream = this.merlinStream;
    const mesh = this._sceneBackgroundMesh;
    if (!stream?.video || !mesh || mesh.destroyed) return;

    // Scenes with no Merlin package/level keep their own background; the connection stays open for other scenes
    const merlinFlags = canvas.scene?.flags?.merlin;
    if (!merlinFlags?.merlinPackageId && !merlinFlags?.merlinLevelId) {
      this._restoreSceneBackground();
      return;
    }
    const video = stream.video;

    // A SpriteMesh's size is derived from its texture's size, which is zero until the video's metadata arrives
    if (!video.videoWidth || !video.videoHeight) {
      if (!stream.waitingForMetadata) {
        stream.waitingForMetadata = true;
        video.addEventListener("loadedmetadata", () => {
          stream.waitingForMetadata = false;
          if (this.merlinStream === stream) this._applyMerlinStreamBackground();
        }, { once: true });
      }
      return;
    }

    if (!stream.texture) {
      // load() hooks up the play/pause listeners that keep the texture updating with each new video frame
      // (autoLoad must stay enabled, or the texture would stay on the first frame). We start playback ourselves.
      const resource = new PIXI.VideoResource(video, { autoPlay: false });
      stream.texture = new PIXI.Texture(new PIXI.BaseTexture(resource));
      // Re-fit if the stream's resolution changes (e.g. the Merlin window is resized); the resource resizes itself
      video.addEventListener("resize", () => {
        if (this.merlinStream !== stream) return;
        this._applyMerlinStreamRegion();
        this._fitSceneBackgroundMesh(this._sceneBackgroundMesh);
      });
    }
    if (!this._originalBackground || this._originalBackground.mesh !== mesh) {
      this._originalBackground = { mesh, texture: mesh.texture, visible: mesh.visible };
      // If the scene's own background is a video, it is hidden behind the stream from here on, so don't have it decoding frames
      this._setOriginalBackgroundPlaying(false);
    }

    mesh.texture = stream.texture;
    mesh.visible = true;
    this._applyMerlinStreamRegion();
    this._fitSceneBackgroundMesh(mesh);
    video.play?.().catch(() => {});
  }

  // Merlin streams its whole window, which has black bars around the image of a camera with its own aspect ratio. It
  // tells us which part of the window holds the image (as fractions of its width and height), and we show only that part
  // of the video. Cropping the stream itself instead meant its size changing with each camera, which crashed Merlin.
  _applyMerlinStreamRegion() {
    const stream = this.merlinStream;
    const video = stream?.video;
    if (!stream?.texture || !video?.videoWidth || !video?.videoHeight) return;

    const width = video.videoWidth;
    const height = video.videoHeight;
    const region = this._merlinStreamRegion;
    const valid = region && region.width > 0 && region.height > 0;
    const frame = valid
      ? new PIXI.Rectangle(
        Math.round(region.x * width), Math.round(region.y * height),
        Math.max(1, Math.round(region.width * width)), Math.max(1, Math.round(region.height * height)))
      : new PIXI.Rectangle(0, 0, width, height);

    const current = stream.texture.frame;
    if (current.x === frame.x && current.y === frame.y && current.width === frame.width && current.height === frame.height) return;
    stream.texture.frame = frame;
    this._fitSceneBackgroundMesh(this._sceneBackgroundMesh);
  }

  _isSameMerlinView(region, view) {
    const whole = { x: 0, y: 0, width: 1, height: 1 };
    const normal = rect => (rect?.width > 0 && rect?.height > 0 ? rect : whole);
    const same = (a, b) => ["x", "y", "width", "height"].every(key => Math.abs(normal(a)[key] - normal(b)[key]) < 0.0005);
    return same(region, this._merlinStreamRegion) && same(view, this._merlinAppliedView);
  }

  _cancelMerlinViewWatch() {
    if (this._merlinViewWatch) this._merlinViewWatch.cancelled = true;
    this._merlinViewWatch = null;
    clearTimeout(this._merlinViewApplyTimer);
    this._merlinViewApplyTimer = null;
    this._merlinViewPending = false;
  }

  // Merlin changes what it renders as soon as it is asked to, but the new frames reach us some time later, by an amount that
  // varies. Lining the texture up with the new view before they arrive (or after) makes the picture jump, so watch the
  // stream and line up on the first frame that looks different from the one before it. Falls back to a timer if the
  // browser can't tell us about frames, and to a timeout if the view changes too little to see.
  _applyMerlinViewWhenFramesChange(region, view) {
    this._cancelMerlinViewWatch();
    if (this._isSameMerlinView(region, view)) return;

    const apply = () => {
      this._cancelMerlinViewWatch();
      this._setMerlinStreamView(region, view);
    };
    this._merlinViewPending = true;
    this._merlinViewApplyTimer = setTimeout(apply, MERLIN_VIEW_APPLY_TIMEOUT_MS);

    const video = this.merlinStream?.video;
    // For testing: localStorage.setItem("merlin.noFrameWatch", "true") and reload uses the fixed delay instead
    if (!video?.requestVideoFrameCallback || !video.videoWidth || localStorage.getItem("merlin.noFrameWatch") === "true") {
      clearTimeout(this._merlinViewApplyTimer);
      this._merlinViewApplyTimer = setTimeout(apply, MERLIN_VIEW_APPLY_DELAY_MS);
      return;
    }

    const width = 32;
    const height = 18;
    if (!this._merlinFrameSampler) {
      const sampleCanvas = document.createElement("canvas");
      sampleCanvas.width = width;
      sampleCanvas.height = height;
      this._merlinFrameSampler = sampleCanvas.getContext("2d", { willReadFrequently: true });
    }
    const sampler = this._merlinFrameSampler;
    const sample = () => {
      sampler.drawImage(video, 0, 0, width, height);
      return sampler.getImageData(0, 0, width, height).data;
    };

    const watch = this._merlinViewWatch = { cancelled: false };
    let previous = sample();
    const onFrame = () => {
      if (watch.cancelled) return;
      const current = sample();
      let total = 0;
      for (let i = 0; i < current.length; i += 4) {
        total += Math.abs(current[i] - previous[i]) + Math.abs(current[i + 1] - previous[i + 1]) + Math.abs(current[i + 2] - previous[i + 2]);
      }
      if (total / (width * height * 3) >= MERLIN_VIEW_CHANGE_THRESHOLD) return apply();
      previous = current;
      video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
  }

  // Lines the stream up with the part of the window and of the scene Merlin says it holds
  _setMerlinStreamView(region, view) {
    this._merlinStreamRegion = region ?? null;
    this._merlinAppliedView = view?.width > 0 && view?.height > 0 ? view : null;
    this._applyMerlinStreamRegion();
    this._fitSceneBackgroundMesh(this._sceneBackgroundMesh);
  }

  // The part of the scene on screen, as fractions of the scene's size, or null if none of the scene is
  _visibleSceneFractions() {
    const d = canvas.dimensions;
    const stage = canvas.stage;
    if (!d || !stage || !canvas.app?.screen) return null;
    const scale = stage.scale.x;
    const width = canvas.app.screen.width / scale;
    const height = canvas.app.screen.height / scale;
    const left = stage.pivot.x - width / 2;
    const top = stage.pivot.y - height / 2;
    const x0 = Math.max(0, (left - d.sceneX) / d.sceneWidth);
    const y0 = Math.max(0, (top - d.sceneY) / d.sceneHeight);
    const x1 = Math.min(1, (left + width - d.sceneX) / d.sceneWidth);
    const y1 = Math.min(1, (top + height - d.sceneY) / d.sceneHeight);
    return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
  }

  _isWholeSceneVisible(visible) {
    return !visible
      || ((visible.x1 - visible.x0) >= MERLIN_VIEW_WHOLE_FRACTION && (visible.y1 - visible.y0) >= MERLIN_VIEW_WHOLE_FRACTION);
  }

  // Whether the part of the scene we asked Merlin for no longer suits what's on screen: it doesn't cover it any more, or
  // it's so much bigger than it that the stream is being wasted
  _merlinViewNeedsUpdate(visible, requested, settled) {
    if (this._isWholeSceneVisible(visible)) return !!requested;
    if (!requested) return true;
    const epsilon = 0.002;
    const covers = visible.x0 >= requested.x - epsilon && visible.y0 >= requested.y - epsilon
      && visible.x1 <= requested.x + requested.width + epsilon && visible.y1 <= requested.y + requested.height + epsilon;
    const fitFactor = (1 + 2 * MERLIN_VIEW_PADDING) * MERLIN_VIEW_SETTLED_MAX_OVERSIZE;
    const tooBig = settled && (requested.width > (visible.x1 - visible.x0) * fitFactor
      || requested.height > (visible.y1 - visible.y0) * fitFactor);
    return !covers || tooBig;
  }

  // Called as the canvas pans and zooms. Looks at it now and then while it moves, and once more when it has stopped.
  _scheduleMerlinViewUpdate() {
    if (this.merlinStatus !== "linked") return;
    clearTimeout(this._merlinSettleTimer);
    this._merlinSettleTimer = setTimeout(() => {
      this._merlinSettleTimer = null;
      this._updateMerlinView(false, true);
    }, MERLIN_VIEW_SETTLE_MS);
    if (this._merlinViewTimer) return;
    this._merlinViewTimer = setTimeout(() => {
      this._merlinViewTimer = null;
      this._updateMerlinView();
    }, MERLIN_VIEW_THROTTLE_MS);
  }

  // Asks Merlin to render just the part of the scene that's on screen (plus a margin), so that zooming in shows more of
  // the stream's pixels rather than stretching the whole image. Merlin replies with the part it will actually render,
  // which can differ from what we asked for (it matches the window's shape, and stays within the image).
  // force sends the request again even if the last one still suits.
  async _updateMerlinView(force = false, settled = false) {
    if (this.merlinStatus !== "linked" || !this.merlinStream?.video || !canvas.ready) return;
    const merlinFlags = canvas.scene?.flags?.merlin;
    if (!merlinFlags?.merlinPackageId && !merlinFlags?.merlinLevelId) return;

    // With adaptive zoom off, Merlin streams the whole image; all that is left to do is take back any view already asked for
    const enabled = game.settings.get("merlins-miscellany", "adaptiveZoom");
    const visible = this._visibleSceneFractions();
    const needsUpdate = enabled ? this._merlinViewNeedsUpdate(visible, this._merlinViewRequest, settled) : !!this._merlinViewRequest;
    if (!needsUpdate && !(force && this._merlinViewRequest)) return;
    if (this._merlinViewInFlight) {
      // Try again once the request in flight is done
      this._merlinViewDirty = true;
      this._merlinViewDirtySettled ||= settled;
      return;
    }

    let request = null;
    if (enabled && !this._isWholeSceneVisible(visible)) {
      const padX = (visible.x1 - visible.x0) * MERLIN_VIEW_PADDING;
      const padY = (visible.y1 - visible.y0) * MERLIN_VIEW_PADDING;
      request = { x: visible.x0 - padX, y: visible.y0 - padY, width: visible.x1 - visible.x0 + 2 * padX, height: visible.y1 - visible.y0 + 2 * padY };
    }

    this._merlinViewInFlight = true;
    this._merlinViewRequest = request;
    try {
      const response = await fetch(`${this._merlinUrl}/view`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(request ?? { x: 0, y: 0, width: 0, height: 0 }),
        signal: AbortSignal.timeout(3000)
      });
      if (response.ok && this.merlinStatus === "linked") this._readMerlinResponse(await response.json(), true);
    } catch (err) {
      console.warn("Merlin | Failed to send view to Merlin:", err);
    } finally {
      this._merlinViewInFlight = false;
      if (this._merlinViewDirty) {
        const dirtySettled = this._merlinViewDirtySettled;
        this._merlinViewDirty = this._merlinViewDirtySettled = false;
        this._updateMerlinView(false, dirtySettled);
      }
    }
  }

  // The camera's part of the window can change after Merlin has answered (it works it out once the camera is in place),
  // so for a few seconds after a scene is sent, ask for the status again to pick it up. Doesn't re-send the scene.
  _startMerlinRegionPoll() {
    this._merlinRegionPollUntil = Date.now() + 8000;
    if (this._merlinRegionTimer) return;
    const tick = async () => {
      this._merlinRegionTimer = null;
      if (!this.merlinEnabled || this.merlinStatus !== "linked") return;
      if (Date.now() > this._merlinRegionPollUntil) {
        // Merlin may have opened its level and camera since we last told it what part of the scene we're looking at
        this._updateMerlinView(true);
        return;
      }
      await this._fetchMerlinStatus();
      if (this.merlinEnabled && Date.now() <= this._merlinRegionPollUntil) {
        this._merlinRegionTimer = setTimeout(tick, 500);
      }
    };
    this._merlinRegionTimer = setTimeout(tick, 500);
  }

  // Positions and sizes the mesh to cover the scene rectangle, as Foundry does for the background image. Merlin's stream
  // may hold just part of the scene (when zoomed in), in which case the mesh covers only that part.
  _fitSceneBackgroundMesh(mesh) {
    if (!mesh || mesh.destroyed) return;
    const d = canvas.dimensions;
    const view = mesh.texture === this.merlinStream?.texture ? this._merlinAppliedView : null;
    const { x, y, width, height } = view ?? { x: 0, y: 0, width: 1, height: 1 };
    mesh.position.set(d.sceneX + x * d.sceneWidth, d.sceneY + y * d.sceneHeight);
    mesh.width = width * d.sceneWidth;
    mesh.height = height * d.sceneHeight;
  }

  // Gives the scene back its own background. Foundry only knows about the texture its background mesh holds, so if the scene is
  // torn down while the mesh holds the stream instead, the scene's own background (a video, which keeps playing and decoding
  // until it is destroyed) is never released: one more of them is left playing in the page for every scene visited.
  // resume is false when the scene is about to be destroyed anyway.
  _restoreSceneBackground(resume = true) {
    const original = this._originalBackground;
    this._originalBackground = null;
    if (!original || original.mesh.destroyed) return;
    original.mesh.texture = original.texture;
    original.mesh.visible = original.visible;
    this._fitSceneBackgroundMesh(original.mesh);
    if (resume) this._setOriginalBackgroundPlaying(true, original.texture);
  }

  // Pauses or resumes the scene's own background if it is a video
  _setOriginalBackgroundPlaying(playing, texture = this._originalBackground?.texture) {
    const video = game.video?.getVideoSource?.(texture);
    if (!video) return;
    if (playing) video.play()?.catch?.(() => {});
    else video.pause();
  }

  // Tell Merlin about the new scene whenever the scene changes
  async _sendMerlinSceneUpdate() {
    if (this.merlinStatus !== "linked") return;
    try {
      this._handleMerlinStatus(await this._postToMerlin("/scene"));
      this._startMerlinRegionPoll();
      // A new scene starts out showing the whole image
      this._updateMerlinView(true);
    } catch (err) {
      console.error("Merlin | Failed to send scene to Merlin:", err);
      this._handleMerlinStatus(await this._fetchMerlinStatus());
    }
  }

  // Starts looking for Merlin, and links to it as soon as it's found
  _connectToMerlin() {
    if (!game.user.isGM || this.merlinEnabled) return;
    this.merlinEnabled = true;
    sessionStorage.setItem("merlin.connect", "true");
    this._merlinLinkRequested = false;
    this._updateMerlinUI();
    this._pollMerlin();
  }

  // Stops polling and drops the link. If unlink is set, also tells Merlin to end puppet mode.
  _disconnectFromMerlin(unlink = false) {
    if (unlink && this.merlinStatus !== null) this._postUnlinkToMerlin();
    this.merlinEnabled = false;
    sessionStorage.removeItem("merlin.connect");
    this._merlinLinkRequested = false;
    clearTimeout(this._merlinPollTimer);
    this._merlinPollTimer = null;
    clearTimeout(this._merlinRegionTimer);
    this._merlinRegionTimer = null;
    this._stopMerlinStream();
    this.merlinInfo = null;
    this._merlinPackageErrors = [];
    this._notifiedMerlinErrors?.clear();
    this._setMerlinStatus(null);
    this._updateMerlinUI();
  }

  _postUnlinkToMerlin() {
    fetch(`${this._merlinUrl}/unlink`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" })
      .catch(() => {});
  }

  _scheduleMerlinPoll(delay) {
    clearTimeout(this._merlinPollTimer);
    this._merlinPollTimer = this.merlinEnabled ? setTimeout(() => this._pollMerlin(), delay) : null;
  }

  async _pollMerlin() {
    this._merlinPollTimer = null;
    const status = await this._fetchMerlinStatus();
    if (!this.merlinEnabled) return;
    this._handleMerlinStatus(status);
    // Merlin was already linked (e.g. after a Foundry refresh); make sure it has the current scene
    if (status === "linked") this._sendMerlinSceneUpdate();
  }

  // Reacts to Merlin's status, whichever request it came from. Polling only continues while we're searching for
  // Merlin, waiting for its user to confirm, or while it's downloading/loading; once linked and idle it stops.
  _handleMerlinStatus(status) {
    if (!this.merlinEnabled) return;
    const previous = this.merlinStatus;
    if (status === null) {
      this.merlinInfo = null;
      this._stopMerlinStream();
    }
    this._setMerlinStatus(status);
    this._updateMerlinUI();

    if (status === null) {
      // Not found (or lost); keep looking
      this._merlinLinkRequested = false;
      this._scheduleMerlinPoll(5000);
      return;
    }

    if (status === "disconnected") {
      if (previous === "linked" || this._merlinLinkRequested) {
        // Merlin ended the link, or its user declined it. Don't badger them with another prompt.
        ui.notifications.warn(previous === "linked" ? "Merlin disconnected." : "Merlin: link was declined.");
        this._disconnectFromMerlin();
      } else {
        this._requestMerlinLink();
      }
    } else if (status === "waiting") {
      // Merlin is asking its user to confirm
      if (!this._merlinLinkRequested) ui.notifications.info("Waiting for Merlin user to confirm...");
      this._merlinLinkRequested = true;
      this._scheduleMerlinPoll(1000);
    } else if (status === "linked") {
      if (previous !== "linked") ui.notifications.info("Linked to Merlin.");
      this._merlinLinkRequested = false;
      const info = this.merlinInfo;
      const busy = info?.downloadingPackages?.length || info?.loadingLevel;
      if (busy) this._scheduleMerlinPoll(1000);
      // Merlin hasn't got its level and camera in place yet when it links (or while it's downloading or loading), so the
      // part of its window holding the camera's image isn't known yet. Keep asking until it is, and for a while after.
      if (previous !== "linked" || busy) this._startMerlinRegionPoll();
    }
  }

  async _requestMerlinLink() {
    this._merlinLinkRequested = true;
    try {
      this._handleMerlinStatus(await this._postToMerlin("/link"));
    } catch (err) {
      console.error("Merlin | Failed to link to Merlin:", err);
      this._handleMerlinStatus(await this._fetchMerlinStatus());
    }
  }

  // The video stream dropped: either Merlin closed, or the connection blipped. Ask Merlin once to find out which.
  async _checkMerlinAfterStreamLoss() {
    if (!this.merlinEnabled || this.merlinStatus !== "linked" || this._checkingMerlinLoss) return;
    this._checkingMerlinLoss = true;
    try {
      // Merlin can be too busy to answer for a moment (e.g. loading a heavy level), so ask twice before giving up on it
      let status = await this._fetchMerlinStatus();
      if (status === null) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        if (!this.merlinEnabled) return;
        status = await this._fetchMerlinStatus();
      }

      if (status === null) {
        // It was linked and now can't be reached: Merlin has closed or crashed. Don't keep looking for it (or let the
        // stream keep retrying a refused connection); disconnect, and the user can connect again when it's back.
        ui.notifications.warn("Merlin disconnected.");
        this._disconnectFromMerlin();
      } else if (status !== "linked") {
        this._handleMerlinStatus(status);
      }
    } finally {
      this._checkingMerlinLoss = false;
    }
  }

  // The Merlin entry point in the settings sidebar tab
  _onRenderSettings(app, html) {
    if (!game.user.isGM) return;
    const root = html instanceof HTMLElement ? html : html[0];
    const invitations = root?.querySelector('button[data-app="invitations"]');
    if (!invitations || root.querySelector("#merlin-connect-button")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.id = "merlin-connect-button";
    button.innerHTML = `<i class="fa-solid fa-hat-wizard"></i> <span></span>`;
    button.addEventListener("click", () => {
      if (this.merlinEnabled) this._disconnectFromMerlin(true);
      else this._connectToMerlin();
    });
    invitations.before(button);
    this._updateMerlinUI();
  }

  _getMerlinStatusDisplay() {
    switch (this.merlinStatus) {
      case "linked": return { css: "linked", label: "Connected" };
      case "waiting":
      case "disconnected": return { css: "waiting", label: "Waiting for User" };
      default: return { css: "notfound", label: "Not Found" };
    }
  }

  _updateMerlinUI() {
    const label = document.querySelector("#merlin-connect-button span");
    if (label) label.textContent = this.merlinEnabled ? "Disconnect Merlin" : "Connect to Merlin";
    this._renderMerlinStatusWidget();
    this._updateMerlinSceneDisplayed();
  }

  // The status icon beside the active players box, with extra detail once connected. Only exists while connecting/connected.
  _renderMerlinStatusWidget() {
    let widget = document.getElementById("merlin-status");
    if (!this.merlinEnabled) {
      widget?.remove();
      this._merlinStatusObserver?.disconnect();
      this._merlinStatusObserver = null;
      return;
    }

    if (!widget) {
      widget = document.createElement("div");
      widget.id = "merlin-status";
      widget.innerHTML = `
        <div class="merlin-status-icon"><i class="fa-solid fa-hat-wizard"></i></div>
        <div class="merlin-status-weather" data-tooltip="Merlin Weather" data-tooltip-direction="UP" hidden><i class="fa-solid fa-cloud-sun-rain"></i></div>
        <div class="merlin-status-details">
          <div class="merlin-status-bar"><div class="merlin-status-bar-fill"></div></div>
          <div class="merlin-status-line merlin-status-downloading"></div>
          <div class="merlin-status-line merlin-status-loading"></div>
          <div class="merlin-status-line merlin-status-error" hidden></div>
        </div>`;
      // The settings are only available once linked
      widget.querySelector(".merlin-status-icon").addEventListener("click", () => {
        if (this.merlinStatus === "linked") this._toggleMerlinSettings();
      });
      widget.querySelector(".merlin-status-weather").addEventListener("click", () => {
        if (this.merlinStatus === "linked") this._toggleMerlinWeather();
      });
      document.documentElement.appendChild(widget);
    }

    const display = this._getMerlinStatusDisplay();
    const icon = widget.querySelector(".merlin-status-icon");
    icon.className = `merlin-status-icon ${display.css}`;
    icon.dataset.tooltip = `Merlin: ${display.label}`;
    icon.dataset.tooltipDirection = "UP";

    const linked = this.merlinStatus === "linked";
    const info = this.merlinInfo ?? {};
    const packages = info.downloadingPackages ?? [];
    widget.classList.toggle("linked", linked);
    icon.classList.toggle("clickable", linked);

    const busy = packages.length > 0 || !!info.loadingLevel;
    const bar = widget.querySelector(".merlin-status-bar");
    bar.hidden = !busy;
    bar.querySelector(".merlin-status-bar-fill").style.width = `${Math.round((info.downloadProgress ?? 0) * 100)}%`;

    const setLine = (selector, text) => {
      const line = widget.querySelector(selector);
      line.textContent = text;
      line.hidden = !text;
    };
    const fileCount = info.downloadFileCount ?? 0;
    const fileProgress = fileCount > 1 ? ` (${info.downloadFileIndex}/${fileCount})` : "";
    setLine(".merlin-status-downloading", info.waitingForPatreonLogin
      ? "Waiting for you to log in to Patreon in your browser..."
      : packages.length ? `Downloading${fileProgress}: ${info.downloadingFile || packages.join(", ")}` : "");
    setLine(".merlin-status-loading", info.loadingLevel ? `Loading: ${info.loadingLevel}` : "");

    // Why the scene's package couldn't be had, with a link to where to get it
    const errorLine = widget.querySelector(".merlin-status-error");
    errorLine.replaceChildren();
    const error = (this._merlinPackageErrors ?? [])[0];
    errorLine.hidden = !error;
    if (error) {
      const message = this._describeMerlinPackageError(error);
      const url = error.reason === "notEntitled" && /^https:\/\//.test(error.url ?? "") ? error.url : "";
      if (url && message.endsWith(url)) {
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = url;
        errorLine.append(message.slice(0, -url.length), link);
      } else {
        errorLine.textContent = message;
      }
      errorLine.title = message;
    }

    // Only takes up room while there's something to show
    widget.classList.toggle("has-details", linked && (busy || !!info.waitingForPatreonLogin || !!error));

    // The settings window is only for a live link
    widget.querySelector(".merlin-status-weather").hidden = !linked;
    if (linked) {
      this._updateMerlinSettingsLevel();
      this._onMerlinLevelMaybeChanged();
    } else {
      this._closeMerlinSettings();
      this._closeMerlinWeather();
    }

    this._positionMerlinStatusWidget();
  }

  _toggleMerlinSettings() {
    if (this._merlinSettings) this._closeMerlinSettings();
    else this._openMerlinSettings();
  }

  // "Merlin Level: ..." at the foot of the settings window
  _updateMerlinSettingsLevel() {
    const label = this._merlinSettings?.element.querySelector(".merlin-settings-level");
    if (!label) return;
    const info = this.merlinInfo ?? {};
    label.textContent = `Level: ${info.loadingLevel || info.loadedLevel || "None"}`;
  }

  // Reads or writes Merlin's video settings. Writes are queued so that they reach Merlin in the order they were made.
  _requestMerlinSettings(body) {
    const send = async () => {
      const response = await fetch(`${this._merlinUrl}/settings`, body === undefined
        ? { signal: AbortSignal.timeout(5000) }
        : { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    };
    const state = this._merlinSettings;
    if (!state || body === undefined) return send();
    return state.queue = state.queue.catch(() => {}).then(send);
  }

  async _openMerlinSettings() {
    if (this._merlinSettings) return;
    const state = this._merlinSettings = { element: null, snapshot: null, current: null, recommended: false, queue: Promise.resolve() };
    let data;
    try {
      data = await this._requestMerlinSettings();
    } catch (err) {
      console.error("Merlin | Failed to read Merlin's settings:", err);
      ui.notifications.warn("Couldn't read Merlin's video settings.");
      if (this._merlinSettings === state) this._merlinSettings = null;
      return;
    }
    // Closed (or Merlin disconnected) while we were waiting
    if (this._merlinSettings !== state) return;

    state.snapshot = this._pickMerlinSettings(data);
    state.current = data;
    state.element = this._buildMerlinSettingsWindow(state);
    document.body.appendChild(state.element);
    this._applyMerlinSettingsToWindow(state);
    this._updateMerlinSettingsLevel();
  }

  // Just the settings which the user can change (and undo)
  _pickMerlinSettings(data) {
    return { values: { ...data.values } };
  }

  // Whether the settings differ from the last ones applied
  _merlinSettingsChanged(state) {
    return JSON.stringify(this._pickMerlinSettings(state.current)) !== JSON.stringify(state.snapshot);
  }

  // Closing doesn't apply anything: changes that weren't applied are taken back
  _closeMerlinSettings() {
    const state = this._merlinSettings;
    if (!state) return;
    this._merlinSettings = null;
    state.element?.remove();
    // If Merlin is gone, there's nothing to tell
    if (state.element && (state.recommended || this._merlinSettingsChanged(state))) {
      fetch(`${this._merlinUrl}/settings`, {
        method: "POST", headers: { "Content-Type": "text/plain" },
        // The recommended settings changed the engine's settings directly; applying the user's puts them back
        body: JSON.stringify({ values: state.snapshot.values, commit: state.recommended })
      }).catch(() => {});
    }
  }

  // Sends a change to Merlin and takes up what it says the settings are now
  async _changeMerlinSettings(change, { refreshAll = false } = {}) {
    const state = this._merlinSettings;
    if (!state) return;
    try {
      const data = await this._requestMerlinSettings(change);
      if (this._merlinSettings !== state) return;
      state.current = refreshAll ? data : { ...state.current, preset: data.preset, recommended: data.recommended };
      this._applyMerlinSettingsToWindow(state);
      return data;
    } catch (err) {
      console.error("Merlin | Failed to change Merlin's settings:", err);
      ui.notifications.warn("Couldn't change Merlin's video settings.");
    }
  }

  // Slider positions to and from the values Merlin has
  _merlinSliderPosition(spec, value) {
    const map = spec[4];
    if (!map) return Math.min(Math.max(Number(value) || 0, 0), spec[2]);
    let best = 0;
    map.forEach((v, i) => { if (Math.abs(v - value) < Math.abs(map[best] - value)) best = i; });
    return best;
  }

  _merlinSliderValue(spec, position) {
    return spec[4] ? spec[4][position] : position;
  }

  _buildMerlinSettingsWindow(state) {
    const el = document.createElement("div");
    el.id = "merlin-settings";
    const slider = ([key, label, max]) => `
      <div class="merlin-settings-row" data-key="${key}">
        <label>${label}</label>
        <div class="merlin-settings-slider">
          <button type="button" data-step="-1"><i class="fa-solid fa-chevron-left"></i></button>
          <input type="range" min="0" max="${max}" step="1">
          <button type="button" data-step="1"><i class="fa-solid fa-chevron-right"></i></button>
          <span class="merlin-settings-value"></span>
        </div>
      </div>`;
    const checkbox = ([key, label]) => `
      <label class="merlin-settings-check"><input type="checkbox" data-key="${key}"> ${label}</label>`;
    el.innerHTML = `
      <header class="merlin-settings-header">
        <span><i class="fa-solid fa-hat-wizard"></i> Merlin Video Settings</span>
        <a class="merlin-settings-close" data-tooltip="Close"><i class="fa-solid fa-xmark"></i></a>
      </header>
      <div class="merlin-settings-body">
        <div class="merlin-settings-row">
          <label>Quality Preset</label>
          <select class="merlin-settings-preset"></select>
        </div>
        <a class="merlin-settings-advanced-toggle"><i class="fa-solid fa-chevron-right"></i> Advanced</a>
        <div class="merlin-settings-advanced" hidden>
          ${MERLIN_VIDEO_SLIDERS.map(slider).join("")}
          <div class="merlin-settings-checks">${MERLIN_VIDEO_CHECKBOXES.map(checkbox).join("")}</div>
        </div>
      </div>
      <footer class="merlin-settings-footer">
        <span class="merlin-settings-level"></span>
        <button type="button" class="merlin-settings-undo">Undo Changes</button>
        <button type="button" class="merlin-settings-apply">Apply</button>
      </footer>`;

    el.querySelector(".merlin-settings-close").addEventListener("click", () => this._closeMerlinSettings());
    this._makeMerlinSettingsDraggable(el, el.querySelector(".merlin-settings-header"));

    el.querySelector(".merlin-settings-advanced-toggle").addEventListener("click", event => {
      const advanced = el.querySelector(".merlin-settings-advanced");
      advanced.hidden = !advanced.hidden;
      event.currentTarget.querySelector("i").className = `fa-solid fa-chevron-${advanced.hidden ? "right" : "down"}`;
    });

    el.querySelector(".merlin-settings-preset").addEventListener("change", event => {
      const preset = event.target.value;
      if (preset === "Custom") return;
      if (preset === "Recommended") {
        state.recommended = true;
        this._changeMerlinSettings({ recommended: true });
      } else {
        state.recommended = false;
        this._changeMerlinSettings({ preset }, { refreshAll: true });
      }
    });
    el.querySelector(".merlin-settings-apply").addEventListener("click", async () => {
      const data = await this._changeMerlinSettings({ commit: true });
      // What's applied now is what Undo and closing go back to. The recommended settings aren't saved, so they stay as they are.
      if (data && !state.recommended) state.snapshot = this._pickMerlinSettings(state.current);
      if (data) this._applyMerlinSettingsToWindow(state);
    });
    el.querySelector(".merlin-settings-undo").addEventListener("click", () => {
      const wasRecommended = state.recommended;
      state.recommended = false;
      this._changeMerlinSettings({ values: state.snapshot.values, commit: wasRecommended }, { refreshAll: true });
    });

    const setValue = (key, value) => {
      state.recommended = false;
      state.current.values[key] = value;
      this._changeMerlinSettings({ values: { [key]: value } });
      this._applyMerlinSettingsToWindow(state);
    };
    for (const spec of MERLIN_VIDEO_SLIDERS) {
      const key = spec[0];
      const row = el.querySelector(`.merlin-settings-row[data-key="${key}"]`);
      const input = row.querySelector("input[type=range]");
      // Show the new value while dragging, but only tell Merlin once it's let go
      input.addEventListener("input", () => {
        state.current.values[key] = this._merlinSliderValue(spec, Number(input.value));
        this._applyMerlinSettingsToWindow(state);
      });
      input.addEventListener("change", () => setValue(key, this._merlinSliderValue(spec, Number(input.value))));
      for (const button of row.querySelectorAll("button[data-step]")) {
        button.addEventListener("click", () => {
          const count = spec[2] + 1;
          const position = (Number(input.value) + Number(button.dataset.step) + count) % count;
          setValue(key, this._merlinSliderValue(spec, position));
        });
      }
    }
    for (const input of el.querySelectorAll("input[type=checkbox][data-key]")) {
      input.addEventListener("change", () => setValue(input.dataset.key, input.checked));
    }
    return el;
  }

  // Shows the current settings in the window
  _applyMerlinSettingsToWindow(state) {
    const el = state.element;
    const data = state.current;
    if (!el || !data) return;

    for (const spec of MERLIN_VIDEO_SLIDERS) {
      const row = el.querySelector(`.merlin-settings-row[data-key="${spec[0]}"]`);
      const position = this._merlinSliderPosition(spec, data.values[spec[0]]);
      row.querySelector("input[type=range]").value = position;
      row.querySelector(".merlin-settings-value").textContent = spec[3][position] ?? "Unknown";
    }
    for (const input of el.querySelectorAll("input[type=checkbox][data-key]")) {
      input.checked = !!data.values[input.dataset.key];
    }

    // The preset which the settings amount to; "Recommended" if that was chosen, and "Custom" if it's none
    const preset = el.querySelector(".merlin-settings-preset");
    const selected = state.recommended ? "Recommended" : data.preset;
    const names = [...MERLIN_QUALITY_LABELS];
    if (data.recommended) names.push("Recommended");
    if (selected === "Custom") names.push("Custom");
    preset.replaceChildren(...names.map(n => new Option(n, n)));
    preset.value = selected;

    const changed = this._merlinSettingsChanged(state);
    el.querySelector(".merlin-settings-undo").disabled = !changed && !state.recommended;
    el.querySelector(".merlin-settings-apply").disabled = !changed && !state.recommended;
  }

  // The weather window, while open: { element, data, level, pending, inFlight, refreshTimer }.
  // Unlike the video settings, weather changes take effect straight away; there's nothing to apply or undo.
  _merlinWeather = null;

  _toggleMerlinWeather() {
    if (this._merlinWeather) this._closeMerlinWeather();
    else this._openMerlinWeather();
  }

  _closeMerlinWeather() {
    const state = this._merlinWeather;
    if (!state) return;
    this._merlinWeather = null;
    clearTimeout(state.refreshTimer);
    state.element.remove();
  }

  async _fetchMerlinWeather(patch) {
    const response = await fetch(`${this._merlinUrl}/weather`, patch === undefined
      ? { signal: AbortSignal.timeout(5000) }
      : { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(patch), signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async _openMerlinWeather() {
    if (this._merlinWeather) return;
    const state = this._merlinWeather = { element: this._buildMerlinWeatherWindow(), data: null, level: null, pending: null, inFlight: false, refreshTimer: null };
    state.element.addEventListener("pointerdown", () => state.element.style.zIndex = 101);
    document.body.appendChild(state.element);
    this._refreshMerlinWeather(state);
  }

  // Reads what Merlin's weather controller offers. A level that is still opening has none yet, so keep asking for a few seconds.
  async _refreshMerlinWeather(state, attempt = 0) {
    clearTimeout(state.refreshTimer);
    state.level = this._merlinCurrentLevel();
    try {
      state.data = await this._fetchMerlinWeather();
    } catch (err) {
      console.error("Merlin | Failed to read Merlin's weather:", err);
      state.data = null;
    }
    if (this._merlinWeather !== state) return;
    this._applyMerlinWeatherToWindow(state);
    if (!state.data?.available && attempt < 8) {
      state.refreshTimer = setTimeout(() => this._refreshMerlinWeather(state, attempt + 1), 1000);
    }
  }

  _merlinCurrentLevel() {
    const info = this.merlinInfo ?? {};
    return info.loadingLevel || info.loadedLevel || "";
  }

  // Merlin has opened another level, which has its own weather settings
  _onMerlinLevelMaybeChanged() {
    const state = this._merlinWeather;
    if (state && state.level !== this._merlinCurrentLevel()) this._refreshMerlinWeather(state);
  }

  // Changes made in quick succession (dragging a slider) are sent as one, one request at a time
  _sendMerlinWeather(state, patch) {
    state.pending = { ...state.pending, ...patch };
    if (state.inFlight) return;
    state.inFlight = true;
    const flush = async () => {
      while (state.pending && this._merlinWeather === state) {
        const body = state.pending;
        state.pending = null;
        try {
          const data = await this._fetchMerlinWeather(body);
          // Only take up what Merlin says if nothing newer is waiting, or the slider would jump back while it's dragged
          if (this._merlinWeather === state && !state.pending) {
            state.data = data;
            this._applyMerlinWeatherToWindow(state, { skipActive: true });
          }
        } catch (err) {
          console.error("Merlin | Failed to change Merlin's weather:", err);
          ui.notifications.warn("Couldn't change Merlin's weather.");
        }
      }
      state.inFlight = false;
    };
    flush();
  }

  _buildMerlinWeatherWindow() {
    const el = document.createElement("div");
    el.id = "merlin-weather";
    const row = (key, label) => `
      <div class="merlin-settings-row" data-key="${key}">
        <label>${label}</label>
        <div class="merlin-settings-slider">
          <input type="range" min="0" max="${MERLIN_WEATHER_STEPS[key]}" step="1">
          <span class="merlin-settings-value"></span>
        </div>
      </div>`;
    el.innerHTML = `
      <header class="merlin-settings-header">
        <span><i class="fa-solid fa-cloud-sun-rain"></i> Merlin Weather</span>
        <a class="merlin-settings-close" data-tooltip="Close"><i class="fa-solid fa-xmark"></i></a>
      </header>
      <div class="merlin-settings-body">
        ${row("timeOfDay", "Time of Day")}
        ${row("rain", "Rain")}
        ${row("windStrength", "Wind")}
        <div class="merlin-weather-none" hidden>No weather settings are available for this level.</div>
      </div>
      <footer class="merlin-settings-footer">
        <span class="merlin-settings-level"></span>
      </footer>`;

    el.querySelector(".merlin-settings-close").addEventListener("click", () => this._closeMerlinWeather());
    this._makeMerlinSettingsDraggable(el, el.querySelector(".merlin-settings-header"));

    for (const key of Object.keys(MERLIN_WEATHER_STEPS)) {
      const input = el.querySelector(`.merlin-settings-row[data-key="${key}"] input`);
      const send = () => {
        const state = this._merlinWeather;
        if (!state?.data) return;
        // Merlin takes each of these as a fraction. The time of day goes with which way the slider moved: straight to the new
        // time, never round midnight, as the slider has a start and an end.
        this._sendMerlinWeather(state, {
          [key]: Number(input.value) / MERLIN_WEATHER_STEPS[key],
          ...(key === "timeOfDay" ? { timeOfDayDirection: "direct" } : {})
        });
      };
      // The value shows while dragging, and Merlin follows (a few times a second) rather than waiting for the drop
      let last = 0;
      input.addEventListener("input", () => {
        this._showMerlinWeatherValue(el, key, Number(input.value));
        if (Date.now() - last < 150) return;
        last = Date.now();
        send();
      });
      input.addEventListener("change", send);
    }
    return el;
  }

  _showMerlinWeatherValue(el, key, position) {
    const fraction = position / MERLIN_WEATHER_STEPS[key];
    let text;
    if (key === "timeOfDay") {
      const minutes = Math.round(fraction * 24 * 60) % (24 * 60);
      text = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    } else {
      text = `${Math.round(fraction * 100)}%`;
    }
    el.querySelector(`.merlin-settings-row[data-key="${key}"] .merlin-settings-value`).textContent = text;
  }

  // Shows what Merlin says the weather is. Settings which are disabled in Merlin aren't shown. skipActive leaves alone
  // the slider being dragged.
  _applyMerlinWeatherToWindow(state, { skipActive = false } = {}) {
    const el = state.element;
    const data = state.data;
    const available = !!data?.available;
    const show = {
      timeOfDay: available && data.timeOfDay.enabled,
      rain: available && data.rain.enabled,
      windStrength: available && data.wind.enabled
    };
    const values = available ? {
      timeOfDay: data.timeOfDay.value,
      rain: data.rain.value,
      windStrength: data.wind.strength
    } : {};
    for (const key of Object.keys(MERLIN_WEATHER_STEPS)) {
      const row = el.querySelector(`.merlin-settings-row[data-key="${key}"]`);
      row.hidden = !show[key];
      const input = row.querySelector("input");
      if (show[key] && !(skipActive && document.activeElement === input)) {
        input.value = Math.round(values[key] * MERLIN_WEATHER_STEPS[key]);
        this._showMerlinWeatherValue(el, key, Number(input.value));
      }
    }
    const none = el.querySelector(".merlin-weather-none");
    none.hidden = Object.values(show).some(Boolean);
    none.textContent = available ? "No weather settings are available for this level." : "Waiting for the level's weather...";
    el.querySelector(".merlin-settings-level").textContent = `Level: ${this._merlinCurrentLevel() || "None"}`;
  }

  _makeMerlinSettingsDraggable(el, handle) {
    handle.addEventListener("pointerdown", event => {
      if (event.target.closest(".merlin-settings-close")) return;
      const rect = el.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      const move = e => {
        el.style.left = `${Math.min(Math.max(e.clientX - offsetX, 0), window.innerWidth - 80)}px`;
        el.style.top = `${Math.min(Math.max(e.clientY - offsetY, 0), window.innerHeight - 40)}px`;
      };
      const stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
      event.preventDefault();
    });
  }

  // Sits to the right of the active players box, which moves around with the UI layout
  _positionMerlinStatusWidget() {
    const widget = document.getElementById("merlin-status");
    if (!widget) return;
    const players = document.getElementById("players-active");
    if (players) {
      const rect = players.getBoundingClientRect();
      widget.style.left = `${rect.right + 8}px`;
      widget.style.bottom = `${Math.max(window.innerHeight - rect.bottom, 0)}px`;
      if (!this._merlinStatusObserver) {
        this._merlinStatusObserver = new ResizeObserver(() => this._positionMerlinStatusWidget());
        this._merlinStatusObserver.observe(players);
        this._merlinStatusObserver.observe(document.documentElement);
      }
    } else {
      widget.style.left = "220px";
      widget.style.bottom = "8px";
    }
  }

  async _onReady() {
    console.log("Merlin Module | Ready");

    // A reload leaves Merlin in puppet mode; pick the connection back up (sessionStorage survives reloads, not closing the tab)
    if (sessionStorage.getItem("merlin.connect") === "true") this._connectToMerlin();

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

    // Add a Merlin tab to the scene config
    const sceneSheet = CONFIG.Scene.sheetClasses.base['core.SceneConfig'];
    sceneSheet.cls = createMerlinSceneConfig(sceneSheet.cls, MERLIN_TEMPERATURES);

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
    this._originalBackground = null;
    this._merlinViewRequest = this._merlinAppliedView = null;
    this._applyMerlinStreamBackground();
    this._updateMerlinSceneDisplayed();
    this._sendMerlinSceneUpdate();
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

    if(!(await this._needsThumbnailRegen(scene))) return;
    if (this._regenInProgress) return;
    this._regenInProgress = true;

    console.warn(`Invalid thumbnail detected for scene "${scene.name}", "${scene.thumb}", regenerating all...`);

    try {
      let count = 0;
      for (let s of game.scenes) {
        if(!(await this._needsThumbnailRegen(s))) continue;
        // Never attempt the same scene twice in a session, even if it still looks invalid afterwards
        this._thumbRegenAttempted.add(s.id);
        const t = await s.createThumbnail();
        if(!t?.thumb) continue;
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

  // Scenes we have already tried to regenerate a thumbnail for this session
  _thumbRegenAttempted = new Set();

  async _needsThumbnailRegen(scene) {
    if(this._thumbRegenAttempted.has(scene.id)) return false;
    // Nothing to render a thumbnail from
    if(!scene.background?.src && !scene.tiles?.size) return false;
    return !(await this._isValidFilePath(scene.thumb));
  }

  overworldZoomOutThreshold = 0.65;

  _onCanvasPan(canvas, position) {
    if(!canvas.ready) return;
    this._scheduleMerlinViewUpdate();
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

  /** Return the active scene's TileDocument with the supplied Merlin stable ID. */
  getTile(stableId) {
    const id = String(stableId ?? "").trim();
    if (!id) return null;

    return [...(canvas.scene?.tiles ?? [])].find(tile =>
      String(tile?.flags?.merlin?.stableId ?? "").trim() === id) ?? null;
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
      dropShadowDistance: 0,
      // The canvas is sized to the text's advance width, so wide glyphs (e.g. W) and the shadow get clipped at the edges without this
      padding: Math.max(4, Math.ceil(captionFontSize * 0.25))
    });

    text.anchor.set(0.5, 0);
    text.eventMode = "none";
    text.interactive = false;
    text.interactiveChildren = false;
    text.zIndex = 1000000;
    text.position.set(bounds.x + (bounds.width / 2), bounds.y + bounds.height + 8);

    parent.addChild(text);
    this.tileCaption = text;
    this._updateTileCaptionResolution(true);
    this.tileCaptionTileId = tile.id;
    this.tileCaptionText = caption;
    this.tileCaptionFont = captionFont;
    this.tileCaptionFontSize = captionFontSize;
  }

  // Text is rasterized once, at a fixed resolution, but sits in the zoomable canvas. Match its resolution to the on-screen
  // scale (zoom * display pixel ratio) so it stays sharp, and only re-rasterize when the scale has changed noticeably.
  _updateTileCaptionResolution(force = false) {
    const text = this.tileCaption;
    if (!text || text.destroyed) return;
    const scale = (canvas?.stage?.scale?.x ?? 1) * (window.devicePixelRatio || 1);
    const wanted = Math.min(Math.max(scale, 1), 6);
    if (!force && Math.abs(wanted - text.resolution) / text.resolution < 0.2) return;
    text.resolution = wanted;
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
    // Remote files can't be browsed, so assume they are fine
    if (/^https?:\/\//i.test(path)) return true;

    try {
      // Strip cache-busting query/hash, then split into directory + filename
      const clean = path.split(/[?#]/)[0];
      const parts = clean.split("/");
      const filename = parts.pop();
      const dir = parts.join("/");
      const decode = (str) => { try { return decodeURIComponent(str); } catch { return str; } };
      const target = decode(filename);

      // Determine source (data/public/s3)
      const source = dir.startsWith("systems") || dir.startsWith("modules") || dir.startsWith("icons")
        ? "public"
        : "data";

      const result = await FilePicker.browse(source, decode(dir));
      return result.files.some(f => decode(f.split("/").pop().split(/[?#]/)[0]) === target);
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

    await this._runToggleActions(doc, !doc.hidden, "light");
  }

  /**
   * Run the common Merlin actions for a light or a door. `isActive` means the
   * light is on or the door is open, respectively.
   */
  async _runToggleActions(doc, isActive, documentType) {

    // Run custom code if provided
    const code = doc.flags?.merlin?.runCode;
    if (code) {
      try {
        console.log(`Merlin | Running code for ${documentType} ${doc.id}`);
        // Snippets receive `state`: true for a light on / door open, false
        // for a light off / door closed.
        // eslint-disable-next-line no-eval
        ((state) => eval(code))(isActive);
      } catch (err) {
        console.error("Merlin | Error in runCode:", err);
        ui.notifications.error(`Merlin: Error in runCode for ${documentType} ${doc.id}`);
      }
    }

    // Toggle tiles if specified
    const tileIds = doc.flags?.merlin?.switchTiles;
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
          // Normal IDs are visible when the light is on / door is open;
          // a leading '-' reverses that relationship.
          await tile.update({ alpha: (isActive == inverted ? 0 : 1), hidden: false });
        }
      }
    }
  }

  // Watch doors for an open/closed state change. `ds` is Foundry's persisted
  // wall-door state (0 = closed, 1 = open).
  async _onUpdateWall(doc, changes, options, userId) {
    if (!("ds" in changes)) return;

    const isOpen = doc.ds === CONST.WALL_DOOR_STATES.OPEN;
    console.log(`Merlin | Door [${doc.id}] ${isOpen ? "opened" : "closed"}`);
    await this._runToggleActions(doc, isOpen, "door");
  }

  // WallConfig has no Advanced tab to replace like AmbientLightConfig does, so
  // add the same two native form controls to its standard form at render time.
  _onRenderWallConfig(app, html) {
    const root = html instanceof HTMLElement ? html : html?.[0];
    const form = root?.matches("form") ? root : root?.querySelector("form");
    if (!form || form.querySelector('[name="flags.merlin.switchTiles"]')) return;

    const merlinFlags = app.document?.flags?.merlin ?? {};
    const fields = document.createElement("div");
    fields.classList.add("merlin-wall-toggle-fields");
    fields.innerHTML = `
      <div class="form-group">
        <label>Switch Tiles</label>
        <textarea name="flags.merlin.switchTiles" class="form-control lw-switchTiles-textarea" rows="1" placeholder="Enter tile IDs or stableIds to show/hide when this door opens/closes."></textarea>
      </div>
      <div class="form-group merlin-wall-run-code">
        <label>Run Code (on open/close)</label>
        <textarea name="flags.merlin.runCode" class="form-control lw-runcode-textarea" rows="6" placeholder="Enter JavaScript to run when this door opens or closes."></textarea>
      </div>`;
    fields.querySelector('[name="flags.merlin.switchTiles"]').value = merlinFlags.switchTiles ?? "";
    fields.querySelector('[name="flags.merlin.runCode"]').value = merlinFlags.runCode ?? "";

    const footer = form.querySelector(".form-footer, footer");
    if (footer) footer.before(fields);
    else form.append(fields);
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
    if (destinations.length === 0) {
      console.warn(`Merlin | No teleport destination tiles found for identifier "${identifier}"`);
      return;
    }

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
    if(tileId === tile.document._id || !sceneId || !tileId) {
      console.warn("Merlin | No teleport destination other than the tile itself");
      return;
    }

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
  sceneMerlinTemperature = {};
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

    // Get any temperature tints/overlays, set by the scene flags merlin.temperatureTints and merlin.temperatureOverlays
    await this._loadSceneTemperatureConfig();

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
      desiredBackgroundInfo.temperature = this.globalMerlinTemperature || "normal";
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
      desiredBackgroundInfo.temperature = this.sceneMerlinTemperature[canvas.scene.id] ?? "normal";
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

    const temperatureStates = this._getAvailableTemperatures();
    if(temperatureStates.length > 1) {
      const temperatureSelect = {
        name: "selectMerlinTemperature",
        button: true,
        onChange: () => {
          // Foundry only builds these controls once, so work out the next state now rather than when they were built
          const next = this._getNextTemperature(temperatureStates, this.currentBackgroundInfo.temperature);
          let desiredBackgroundInfo = {...this.currentBackgroundInfo};
          desiredBackgroundInfo.temperature = next;
          console.log("Merlin | Switching temperature to: " + next);
          this._updateBackground(desiredBackgroundInfo);
          this._describeTemperatureTool(temperatureSelect, next);
          ui.controls.render();
        }
      };
      this._describeTemperatureTool(temperatureSelect, this.currentBackgroundInfo.temperature);
      controls.lighting.tools[temperatureSelect.name] = temperatureSelect;
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

  // Shows the rain overlays for the weather, and the temperature tint and overlays
  _applyWeatherOverlays(backgroundInfo){
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

    // Temperature is applied locally by every client; it has its own layer so rain changes don't clear it
    this._applyTemperature(backgroundInfo.temperature ?? "normal");
  }

  // True while the scene being shown is one Merlin is displaying (puppet mode with a stream as the background), as
  // opposed to a scene with no Merlin level, which keeps its own background. Merlin does its own weather and time there.
  get _isMerlinSceneDisplayed(){
    const flags = canvas?.scene?.flags?.merlin;
    return !!(this.merlinEnabled && this.merlinStatus === "linked" && this.merlinStream && (flags?.merlinPackageId || flags?.merlinLevelId));
  }

  // Called when that may have changed: takes the overlays away, or puts them back
  _updateMerlinSceneDisplayed(){
    const displayed = this._isMerlinSceneDisplayed;
    if(displayed !== this._merlinSceneDisplayed){
      this._merlinSceneDisplayed = displayed;
      if(canvas?.ready){
        if(displayed){
          this.clearOverlays();
          this._temperatureApplyId++;
          this._clearTemperature();
        }
        else if(this.currentBackgroundInfo?.rain !== undefined){
          this._applyWeatherOverlays(this.currentBackgroundInfo);
        }
      }
    }
    this._updateMerlinLightingControls();
  }
  _merlinSceneDisplayed = false;

  // The lighting section's weather, temperature and time buttons are disabled while Merlin's scene is displayed
  _updateMerlinLightingControls(){
    const displayed = this._isMerlinSceneDisplayed;
    for(const name of MERLIN_LIGHTING_TOOLS){
      const button = document.querySelector(`#scene-controls-tools button[data-tool="${name}"]`);
      if(!button) continue;
      if(displayed && !("merlinTooltip" in button.dataset)){
        button.dataset.merlinTooltip = button.dataset.tooltip ?? "";
      }
      button.disabled = displayed;
      button.classList.toggle("merlin-disabled", displayed);
      if(displayed) button.dataset.tooltip = "Controlled by Merlin";
      else if("merlinTooltip" in button.dataset){
        button.dataset.tooltip = button.dataset.merlinTooltip;
        delete button.dataset.merlinTooltip;
      }
    }
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

    // The overlays are Merlin's own weather; they're not wanted over a scene Merlin is displaying
    if(!this._isMerlinSceneDisplayed){
      this._applyWeatherOverlays(backgroundInfo);
    }

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
    this.sceneMerlinTemperature[canvas.scene.id] = backgroundInfo.temperature ?? "normal";
    if(this.globalMerlinWeatherEnabled){
      this.globalMerlinTime = backgroundInfo.time;
      this.globalMerlinRain = backgroundInfo.rain;
      this.globalMerlinWind = backgroundInfo.wind;
      game.settings.set("merlins-miscellany", "globalMerlinRain", this.globalMerlinRain);
      game.settings.set("merlins-miscellany", "globalMerlinWind", this.globalMerlinWind);
      game.settings.set("merlins-miscellany", "globalMerlinTime", this.globalMerlinTime);
      this.globalMerlinTemperature = backgroundInfo.temperature ?? "normal";
      game.settings.set("merlins-miscellany", "globalMerlinTemperature", this.globalMerlinTemperature);
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
    const prevMovement = this.prevMovementMap.get(tokenId);

    let relativeX = (prevMovement.destination.x - sourceTile.x) * (targetTile.width / sourceTile.width);
    let relativeY = (prevMovement.destination.y - sourceTile.y) * (targetTile.height / sourceTile.height);
    const snapped = this.getSnappedPosition({x: targetTile.x + relativeX, y: targetTile.y + relativeY}, targetScene);

    this.#teleportTokenToPosition(sourceSceneId,targetSceneId, snapped, tokenId);
  }

  getSnappedPosition(targetTile, targetScene){
    // getSnappedPosition was deprecated in v12, and throws if Foundry's compatibility mode is strict, so only use it
    // on versions old enough not to have getSnappedPoint
    if(targetScene.grid.getSnappedPoint){
      return targetScene.grid.getSnappedPoint({x: targetTile.x - 1, y: targetTile.y - 1}, {mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_CORNER, resolution: 1});
    }
    else{
      return targetScene.grid.getSnappedPosition(targetTile.x, targetTile.y, 1);
    }
  }

  async #teleportTokenToPosition(sourceSceneId, targetSceneId, targetPosition, tokenId) {
    // Checks to stop teleporting on arrival loops
    if(this.teleportingTokenIds.has(tokenId)){
      console.warn(`Merlin | Ignoring teleport of token ${tokenId}: a teleport is already in progress for it`);
      return;
    }    
    if(this.teleportedTokenIds.has(tokenId)){
      console.warn(`Merlin | Ignoring teleport of token ${tokenId}: it has only just arrived and hasn't moved yet`);
      return;
    }
    this.teleportingTokenIds.add(tokenId);

    const sourceScene = game.scenes.get(sourceSceneId);
    const targetScene = game.scenes.get(targetSceneId);
    const token = sourceScene.tokens.get(tokenId);

    // Duplicate the token document
    // Use the source data rather than cloning the live document, and drop movement state that belongs to the old scene
    const duplToken = token.toObject();
    delete duplToken.movementHistory;
    delete duplToken._movementHistory;
    // Positions must be whole pixels: fractional coordinates break keyboard movement snapping.
    // (width/height are in grid units, so they must not be subtracted from pixel positions.)
    duplToken.x = Math.round(targetPosition.x);
    duplToken.y = Math.round(targetPosition.y);
    const created = await targetScene.createEmbeddedDocuments("Token", [duplToken]);
    const createdId = created[0]._id;

    // For any users controlling the original token, pull them to the new scene (if any) + grab the new token
    // The token's own actor also covers unlinked tokens, which game.actors doesn't know about
    const actor = token.actor ?? game.actors.get(duplToken.actorId);
    const owners = actor ? game.users.filter(u => actor.testUserPermission(u, "OWNER")) : [];
    // A GM controlling the token is pulled along even when the token has no actor to work out ownership from
    if(game.user.isGM && this.GMControlledTokenIds.has(tokenId) && !owners.includes(game.user)){
      owners.push(game.user);
    }
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

  // The temperature presets, coolest to hottest, and their default tint
  // Scene flags: merlin.temperatureTints = { freezing: "#8ec5ff" | { color: "#8ec5ff", alpha: 0.3 }, ... }
  //              merlin.temperatureOverlays = { freezing: ["path/to/overlay.webm"], ... }
  // The normal preset is the default and always available.
  sceneTemperatureConfig = { tints: {}, overlays: {} };
  temperatureLayer = [];
  _temperatureApplyId = 0;

  async _loadSceneTemperatureConfig() {
    const config = { tints: {}, overlays: {} };
    const tintFlags = canvas.scene.flags?.merlin?.temperatureTints ?? {};
    const overlayFlags = canvas.scene.flags?.merlin?.temperatureOverlays ?? {};
    for (const preset of Object.keys(MERLIN_TEMPERATURES)) {
      const tint = tintFlags[preset];
      const color = typeof tint === "string" ? tint : tint?.color;
      if (color) {
        const alpha = Number(tint?.alpha ?? MERLIN_TEMPERATURES[preset].alpha);
        config.tints[preset] = { color, alpha: Number.isFinite(alpha) ? Math.clamp(alpha, 0, 1) : MERLIN_TEMPERATURES[preset].alpha };
      }
      const files = [];
      for (const file of [].concat(overlayFlags[preset] ?? [])) {
        if (file && await this.assetExists(file)) files.push(file);
      }
      if (files.length > 0) config.overlays[preset] = files;
    }
    this.sceneTemperatureConfig = config;
  }

  // Presets this scene defines something for, always including normal
  _getAvailableTemperatures() {
    const { tints, overlays } = this.sceneTemperatureConfig;
    return Object.keys(MERLIN_TEMPERATURES).filter(preset => preset === "normal" || tints[preset] || overlays[preset]);
  }

  async _applyTemperature(preset) {
    const applyId = ++this._temperatureApplyId;
    this._clearTemperature();
    if (!canvas.ready) return;

    const tint = this.sceneTemperatureConfig.tints[preset];
    const files = this.sceneTemperatureConfig.overlays[preset] ?? [];
    const { sceneX, sceneY, sceneWidth, sceneHeight } = canvas.dimensions;
    const added = [];

    if (tint) {
      // A tinted white sprite rather than Graphics, as the Graphics API differs between PIXI versions
      const tintSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
      tintSprite.tint = foundry.utils.Color.from(tint.color).valueOf();
      tintSprite.alpha = tint.alpha;
      tintSprite.position.set(sceneX, sceneY);
      tintSprite.width = sceneWidth;
      tintSprite.height = sceneHeight;
      added.push(tintSprite);
    }

    for (const file of files) {
      let sprite;
      try {
        if (/\.(mp4|webm|ogg|mov)$/i.test(file)) {
          const video = document.createElement("video");
          video.src = file;
          video.loop = true;
          video.muted = true;
          video.autoplay = true;
          video.playsInline = true;
          await video.play();
          sprite = new PIXI.Sprite(PIXI.Texture.from(video));
        } else {
          sprite = PIXI.Sprite.from(file);
        }
      } catch (err) {
        console.warn(`Merlin | Could not load temperature overlay ${file}:`, err);
        continue;
      }
      sprite.position.set(sceneX, sceneY);
      sprite.width = sceneWidth;
      sprite.height = sceneHeight;
      sprite._merlinOwnsTexture = true;
      added.push(sprite);
    }

    // A newer call (or a scene change) has superseded this one while the files were loading
    if (applyId !== this._temperatureApplyId || !canvas.ready) {
      for (const obj of added) this._destroyOverlaySprite(obj);
      return;
    }
    for (const obj of added) {
      canvas.interface.addChild(obj);
      this.temperatureLayer.push(obj);
    }
  }

  _getNextTemperature(states, current) {
    return states[(states.indexOf(current ?? "normal") + 1) % states.length];
  }

  // Sets the button's icon and title to show the current temperature
  _describeTemperatureTool(tool, current = "normal") {
    tool.icon = `fas ${MERLIN_TEMPERATURES[current]?.icon ?? "fa-temperature-half"}`;
    tool.title = `Temperature: ${MERLIN_TEMPERATURES[current]?.label ?? current}`;
  }

  // The rain and temperature overlays are loaded when the scene controls are built, so rebuild them when those flags change
  _onUpdateScene(scene, changes) {
    if (scene.id !== canvas.scene?.id) return;
    const merlinChanges = changes.flags?.merlin;
    if (!merlinChanges) return;
    const overlayFlag = /^(-=|==)?(temperatureTints|temperatureOverlays|rainOverlays)$/;
    if (!Object.keys(merlinChanges).some(key => overlayFlag.test(key))) return;
    ui.controls.render({ reset: true });
  }

  // Destroys an overlay sprite along with what it shows. A sprite made from a file owns its texture, and if that is a video it
  // keeps playing and decoding in the page until it is stopped and its texture destroyed. The temperature tint sprite instead
  // uses PIXI's shared white texture, which must be left alone.
  _destroyOverlaySprite(sprite) {
    if (!sprite || sprite.destroyed) return;
    sprite.parent?.removeChild(sprite);
    if (!sprite._merlinOwnsTexture) {
      sprite.destroy({ children: true });
      return;
    }
    const video = sprite.texture?.baseTexture?.resource?.source;
    sprite.destroy({ children: true, texture: true, baseTexture: true });
    if (video?.tagName === "VIDEO") {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  }

  _clearTemperature() {
    for (const obj of this.temperatureLayer) this._destroyOverlaySprite(obj);
    this.temperatureLayer = [];
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
        await new Promise(resolve => setTimeout(resolve, 50));
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
      sprite._merlinOwnsTexture = true;

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
      this._destroyOverlaySprite(overlay);
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

  game.settings.register("merlins-miscellany", "merlinServerPort", {
    name: "Merlin Link Port",
    hint: "Port of the local Merlin instance's Foundry server (Merlin's FoundryServerPort).",
    scope: "client",
    config: false,
    type: Number,
    default: 8081
  });

  game.settings.register("merlins-miscellany", "adaptiveZoom", {
    name: "Adaptive Zoom",
    hint: "Merlin updates its camera as you zoom in/out, giving better image quality, at the cost of some jittering as you move.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => game.merlin?._updateMerlinView(true, true)
  });

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
  game.settings.register("merlins-miscellany", "globalMerlinTemperature", {
    name: "Global Merlin Temperature String",
    hint: "Current temperature to use for all Merlin scenes.",
    scope: "world",
    config: false,
    type: String,
    default: "",
    onChange: (value) => {
      // Keep other clients in step when the GM changes the temperature
      const merlin = game.merlin;
      if (!merlin?.globalMerlinWeatherEnabled || !canvas?.ready || !value || value === merlin.globalMerlinTemperature) return;
      merlin.globalMerlinTemperature = value;
      merlin.currentBackgroundInfo = { ...merlin.currentBackgroundInfo, temperature: value };
      merlin._applyTemperature(value);
      ui.controls?.render();
    }
  });
  game.merlin.globalMerlinWeatherEnabled = game.settings.get("merlins-miscellany", "globalMerlinWeatherEnabled");
  game.merlin.globalMerlinRain = game.settings.get("merlins-miscellany", "globalMerlinRain");
  game.merlin.globalMerlinWind = game.settings.get("merlins-miscellany", "globalMerlinWind");
  game.merlin.globalMerlinTime = game.settings.get("merlins-miscellany", "globalMerlinTime");
  game.merlin.globalMerlinTemperature = game.settings.get("merlins-miscellany", "globalMerlinTemperature");

  registerHexcrawlSettings(game);
});
