export class Hexcrawl {
  bAddedBoardListeners = false;
  hexcrawlTerrainImages = new Map();

  standardTerrains = new Map();  
  standardTerrainNavDCs = new Map();
  jungleTerrains = new Map();
  jungleTerrainNavDCs = new Map();

  constructor() {
    this.standardTerrains.set("10", "Grassland");
    this.standardTerrains.set("20", "Hills");
    this.standardTerrains.set("30", "Forest");
    this.standardTerrainNavDCs.set("10", 5);
    this.standardTerrainNavDCs.set("20", 10);
    this.standardTerrainNavDCs.set("30", 15);

    this.jungleTerrains.set("10","Coast");
    this.jungleTerrains.set("20", "Jungle");
    this.jungleTerrains.set("30", "Mountain");
    this.jungleTerrains.set("40", "Swamp");
    this.jungleTerrains.set("50", "Wasteland");
    this.jungleTerrains.set("60", "Desert");
    this.jungleTerrainNavDCs.set("10", 10);
    this.jungleTerrainNavDCs.set("20", 15);
    this.jungleTerrainNavDCs.set("30", 15);
    this.jungleTerrainNavDCs.set("40", 15);
    this.jungleTerrainNavDCs.set("50", 15);
    this.jungleTerrainNavDCs.set("60", 15);
  }

  _configureHexcrawlSceneControls(controls) {
    // Add hexcrawl UI only if we are in a hexcrawl scene
    if (!canvas.scene?.flags?.merlin?.hexcrawl) return;
    // Add hexcrawl UI toggle button
    const hexcrawlButton = {
      name: "toggleHexcrawlUI",
      title: "Toggle Hexcrawl UI",
      icon: "fas fa-map",
      toggle: true,
      active: this.showHexcrawlUI,
      onClick: (toggle) => {
        this.showHexcrawlUI = toggle;
        game.settings.set("merlins-miscellany", "showHexcrawlUI", toggle);
        this._showHexcrawlUI(toggle);
      },
      button: true
    };
    controls.tokens.tools[hexcrawlButton.name] = hexcrawlButton;
    this._showHexcrawlUI(this.showHexcrawlUI);

    // Add canvas hover tooltip
    if(this.bAddedBoardListeners) return;
    let tooltipTimer = null;
    let tooltip = null;
    const board = document.querySelector("#board");
    board.addEventListener("mousemove", handleMouseMove);
    board.addEventListener("mouseleave", handleMouseLeave);
    this.bAddedBoardListeners = true;
        
    async function handleMouseMove(event) {      
      clearTimeout(tooltipTimer);
      hideTooltip();
      if (!game.merlin.showHexcrawlUI) return;
      if (!canvas.scene?.flags?.merlin?.hexcrawl) return;
      if (!canvas.scene?.flags?.merlin?.hexcrawlTerrain) return;      
      if (!game.merlin.hexcrawlTerrainImages.has(canvas.scene.flags.merlin.hexcrawlTerrain)) {
        const newTerrainTexture = await game.merlin._loadTexture(canvas.scene.flags.merlin.hexcrawlTerrain);
        if(newTerrainTexture){
          game.merlin.hexcrawlTerrainImages.set(canvas.scene.flags.merlin.hexcrawlTerrain, newTerrainTexture.baseTexture.resource);
        }
      }
      if(!game.merlin.hexcrawlTerrainImages.has(canvas.scene.flags.merlin.hexcrawlTerrain)) return;
      const { x, y } = canvas.app.renderer.events.pointer.getLocalPosition(canvas.stage);
      if(!game.user.isGM && !canvas.fog.isPointExplored({x, y})) return;
      
      tooltipTimer = setTimeout(() => {        
        showTooltip(event.clientX, event.clientY, x, y);
      }, 1000);
    }

    function handleMouseLeave() {
      clearTimeout(tooltipTimer);
      hideTooltip();
    }

    function showTooltip(screenX, screenY, canvasX, canvasY) {
      if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.classList.add("hexcrawl-tooltip");
        document.body.appendChild(tooltip);
      }
      const pixel = game.merlin._getPixel(canvasX, canvasY);
      const terrain = game.merlin._getTerrainStrings(pixel);
      if(terrain.title === "None") return;

      tooltip.innerHTML = `
        <div class="hexcrawl-tooltip-title">${terrain.title}</div>
        ${terrain.water != "None" && terrain.water != terrain.title ? `<div>${terrain.water}</div>` : ""}
        ${terrain.special != "None" ? `<div>${terrain.special}</div>` : ""}
      `;
      tooltip.style.left = `${screenX + 15}px`;
      tooltip.style.top = `${screenY + 15}px`;
      tooltip.style.display = "block";
      //tooltip.textContent = canvasX + ", " + canvasY;
    }

    function hideTooltip() {
        if (tooltip) {
            tooltip.style.display = "none";
        }
    }
  }

  _showHexcrawlUI(show = true) {
    console.log("Merlin | Toggling hexcrawl UI to " + (show ? "show" : "hide"));
    const obj = { isNew: false };
    let beginAdventure = this._getOrAddElement("hexcrawl-begin-adventure", "ui-top", obj);
    if (beginAdventure) {
      if (obj.isNew) {
        beginAdventure.innerHTML = `<div><button class="hexcrawl-begin-adventure">Begin Adventure</button></div>`;
        beginAdventure?.addEventListener("click", async () => {
          await this._crawlNextDay();
          const hexcrawlLeftColumn = document.getElementById("hexcrawl-left-column");
          if (hexcrawlLeftColumn) {
            hexcrawlLeftColumn.style.display = "flex";
          }
          if(this.hexcrawlPopup && this.hexcrawlMainInterfaceVisible){
            this.hexcrawlPopup.render(true);
          }
          this.hexcrawlNavigationInterfaceVisible = true;
          this.hexcrawlNavigationControlsVisible = false;
          this._updateNavigationUI();
        });
      }
      beginAdventure.style.display = this.hexcrawlDays === 0 && show ? "flex" : "none";
    }

    let hexcrawlLeftColumn = this._getOrAddElement("hexcrawl-left-column", "ui-left-column-1", obj, false, "players");
    if (hexcrawlLeftColumn) {
      hexcrawlLeftColumn.className = "hexcrawl-left-column";
      hexcrawlLeftColumn.style.display = this.hexcrawlDays > 0 && show ? "flex" : "none";
    }

    // Navigation interface
    let hexcrawlNavigationInterface = this._getOrAddElement("hexcrawl-navigation-interface", "hexcrawl-left-column");
    if (hexcrawlNavigationInterface) {
      hexcrawlNavigationInterface.className = "hexcrawl-navigation-interface";
      hexcrawlNavigationInterface.style.display = this.hexcrawlNavigationInterfaceVisible ? "block" : "none";
      this._updateNavigationUI();
    }

    let hexcrawlWeatherInterface = this._getOrAddElement("hexcrawl-weather-interface", "hexcrawl-left-column");
    if (hexcrawlWeatherInterface) {
      hexcrawlWeatherInterface.className = "hexcrawl-weather-interface";
      hexcrawlWeatherInterface.style.display = this.hexcrawlWeatherInterfaceVisible ? "block" : "none";
      this._updateWeatherUI();
    }

    // Main controls
    let hexcrawlControls = this._getOrAddElement("hexcrawl-controls", "hexcrawl-left-column");
    if (hexcrawlControls) {
      hexcrawlControls.className = "hexcrawl-controls";
    }
    let hexcrawlControlPanelButton = this._getOrAddElement("hexcrawl-control-panel-button", "hexcrawl-controls");
    if (hexcrawlControlPanelButton) {
      hexcrawlControlPanelButton.className = "hexcrawl-toggle-button icon fa-solid fa-hexagon";
      if (!this.hexcrawlPopup) {
        this.hexcrawlPopup = new HexcrawlPopup();
      }
      if (this.hexcrawlMainInterfaceVisible) {
        hexcrawlControlPanelButton.classList.add("active");
        this.hexcrawlPopup.render(this.hexcrawlDays > 0);
      }
      if (obj.isNew) {
        hexcrawlControlPanelButton.addEventListener("click", () => {
          if(this.hexcrawlPopup){
            if(this.hexcrawlMainInterfaceVisible){
              this.hexcrawlPopup.close();
              return;
            }
            else{
              this.hexcrawlPopup.render(true);
            }
          }
          hexcrawlControlPanelButton.classList.toggle("active");
          this.hexcrawlMainInterfaceVisible = true;
          game.settings.set("merlins-miscellany", "hexcrawlMainInterfaceVisible", this.hexcrawlMainInterfaceVisible);
        });
      }
    }
    let hexcrawlWeatherButton = this._getOrAddElement("hexcrawl-weather-button", "hexcrawl-controls");
    if (hexcrawlWeatherButton) {
      hexcrawlWeatherButton.className = "hexcrawl-toggle-button icon fa-solid fa-cloud";
      if (this.hexcrawlWeatherInterfaceVisible) {
        hexcrawlWeatherButton.classList.add("active");
      }
      if (obj.isNew) {
        hexcrawlWeatherButton.addEventListener("click", () => {
          hexcrawlWeatherButton.classList.toggle("active");
          this.hexcrawlWeatherInterfaceVisible = !this.hexcrawlWeatherInterfaceVisible;
          game.settings.set("merlins-miscellany", "hexcrawlWeatherInterfaceVisible", this.hexcrawlWeatherInterfaceVisible);
          let hexcrawlWeatherInterface = document.getElementById("hexcrawl-weather-interface");
          if (hexcrawlWeatherInterface) {
            hexcrawlWeatherInterface.style.display = this.hexcrawlWeatherInterfaceVisible ? "block" : "none";
          }
        });
      }
    }
    let hexcrawlNavigationButton = this._getOrAddElement("hexcrawl-navigation-button", "hexcrawl-controls");
    if (hexcrawlNavigationButton) {
      hexcrawlNavigationButton.className = "hexcrawl-toggle-button icon fa-solid fa-route";
      if (this.hexcrawlNavigationInterfaceVisible) {
        hexcrawlNavigationButton.classList.add("active");
      }
      if (obj.isNew) {
        hexcrawlNavigationButton.addEventListener("click", () => {
          this.hexcrawlNavigationInterfaceVisible = !this.hexcrawlNavigationInterfaceVisible;
          game.settings.set("merlins-miscellany", "hexcrawlNavigationInterfaceVisible", this.hexcrawlNavigationInterfaceVisible);
          hexcrawlNavigationButton.classList.toggle("active", this.hexcrawlNavigationInterfaceVisible);
          this._updateNavigationUI();
        });
      }
    }
    let hexcrawlLogButton = this._getOrAddElement("hexcrawl-log-button", "hexcrawl-controls");
    if (hexcrawlLogButton) {
      hexcrawlLogButton.className = "hexcrawl-toggle-button icon fa-solid fa-table-list";
    }

    // Days interface
    let daysInterface = this._getOrAddElement("hexcrawl-days-interface", "ui-top", obj, true, null);
    if (daysInterface) {
      daysInterface.className = "hexcrawl-days-interface";
      daysInterface.style.display = this.hexcrawlDays > 0 && show ? "block" : "none";
    }
    let daysWidget = this._getOrAddElement("hexcrawl-days-widget", "hexcrawl-days-interface");
    if (daysWidget) {
      daysWidget.className = "hexcrawl-days-widget";
    }
    let timeWidget = this._getOrAddElement("hexcrawl-time-widget", "hexcrawl-days-interface");
    if (timeWidget) {
      timeWidget.className = "hexcrawl-time-widget";
    }
    let daysCounter = this._getOrAddElement("hexcrawl-days-counter", "hexcrawl-days-widget");
    if (daysCounter) {
      daysCounter.innerHTML = `<div class="hexcrawl-days-counter"><span>Day ${this.hexcrawlDays}</span></div>`;
      if (obj.isNew) {
        daysCounter.addEventListener("mouseenter", () => {
          const nextDay = document.getElementById("hexcrawl-next-day");
          const prevDay = document.getElementById("hexcrawl-prev-day");
          if (nextDay) {
            nextDay.style.color = "white";
          }
          if (prevDay && this.hexcrawlDays > 1) {
            prevDay.style.color = "white";
          }
        });
        daysCounter.addEventListener("mouseleave", () => {
          const nextDay = document.getElementById("hexcrawl-next-day");
          const prevDay = document.getElementById("hexcrawl-prev-day");
          if (nextDay) {
            nextDay.style.color = "rgba(255, 255, 255, 0)";
          }
          if (prevDay) {
            prevDay.style.color = "rgba(255, 255, 255, 0)";
          }
        });
      }
    }
    let timeCounter = this._getOrAddElement("hexcrawl-time-counter", "hexcrawl-time-widget");
    if (timeCounter) {
      this._crawlSetTime();
      if (obj.isNew) {
        timeCounter.addEventListener("mouseenter", () => {
          const nextPeriod = document.getElementById("hexcrawl-next-period");
          const prevPeriod = document.getElementById("hexcrawl-prev-period");
          if (nextPeriod) {
            nextPeriod.style.color = "white";
          }
          if (prevPeriod && (this.hexcrawlDays > 1 || this.hexcrawlTime > 0)) {
            prevPeriod.style.color = "white";
          }
        });
        timeCounter.addEventListener("mouseleave", () => {
          const nextPeriod = document.getElementById("hexcrawl-next-period");
          const prevPeriod = document.getElementById("hexcrawl-prev-period");
          if (nextPeriod) {
            nextPeriod.style.color = "rgba(255, 255, 255, 0)";
          }
          if (prevPeriod) {
            prevPeriod.style.color = "rgba(255, 255, 255, 0)";
          }
        });
      }
    }

    let nextDay = this._getOrAddElement("hexcrawl-next-day", "hexcrawl-days-widget", obj);
    if (nextDay) {
      nextDay.className = "hexcrawl-day-button icon fa-solid fa-arrow-alt-right";
      if (obj.isNew) {
        nextDay.addEventListener("click", () => this._crawlNextDay());
      }
    }
    let prevDay = this._getOrAddElement("hexcrawl-prev-day", "hexcrawl-days-widget", obj, false);
    if (prevDay) {
      prevDay.className = "hexcrawl-day-button icon fa-solid fa-arrow-alt-left";
      if (obj.isNew) {
        prevDay.addEventListener("click", () => this._crawlPrevDay());
      }
    }
    let nextPeriod = this._getOrAddElement("hexcrawl-next-period", "hexcrawl-time-widget", obj);
    if (nextPeriod) {
      nextPeriod.className = "hexcrawl-period-button icon fa-solid fa-arrow-alt-right";
      if (obj.isNew) {
        nextPeriod.addEventListener("click", () => this._crawlNextPeriod());
      }
    }
    let prevPeriod = this._getOrAddElement("hexcrawl-prev-period", "hexcrawl-time-widget", obj, false);
    if (prevPeriod) {
      prevPeriod.className = "hexcrawl-period-button icon fa-solid fa-arrow-alt-left";
      if (obj.isNew) {
        prevPeriod.addEventListener("click", () => this._crawlPrevPeriod());
      }
    }
  }

  async _crawlNextDay() {
    this.hexcrawlDays++;
    this.hexcrawlTime = 0;
    this.hexcrawlNavigationControlsVisible = false;
    const numPeriods = this._getHexcrawlPeriodsLength() - this.hexcrawlWeatherLog.length;
    // Generate next day of weather
    for (let i = 0; i < numPeriods; i++) {
      await this._crawlNextPeriodWeather();
    }

    // Update UI for current time
    this._updateDaysUI();
    this._updateWeatherUI();
  }

  _crawlPrevDay() {
    if (this.hexcrawlDays <= 1) return;
    this.hexcrawlDays--;
    this.hexcrawlTime = 0;
    this.hexcrawlNavigationControlsVisible = false;
    this._updateDaysUI();
    this._updateWeatherUI();
  }

  async _crawlNextPeriod() {
    if (this.hexcrawlTime >= 2) {
      this.hexcrawlTime = 0;
      this._crawlNextDay();
    } else {
      this.hexcrawlTime++;
      if (this._getHexcrawlPeriodsLength() > this.hexcrawlWeatherLog.length) {
        await this._crawlNextPeriodWeather();
      }
      this._updateDaysUI();
      this._updateWeatherUI();
    }
  }

  _crawlPrevPeriod() {
    if (this.hexcrawlTime <= 0) {
      this.hexcrawlDays--;
      this.hexcrawlTime = 2;
      this.hexcrawlNavigationControlsVisible = false;
    } else {
      this.hexcrawlTime--;
    }
    this._updateDaysUI();
    this._updateWeatherUI();
  }

  _getHexcrawlPeriodsLength() {
    return (this.hexcrawlDays - 1) * 3 + this.hexcrawlTime + 1;
  }

  _getWeatherStrings(weatherCode, weatherStrings) {
    weatherStrings.effects = [];
    if (!weatherCode || weatherCode.length < 4) {
      weatherStrings.title = "Clear Skies";
      return;
    }
    const [temperature, wind, precipitation, special] = weatherCode.split("");

    // Determine effects
    switch (this._getClimate()) {
      case "standard":
        // todo
      case "frigid":
        // todo
      case "jungle":
        if (temperature === "c") {
          weatherStrings.effects.push("All characters consume 1.5x as much water (3 gallons) per day");
          weatherStrings.effects.push("Nights are hot enough to not need additional warmth sources during long rests");
        }
        if (wind === "b") {
          weatherStrings.effects.push("Clears light fog, smoke, and fumes");
        } else if (wind === "c") {
          weatherStrings.effects.push("Disadvantage on ranged weapon attacks");
          weatherStrings.effects.push("Clears all fog, smoke, and fumes");
          weatherStrings.effects.push("Disadvantage on Wisdom (Perception) checks relying on hearing");
          weatherStrings.effects.push("Medium and smaller creatures with a fly speed must return to the ground at the end of their turn, or fall. Creatures with a hover speed have their speed halved.");
        }
        if (precipitation != "a") {
          weatherStrings.effects.push("Disadvantage on ability checks to climb or scale objects, and ability checks made to maintain balance or keep one's footing");
        } else if (precipitation === "c") {
          if (special != "b") {
            weatherStrings.effects.push("Your surroundings are lightly obscured");
          }
          weatherStrings.effects.push("Open flames are extinguished");
          weatherStrings.effects.push("Disadvantage on Wisdom (Perception) checks relying on hearing or scent");
          weatherStrings.effects.push("Disadvantage on Wisdom (Survival) checks made to track creatures");
        }
        break;
    }

    if (special != "a") {
      switch (this._getClimate()) {
        case "standard":
          // todo
        case "frigid":
          // todo
        case "jungle":
          if (special == "b")
            weatherStrings.title = "Tropical Storm";
          weatherStrings.effects.push("Your surroundings are heavily obscured");
          weatherStrings.effects.push("Everywhere is difficult terrain");
          weatherStrings.effects.push("Travel by canoe becomes impossible due to raging torrents");
          weatherStrings.effects.push("Travel on foot yields one point of exhaustion, and players must make a DC 10 Constitution saving throw to avoid another point of exhaustion");
          weatherStrings.effects.push("Disadvantage on Wisdom (Survival) checks made to navigate");
          return;
          break;
      }
    }

    // Determine title
    weatherStrings.title = "Clear Skies";
    switch (this._getClimate()) {
      case "standard":
        // todo
      case "frigid":
        // todo
      case "jungle":
        if (weatherCode.startsWith("aaa")) weatherStrings.title = "Clear Skies";
        else if (weatherCode.startsWith("aab")) weatherStrings.title = "Light Rain";
        else if (weatherCode.startsWith("aac")) weatherStrings.title = "Heavy Rain";
        else if (weatherCode.startsWith("aba")) weatherStrings.title = "Light Breeze";
        else if (weatherCode.startsWith("abb")) weatherStrings.title = "Light, Breezy Rain";
        else if (weatherCode.startsWith("abc")) weatherStrings.title = "Heavy, Breezy Rain";
        else if (weatherCode.startsWith("aca")) weatherStrings.title = "Very Windy";
        else if (weatherCode.startsWith("acb")) weatherStrings.title = "Very Windy, Light Rain";
        else if (weatherCode.startsWith("acc")) weatherStrings.title = "Tropical Storm";// see above
        else if (weatherCode.startsWith("baa")) weatherStrings.title = "Cool";
        else if (weatherCode.startsWith("bab")) weatherStrings.title = "Cooling Rain";
        else if (weatherCode.startsWith("bac")) weatherStrings.title = "Heavy Rain";
        else if (weatherCode.startsWith("bba")) weatherStrings.title = "Cool Breeze";
        else if (weatherCode.startsWith("bbb")) weatherStrings.title = "Light, Breezy Rain";
        else if (weatherCode.startsWith("bbc")) weatherStrings.title = "Heavy, Breezy Rain";
        else if (weatherCode.startsWith("bca")) weatherStrings.title = "Very Windy, Cool";
        else if (weatherCode.startsWith("bcb")) weatherStrings.title = "Very Windy, Light Rain";
        else if (weatherCode.startsWith("bcc")) weatherStrings.title = "Tropical Storm";// see above
        else if (weatherCode.startsWith("caa")) weatherStrings.title = "Sweltering Heat";
        else if (weatherCode.startsWith("cab")) weatherStrings.title = "Humid Rain";
        else if (weatherCode.startsWith("cac")) weatherStrings.title = "Tropical Downpour";
        else if (weatherCode.startsWith("cba")) weatherStrings.title = "Hot With Slight Breeze";
        else if (weatherCode.startsWith("cbb")) weatherStrings.title = "Windy, Humid Rain";
        else if (weatherCode.startsWith("cbc")) weatherStrings.title = "Windy, Tropical Downpour";
        else if (weatherCode.startsWith("cca")) weatherStrings.title = "Very Windy, Scorching";
        else if (weatherCode.startsWith("ccb")) weatherStrings.title = "Very Windy, Humid Rain";
        else if (weatherCode.startsWith("ccc")) weatherStrings.title = "Tropical Storm";// see above
        break;
    }
  }

  _updateDaysUI() {
    if (this.hexcrawlDays === 1) {
      let beginAdventure = document.getElementById("hexcrawl-begin-adventure");
      beginAdventure.style.display = "none";
      let daysInterface = document.getElementById("hexcrawl-days-interface");
      daysInterface.style.display = "block";
    }
    let prevDay = document.getElementById("hexcrawl-prev-day");
    if (prevDay) {
      prevDay.style.pointerEvents = this.hexcrawlDays === 1 ? "none" : "all";
    }
    let prevPeriod = document.getElementById("hexcrawl-prev-period");
    if (prevPeriod) {
      prevPeriod.style.pointerEvents = this.hexcrawlDays === 1 && this.hexcrawlTime === 0 ? "none" : "all";
    }
    let daysCounter = document.getElementById("hexcrawl-days-counter");
    daysCounter.innerHTML = `<div class="hexcrawl-days-counter"><span>Day ${this.hexcrawlDays}</span></div>`;
    this._crawlSetTime();
    this._updateNavigationUI();
  }

  _updateWeatherUI() {
    const weatherCode = this.hexcrawlWeatherLog.at(this._getHexcrawlPeriodsLength() - 1);
    if (!weatherCode) return;
    let weatherStrings = {};
    this._getWeatherStrings(weatherCode, weatherStrings);
    let hexcrawlWeatherInterface = document.getElementById("hexcrawl-weather-interface");
    if (hexcrawlWeatherInterface) {
      hexcrawlWeatherInterface.innerHTML = `
          <div class="hexcrawl-weather-box">
            <div class="hexcrawl-weather-header">
                <div class="hexcrawl-weather-title">${weatherStrings.title}</div>
                <div class="hexcrawl-weather-icon" style="display: ${weatherCode.endsWith("a") ? "none" : "block"}">
                    <i class="fas fa-warning"></i>
                </div>
            </div>

            <ul class="hexcrawl-weather-list">
                ${weatherStrings.effects.map(effect => `<li>${effect}</li>`).join("")}
            </ul>
        </div>
      `;
    }
  }

  speedSelection = 1;
  terrainSelection = "";
  navDC = 10;
  navMod = 0;

  _getNavigationDayKey(day = this.hexcrawlDays) {
    return `${day}`;
  }

  _getNavigationResult(day = this.hexcrawlDays) {
    return game.merlin.hexcrawlNavigationResults?.[this._getNavigationDayKey(day)] ?? null;
  }

  async _setNavigationResult(day, result) {
    const results = { ...(game.merlin.hexcrawlNavigationResults ?? {}) };
    const dayKey = this._getNavigationDayKey(day);
    if (result) {
      results[dayKey] = result;
    } else {
      delete results[dayKey];
    }

    game.merlin.hexcrawlNavigationResults = results;
    //await game.settings.set("merlins-miscellany", "hexcrawlNavigationResults", results);
    this.hexcrawlNavigationControlsVisible = false;
    this._updateNavigationUI();
  }

  _updateNavigationUI() {
    const navigationResult = this._getNavigationResult();
    const hexcrawlNavigationInterface = document.getElementById("hexcrawl-navigation-interface");
    if (!hexcrawlNavigationInterface) return;

    const showControls = !navigationResult || this.hexcrawlNavigationControlsVisible;
    const toggleButton = navigationResult
      ? `
        <button type="button" class="hexcrawl-navigation-toggle" aria-label="${showControls ? "Cancel" : "Reroll"}">
          <i class="fas fa-${showControls ? "xmark" : "rotate-right"}"></i>
        </button>
      `
      : "";

    hexcrawlNavigationInterface.innerHTML = `
      <div class="hexcrawl-navigation-box">
        <div class="hexcrawl-navigation-header">
          <div class="hexcrawl-navigation-title-row">
            <div class="hexcrawl-navigation-title">Navigation</div>
            ${toggleButton}
          </div>
        </div>
        <div class="hexcrawl-navigation-body">
          ${showControls ? this._renderNavigationControls() : this._renderNavigationResults(navigationResult)}
        </div>
      </div>
    `;
    hexcrawlNavigationInterface.style.display = this.hexcrawlNavigationInterfaceVisible ? "block" : "none";

    const toggle = hexcrawlNavigationInterface.querySelector(".hexcrawl-navigation-toggle");
    if (toggle) {
      game.merlin._addCustomTooltip(toggle, showControls ? "cancel" : "reroll");
      toggle.addEventListener("click", () => {
        this.hexcrawlNavigationControlsVisible = !this.hexcrawlNavigationControlsVisible;
        this._updateNavigationUI();
      });
    }

    if (showControls) {
      this._bindNavigationControls(hexcrawlNavigationInterface);
    }
  }

  _renderNavigationResults(navigationResult) {
    const lost = navigationResult.lost ? "Yes" : "No";
    const movementDistance = navigationResult.movementDistance >= 0
      ? `+${navigationResult.movementDistance}`
      : `${navigationResult.movementDistance}`;
    const perceptionModifier = navigationResult.perceptionModifier >= 0
      ? `+${navigationResult.perceptionModifier}`
      : `${navigationResult.perceptionModifier}`;

    return `
      <ul class="hexcrawl-navigation-list">
        <li><span class="hexcrawl-navigation-label">Lost:</span> ${lost}</li>
        <li><span class="hexcrawl-navigation-label">Movement distance:</span> ${movementDistance}</li>
        <li><span class="hexcrawl-navigation-label">Perception modifier:</span> ${perceptionModifier}</li>
      </ul>
    `;
  }

  _renderNavigationControls() {
    const terrains = this._getAvailableTerrains();
    const terrainSelection = this._getNavigationTerrainSelection();
    this.terrainSelection = terrainSelection;
    const navigatorSelected = !!game.merlin.hexcrawlNavigatorId;
    const actors = Array.from(game.actors).sort((a, b) => {
      const aIsPC = a.type === "character";
      const bIsPC = b.type === "character";
      if (aIsPC !== bIsPC) {
        return aIsPC ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    return `
      <div class="hexcrawl-navigation-controls">
        <div class="hexcrawl-terrain-selection">
          <select>
            ${[...terrains].map(([key, value]) => `
              <option value="${key}" ${key === terrainSelection ? "selected" : ""}>
                ${value}
              </option>
            `).join("")}
          </select>
        </div>

        <div class="hexcrawl-speed-selection">
          <label>
            <input type="radio" name="speed" value="slow" ${this.speedSelection === 0 ? "checked" : ""}>
            Slow
          </label>
          <label>
            <input type="radio" name="speed" value="normal" ${this.speedSelection === 1 ? "checked" : ""}>
            Normal
          </label>
          <label>
            <input type="radio" name="speed" value="fast" ${this.speedSelection === 2 ? "checked" : ""}>
            Fast
          </label>
        </div>

        <div class="hexcrawl-character-selection">
          <select>
            <option value="" disabled ${navigatorSelected ? "" : "selected"}>Select Navigator</option>
            ${actors.map(actor => `
              <option value="${actor.id}" ${actor.id === game.merlin.hexcrawlNavigatorId ? "selected" : ""}>
                ${actor.name}
              </option>
            `).join("")}
          </select>
        </div>

        <div class="hexcrawl-navmod-info" id="hexcrawl-navmod-info"></div>

        <div class="hexcrawl-navigation-action">
          <button type="button">Navigate</button>
        </div>

        <div class="hexcrawl-navdc-info" id="hexcrawl-navdc-info"></div>
      </div>
    `;
  }

  _getNavigationTerrainSelection() {
    if (this.terrainSelection) return this.terrainSelection;
    if (canvas.scene?.tokens?.size > 0) {
      const token = canvas.scene.tokens.contents[0];
      let centre = {};
      if (game.merlin.lastTokenMovement != null) {
        centre = {
          x: game.merlin.lastTokenMovement.destination.x + (game.merlin.lastTokenMovement.width / 2),
          y: game.merlin.lastTokenMovement.destination.y + (game.merlin.lastTokenMovement.height / 2)
        };
      } else {
        centre = {
          x: token.x + (token.width * canvas.grid.sizeX / 2),
          y: token.y + (token.height * canvas.grid.sizeY / 2)
        };
      }
      const pixel = game.merlin._getPixel(centre.x, centre.y);
      if (pixel) return pixel[2].toString(16);
    }
    const terrains = game.merlin._getAvailableTerrains?.();
    const firstTerrain = terrains ? [...terrains.keys()][0] : "";
    return firstTerrain || "";
  }

  _bindNavigationControls(container) {
    const terrainSelect = container.querySelector(".hexcrawl-terrain-selection select");
    if (terrainSelect) {
      terrainSelect.addEventListener("change", (event) => {
        this.terrainSelection = event.target.value;
        this.updateNavDC();
      });
    }

    container.querySelectorAll('input[name="speed"]').forEach(radio => {
      radio.addEventListener("change", (event) => {
        if (event.target.value === "slow") {
          this.speedSelection = 0;
        } else if (event.target.value === "normal") {
          this.speedSelection = 1;
        } else if (event.target.value === "fast") {
          this.speedSelection = 2;
        }
        this.updateNavModifier();
      });
    });

    const select = container.querySelector(".hexcrawl-character-selection select");
    if (select) {
      select.addEventListener("change", (event) => {
        game.merlin.hexcrawlNavigatorId = event.target.value;
        game.settings.set("merlins-miscellany", "hexcrawlNavigatorId", game.merlin.hexcrawlNavigatorId);
        this.updateNavModifier();
      });
      select.value = game.merlin.hexcrawlNavigatorId;
    }

    const modifierInfo = container.querySelector(".hexcrawl-navmod-info");
    if (modifierInfo) {
      this.navModifierTooltip = game.merlin._addCustomTooltip(modifierInfo, "");
      this.updateNavModifier(modifierInfo);
    }

    const dcInfo = container.querySelector(".hexcrawl-navdc-info");
    if (dcInfo) {
      this.updateNavDC(dcInfo);
    }

    const navigate = container.querySelector(".hexcrawl-navigation-action");
    if (navigate && !navigate.dataset.bound) {
      navigate.dataset.bound = "true";
      navigate.addEventListener("click", async () => {
        const roll = await new Roll(`1d20 + ${this.navMod}`).evaluate();
        const navigation = roll.dice[0].results[0].result;
        const bonusMove = this.speedSelection === 1 ? null : (await new Roll("1d4").evaluate()).total;
        const success = navigation + this.navMod >= this.navDC;
        const Day = game.merlin.hexcrawlDays;
        const movementDistance = this.speedSelection === 0
          ? (bonusMove !== null && bonusMove <= 2 ? -1 : 0)
          : this.speedSelection === 2
            ? (bonusMove !== null && bonusMove >= 3 ? 1 : 0)
            : 0;
        const perceptionModifier = this.speedSelection === 0 ? 5 : this.speedSelection === 2 ? -5 : 0;
        let flavor = "Navigation Check | Day " + Day + ", DC " + this.navDC + ": " + (success ? "Navigation Successful!" : "Lost!");
        if (movementDistance < 0) {
          flavor += " -1 Movement";
        } else if (movementDistance > 0) {
          flavor += " +1 Movement";
        }
        await game.merlin._setNavigationResult(Day, {
          lost: !success,
          movementDistance,
          perceptionModifier
        });
        await roll.toMessage({ flavor });
      });
    }
  }

  updateNavModifier(navModifier = null) {      
    let speed = 0;
    if(this.speedSelection == 0) speed = 5;
    else if(this.speedSelection == 2) speed = -5;

    const navigator = game.actors.get(game.merlin.hexcrawlNavigatorId);
    const navigatorMod = navigator?.system?.skills?.sur?.total ?? 0;

    const weatherCode = game.merlin.hexcrawlWeatherLog.at(game.merlin._getHexcrawlPeriodsLength() - 1);
    const disadvantage = weatherCode ? weatherCode.endsWith("b") : false;

    this.navMod = speed + navigatorMod;

    let tooltip = speed + " (Travel Speed) + " + navigatorMod + " (" + (navigator?.name ?? "No Navigator") + ")";
    if(disadvantage){
      tooltip += ", at Disadvantage (Weather)";
    }

    if(!navModifier){
      navModifier = document.getElementById("hexcrawl-navmod-info");
    }
    if(navModifier) {
      navModifier.textContent = (this.navMod > 0 ? "+" : "") + this.navMod;
      if (this.navModifierTooltip) {
        this.navModifierTooltip.textContent = tooltip;
      }
    }
  }

  updateNavDC(navDC = null) {
    if(!navDC){
      navDC = document.getElementById("hexcrawl-navdc-info");
    }
    if(!navDC) return;
    this.navDC = game.merlin.jungleTerrainNavDCs.get(this.terrainSelection) ?? 10;
    navDC.textContent = "DC " + this.navDC;      
  }

  async _crawlNextPeriodWeather() {
    // Temperature: a = normal, b = cold, c = hot
    // Wind: a = none, b = light, c = strong
    // Precipitation: a = none, b = light, c = heavy
    const roll = new Roll("3d20 + 1d4");
    await roll.evaluate();
    const results = roll.dice[0].results.map((r) => r.result);

    let temperature = "a";
    let wind = "a";
    let precipitation = "a";
    let special = "a";
    switch (this._getClimate()) {
      case "standard":
        if (results[0] <= 14) {
          temperature = "a";
        } else if (results[0] <= 17) {
          temperature = "b";
        } else {
          temperature = "c";
        }

        if (results[1] <= 12) {
          wind = "a";
        } else if (results[1] <= 17) {
          wind = "b";
        } else {
          wind = "c";
        }

        if (results[2] <= 12) {
          precipitation = "a";
        } else if (results[2] <= 17) {
          precipitation = "b";
        } else {
          precipitation = "c";
        }
        break;
      case "jungle":
        if (results[0] <= 2) {
          temperature = "b";
        } else if (results[0] <= 17) {
          temperature = "a";
        } else {
          temperature = "c";
        }

        if (results[1] <= 12) {
          wind = "a";
        } else if (results[1] <= 17) {
          wind = "b";
        } else {
          wind = "c";
        }

        if (results[2] <= 10) {
          precipitation = "a";
        } else if (results[2] <= 17) {
          precipitation = "b";
        } else {
          precipitation = "c";
          if (results[1] >= 18 || results[3] === 4) {
            special = "b";
          }
        }
        break;
    }
    const weatherCode = temperature + wind + precipitation + special;
    this.hexcrawlWeatherLog.push(weatherCode);
    let weatherStrings = {};
    this._getWeatherStrings(weatherCode, weatherStrings);

    const Day = Math.floor((this.hexcrawlWeatherLog.length - 1) / 3) + 1;
    const Time = (this.hexcrawlWeatherLog.length - 1) % 3;
    await roll.toMessage({
      flavor: "Weather Roll | Day " + Day + ", " + this._getTimeofDayString(Time) + ": " + weatherStrings.title
    });
  }

  _getTimeofDayString(time) {
    let timeString = "Morning";
    if (time === 1) {
      timeString = "Afternoon";
    } else if (time === 2) {
      timeString = "Night";
    }
    return timeString;
  }

  _getTerrainStrings(pixel) {
    let terrain = {};
    terrain.title = "None";
    terrain.water = "None";
    terrain.special = "None";
    // Determine water type
    switch(pixel[0].toString(16)){
      case "10": terrain.water = "River"; break;
      case "20": terrain.water = "Lake"; break;
      case "30": terrain.water = "Ocean"; break;
    }    
    if(pixel[2].toString(16) === "0" && pixel[0].toString(16) != "0"){
      terrain.title = terrain.water;
    }
    switch(game.merlin._getClimate()){
      case "standard":
        if(this.standardTerrains.has(pixel[2].toString(16))) {
          terrain.title = this.standardTerrains.get(pixel[2].toString(16));        
        }
        break;
      case "frigid":
        // todo
      case "jungle":
        switch(pixel[1].toString(16)){
          case "10": terrain.special = "Lesser Undead"; break;
          case "20": terrain.special = "Greater Undead"; break;
        }
        if(this.jungleTerrains.has(pixel[2].toString(16))) {
          terrain.title = this.jungleTerrains.get(pixel[2].toString(16));
        }
        break;
    }
    return terrain;
  }

  _getAvailableTerrains() {
    switch(game.merlin._getClimate()){
      case "standard":
        return this.standardTerrains;
      case "frigid":
        // todo
      case "jungle":
        return this.jungleTerrains;
    }
  }

  _crawlSetTime() {
    let timeCounter = document.getElementById("hexcrawl-time-counter");
    timeCounter.innerHTML = `<div class="hexcrawl-time-counter"><span>${this._getTimeofDayString(this.hexcrawlTime)}</span></div>`;
  }

  _getClimate() {
    if(canvas.scene?.flags?.merlin?.hexcrawlClimate){
      return canvas.scene?.flags?.merlin?.hexcrawlClimate;
    }
    return game.merlin.hexcrawlDefaultClimate;
  }

  lastTokenMovement = null;
  async _hexcrawlOnUpdateToken(destination, width, height) {
    if (this.hexcrawlDays <= 0) return;
    this.lastTokenMovement = {destination: destination, width: width, height: height};
    this._updateNavigationUI();
    this.lastTokenMovement = null;
  }

  _getPixel(x, y) {
    const image = game.merlin.hexcrawlTerrainImages.get(canvas.scene.flags.merlin.hexcrawlTerrain);
    if (!image) return null;
    if (x < 0 || y < 0 || x >= image._width || y >= image._height) {
      return null;
    }

    const imageCanvas = document.createElement("canvas");
    imageCanvas.width = 1;
    imageCanvas.height = 1;
    const ctx = imageCanvas.getContext("2d");
    ctx.drawImage(image.source, x, y, 1, 1, 0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data;
  }

  _addCustomTooltip(element, text) {
    const tooltip = document.createElement("div");
    tooltip.classList.add("hexcrawl-tooltip");
    tooltip.textContent = text;
    document.body.appendChild(tooltip);

    let timer = null;

    element.addEventListener("mouseenter", (event) => {
        timer = setTimeout(() => {
            tooltip.style.left = `${event.clientX + 12}px`;
            tooltip.style.top = `${event.clientY + 12}px`;
            tooltip.style.opacity = "1";
            tooltip.style.display = "block";
        }, 500);
    });

    element.addEventListener("mousemove", (event) => {
        tooltip.style.left = `${event.clientX + 12}px`;
        tooltip.style.top = `${event.clientY + 12}px`;
    });

    element.addEventListener("mouseleave", () => {
        clearTimeout(timer);
        tooltip.style.opacity = "0";
    });

    return tooltip;
  }

}

class HexcrawlPopup extends foundry.applications.api.ApplicationV2 {

    constructor(options = {}) {
      super(options);
    }
  
    static DEFAULT_OPTIONS = {
        id: "hexcrawl-popup",
        classes: ["hexcrawl-popup"],
        window: {
            title: "Hexcrawl Controls",
            resizable: true
        },
        position: {
            width: 400,
            height: 300
        }
    };

    async _onClose(options) {
        const popupButton = document.getElementById("hexcrawl-control-panel-button");
        if (popupButton) {
          popupButton.classList.toggle("active");
          game.merlin.hexcrawlMainInterfaceVisible = false;
          game.settings.set("merlins-miscellany", "hexcrawlMainInterfaceVisible", game.merlin.hexcrawlMainInterfaceVisible);
        }
    }

    async _renderHTML(context, options) {
        return `
            <div class="hexcrawl-navigation-box">
              <p>Hexcrawl controls have moved to the navigation panel.</p>
            </div>
        `;
    }

    _replaceHTML(result, content, options) {
      content.innerHTML = result;
    }
}

export function registerHexcrawlSettings(game) {
  game.settings.register("merlins-miscellany", "showHexcrawlUI", {
    name: "Show Hexcrawl UI",
    hint: "Whether to show the Hexcrawl UI when in a hexmap scene.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });
  game.settings.register("merlins-miscellany", "hexcrawlDefaultClimate", {
    name: "World Climate",
    hint: "Default climate to use in this world's overworld scenes.",
    scope: "world",
    config: true,
    type: String,
    default: "standard",
    choices: {
      standard: "Standard",
      jungle: "Jungle",
      frigid: "Frigid"
    }
  });
  game.settings.register("merlins-miscellany", "hexcrawlDays", {
    name: "Hexcrawl Days",
    hint: "Number of days that have passed in the hexcrawl world.",
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });
  game.settings.register("merlins-miscellany", "hexcrawlTime", {
    name: "Hexcrawl Time",
    hint: "Current time of day.",
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });
  game.settings.register("merlins-miscellany", "hexcrawlWeatherLog", {
    name: "Hexcrawl Weather Log",
    hint: "Log of weather conditions for each day.",
    scope: "world",
    config: false,
    type: Array,
    default: []
  });
  game.settings.register("merlins-miscellany", "hexcrawlNavigationResults", {
    name: "Hexcrawl Navigation Results",
    hint: "Navigation results for each day.",
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });
  game.settings.register("merlins-miscellany", "hexcrawlWeatherInterfaceVisible", {
    name: "Hexcrawl Weather Interface Visible",
    hint: "Whether the weather interface is visible.",
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });
  game.settings.register("merlins-miscellany", "hexcrawlNavigationInterfaceVisible", {
    name: "Hexcrawl Navigation Interface Visible",
    hint: "Whether the navigation interface is visible.",
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });
  game.settings.register("merlins-miscellany", "hexcrawlMainInterfaceVisible", {
    name: "Hexcrawl Main Interface Visible",
    hint: "Whether the main interface is visible.",
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });
  game.settings.register("merlins-miscellany", "hexcrawlNavigatorId", {
    name: "Hexcrawl Navigator ID",
    hint: "ID of character currently selected as navigator",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  if (!game.merlin) return;
  game.merlin.showHexcrawlUI = game.settings.get("merlins-miscellany", "showHexcrawlUI");
  game.merlin.hexcrawlDefaultClimate = game.settings.get("merlins-miscellany", "hexcrawlDefaultClimate");
  game.merlin.hexcrawlDays = game.settings.get("merlins-miscellany", "hexcrawlDays");
  game.merlin.hexcrawlTime = game.settings.get("merlins-miscellany", "hexcrawlTime");
  game.merlin.hexcrawlWeatherLog = game.settings.get("merlins-miscellany", "hexcrawlWeatherLog");
  game.merlin.hexcrawlNavigationResults = game.settings.get("merlins-miscellany", "hexcrawlNavigationResults");
  game.merlin.hexcrawlWeatherInterfaceVisible = game.settings.get("merlins-miscellany", "hexcrawlWeatherInterfaceVisible");
  game.merlin.hexcrawlNavigationInterfaceVisible = game.settings.get("merlins-miscellany", "hexcrawlNavigationInterfaceVisible");
  game.merlin.hexcrawlMainInterfaceVisible = game.settings.get("merlins-miscellany", "hexcrawlMainInterfaceVisible");
  game.merlin.hexcrawlNavigatorId = game.settings.get("merlins-miscellany", "hexcrawlNavigatorId");
}
