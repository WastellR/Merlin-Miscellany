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
    if(canvas.scene?.flags?.merlin?.hexcrawl === true) controls.tokens.tools[hexcrawlButton.name] = hexcrawlButton;
    this._showHexcrawlUI(this.showHexcrawlUI && canvas.scene?.flags?.merlin?.hexcrawl === true);

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
      if (game.merlin.bShowingTileCaption) return;
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

    async function showTooltip(screenX, screenY, canvasX, canvasY) {
      if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.classList.add("hexcrawl-tooltip");
        document.body.appendChild(tooltip);
      }
      const pixel = await game.merlin._getTerrainMapPixel(canvasX, canvasY);
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

    // Hexcrawl interfaces
    let hexcrawlEncounterInterface = this._getOrAddElement("hexcrawl-encounter-interface", "hexcrawl-left-column");
    if (hexcrawlEncounterInterface) {
      hexcrawlEncounterInterface.className = "hexcrawl-encounter-interface";
      hexcrawlEncounterInterface.style.display = this.hexcrawlEncounterInterfaceVisible ? "block" : "none";
      this._updateEncounterUI();
    }

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
    let hexcrawlEncounterButton = this._getOrAddElement("hexcrawl-encounter-button", "hexcrawl-controls");
    if (hexcrawlEncounterButton) {
      hexcrawlEncounterButton.className = "hexcrawl-toggle-button icon fa-solid fa-dice-d20";
      if (this.hexcrawlEncounterInterfaceVisible) {
        hexcrawlEncounterButton.classList.add("active");
      }
      if (obj.isNew) {
        hexcrawlEncounterButton.addEventListener("click", () => {
          this.hexcrawlEncounterInterfaceVisible = !this.hexcrawlEncounterInterfaceVisible;
          game.settings.set("merlins-miscellany", "hexcrawlEncounterInterfaceVisible", this.hexcrawlEncounterInterfaceVisible);
          hexcrawlEncounterButton.classList.toggle("active", this.hexcrawlEncounterInterfaceVisible);
          this._updateEncounterUI();
        });
      }
    }
    let hexcrawlControlPanelButton = this._getOrAddElement("hexcrawl-control-panel-button", "hexcrawl-controls");
    if (hexcrawlControlPanelButton) {
      hexcrawlControlPanelButton.className = "hexcrawl-toggle-button icon fa-solid fa-hexagon";
      if (!this.hexcrawlPopup) {
        this.hexcrawlPopup = new HexcrawlPopup();
      }
      if(show){
        if (this.hexcrawlMainInterfaceVisible && this.hexcrawlDays > 0) {
          hexcrawlControlPanelButton.classList.add("active");
          this.hexcrawlPopup.render(true);
        }
      }
      else{
        this.hexcrawlPopup.close();
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
    game.settings.set("merlins-miscellany", "hexcrawlDays", this.hexcrawlDays);
    game.settings.set("merlins-miscellany", "hexcrawlTime", this.hexcrawlTime);
    this.hexcrawlNavigationControlsVisible = false;
    const numPeriods = this._getHexcrawlPeriodsLength() - this.hexcrawlWeatherLog.length;
    // Generate next day of weather
    for (let i = 0; i < numPeriods; i++) {
      await this._crawlNextPeriodWeather();
    }

    // Update UI for current time
    this._updateDaysUI();
    this._updateWeatherUI();
    this._crawlUpdateBackground();
  }

  _crawlPrevDay() {
    if (this.hexcrawlDays <= 1) return;
    this.hexcrawlDays--;
    this.hexcrawlTime = 0;
    game.settings.set("merlins-miscellany", "hexcrawlDays", this.hexcrawlDays);
    game.settings.set("merlins-miscellany", "hexcrawlTime", this.hexcrawlTime);
    this.hexcrawlNavigationControlsVisible = false;
    this._updateDaysUI();
    this._updateWeatherUI();
    this._crawlUpdateBackground();
  }

  async _crawlNextPeriod() {
    if (this.hexcrawlTime >= 2) {
      this.hexcrawlTime = 0;
      this._crawlNextDay();
    } else {
      this.hexcrawlTime++;
      game.settings.set("merlins-miscellany", "hexcrawlTime", this.hexcrawlTime);
      if (this._getHexcrawlPeriodsLength() > this.hexcrawlWeatherLog.length) {
        await this._crawlNextPeriodWeather();
      }
      this._updateDaysUI();
      this._updateWeatherUI();
    }
    this._crawlUpdateBackground();
  }

  _crawlPrevPeriod() {
    if (this.hexcrawlTime <= 0) {
      this.hexcrawlDays--;
      this.hexcrawlTime = 2;
      this.hexcrawlNavigationControlsVisible = false;
    } else {
      this.hexcrawlTime--;
    }
    game.settings.set("merlins-miscellany", "hexcrawlDays", this.hexcrawlDays);
    game.settings.set("merlins-miscellany", "hexcrawlTime", this.hexcrawlTime);
    this._updateDaysUI();
    this._updateWeatherUI();
    this._crawlUpdateBackground();
  }

  _crawlUpdateBackground() {
    if(!this.hexcrawlAutoUpdateBG) return;
    let desiredBackgroundInfo = {...this.currentBackgroundInfo};
    desiredBackgroundInfo.time = this.hexcrawlTime === 2 ? "night" : "day";
    const weatherCode = this.hexcrawlWeatherLog.at(this._getHexcrawlPeriodsLength() - 1);
    const [temperature, wind, precipitation, special] = weatherCode.split("");
    desiredBackgroundInfo.weather = precipitation === "a" ? "none" : "rain";
    if(this._updateBackground(desiredBackgroundInfo)){
      this.sceneMerlinTime[canvas.scene.id] = desiredBackgroundInfo.time;
      if(this.globalMerlinWeatherEnabled){
        this.globalMerlinTime = desiredBackgroundInfo.time;
      }
    }
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
    this._updateEncounterUI();
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

  _getEncounterDayKey(day = this.hexcrawlDays, time = this.hexcrawlTime) {
    return `${day}:${time}`;
  }

  _getEncounterResult(day = this.hexcrawlDays, time = this.hexcrawlTime) {
    return game.merlin.hexcrawlEncounterResults?.[this._getEncounterDayKey(day, time)] ?? null;
  }

  async _setEncounterResult(day, time, result) {
    const results = { ...(game.merlin.hexcrawlEncounterResults ?? {}) };
    const dayKey = this._getEncounterDayKey(day, time);
    if (result) {
      results[dayKey] = result;
    } else {
      delete results[dayKey];
    }

    game.merlin.hexcrawlEncounterResults = results;
    await game.settings.set("merlins-miscellany", "hexcrawlEncounterResults", results);
    this.hexcrawlEncounterControlsVisible = false;
    this._updateEncounterUI();
  }

  async _updateEncounterUI() {
    if(!this.showHexcrawlUI) return;
    const encounterResult = this._getEncounterResult();
    const hexcrawlEncounterInterface = document.getElementById("hexcrawl-encounter-interface");
    if (!hexcrawlEncounterInterface) return;

    const showControls = !encounterResult || this.hexcrawlEncounterControlsVisible;
    const cancelButton = encounterResult && showControls
      ? `
        <button type="button" class="hexcrawl-navigation-toggle hexcrawl-encounter-cancel" id="hexcrawl-encounter-cancel" aria-label="Cancel">
          <i class="fas fa-xmark"></i>
        </button>
      `
      : "";
    const rerollButton = encounterResult && !showControls && this.hexcrawlAllowRerolls
      ? `
        <div class="hexcrawl-encounter-reroll-hover-detector"></div>
        <button type="button" class="hexcrawl-navigation-toggle hexcrawl-encounter-reroll" id="hexcrawl-encounter-reroll" aria-label="Reroll">
          <i class="fas fa-rotate-right"></i>
        </button>
      `
      : "";

    hexcrawlEncounterInterface.innerHTML = `
      <div class="hexcrawl-encounter-box">
        <div class="hexcrawl-encounter-header">
          <div class="hexcrawl-encounter-title-row" style="display: ${showControls ? "none" : "flex"}">
            <div class="hexcrawl-encounter-title">${encounterResult?.encounterName && encounterResult?.encounterName != "No Encounter" && encounterResult?.encounterName != "Encounter!" ? `Encounter: ${encounterResult.encounterName}` : encounterResult?.encounterName}</div>
          </div>
        </div>
        ${showControls ? await this._renderEncounterControls(cancelButton) : ""}
        ${rerollButton}
      </div>
    `;
    hexcrawlEncounterInterface.style.display = this.hexcrawlEncounterInterfaceVisible ? "block" : "none";

    const resultBox = hexcrawlEncounterInterface.querySelector(".hexcrawl-encounter-box");
    if (resultBox) {
      const hasEncounter = !showControls && encounterResult?.encounterName && encounterResult.encounterName !== "No Encounter"
        && encounterResult?.encounterDescription != "";
      resultBox.classList.toggle("hexcrawl-encounter-box-result", hasEncounter);
      if (hasEncounter && !resultBox.dataset.bound) {
        resultBox.dataset.bound = "true";
        resultBox.tabIndex = 0;
        resultBox.setAttribute("role", "button");
        resultBox.setAttribute("aria-label", "Open encounter details");
        resultBox.addEventListener("click", () => this._openEncounterPopup(encounterResult));
        resultBox.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            this._openEncounterPopup(encounterResult);
          }
        });
      }
    }

    const cancel = hexcrawlEncounterInterface.querySelector(".hexcrawl-encounter-cancel");
    if (cancel) {
      const cancelTooltip = game.merlin._addCustomTooltip(cancel, "Cancel Reroll");
      cancel.addEventListener("click", () => {
        game.merlin._hideCustomTooltip(cancelTooltip);
        this.hexcrawlEncounterControlsVisible = !this.hexcrawlEncounterControlsVisible;
        this._updateEncounterUI();
      });
    }

    const reroll = hexcrawlEncounterInterface.querySelector(".hexcrawl-encounter-reroll");
    if (reroll) {
      const rerollTooltip = game.merlin._addCustomTooltip(reroll, "Reroll");
      reroll.addEventListener("click", () => {
        game.merlin._hideCustomTooltip(rerollTooltip);
        this.hexcrawlEncounterControlsVisible = !this.hexcrawlEncounterControlsVisible;
        this._updateEncounterUI();
      });
    }

    if (showControls) {
      this._bindEncounterControls(hexcrawlEncounterInterface);
    }
  }

  async _renderEncounterControls(cancelButton = "") {
    const terrains = this._getAvailableTerrains();
    const terrainSelection = await this._getNavigationTerrainSelection();
    this.terrainSelection = terrainSelection;

    return `
      <div class="hexcrawl-encounter-controls">
        <div class="hexcrawl-encounter-column hexcrawl-encounter-column-left">
          <div class="hexcrawl-control-group hexcrawl-terrain-selection">
            <div class="hexcrawl-control-title">Terrain</div>
            <select style="color: white">
              ${[...terrains].map(([key, value]) => `
                <option value="${key}" ${key === terrainSelection[2].toString(16) ? "selected" : ""}>
                  ${value}
                </option>
              `).join("")}
            </select>
          </div>
        </div>

        <div class="hexcrawl-encounter-column hexcrawl-encounter-column-right">
          <div class="hexcrawl-encounter-action-row">
            <div class="hexcrawl-encounter-action">
              <button type="button">Encounter</button>
            </div>
            ${cancelButton}
          </div>
        </div>
      </div>
    `;
  }

  _bindEncounterControls(container) {
    const terrainSelect = container.querySelector(".hexcrawl-terrain-selection select");
    if (terrainSelect) {
      terrainSelect.addEventListener("change", (event) => {
        this.terrainSelection = event.target.value;
      });
    }

    const encounter = container.querySelector(".hexcrawl-encounter-action");
    if (encounter && !encounter.dataset.bound) {
      encounter.dataset.bound = "true";
      encounter.addEventListener("click", async () => {
        const terrainSelection = this.terrainSelection || (await this._getNavigationTerrainSelection()).toString(16);
        const terrainTitleCode = terrainSelection.toString(16);
        const terrainName = this._getAvailableTerrains()?.get(terrainTitleCode) ?? terrainTitleCode ?? "";
        const day = this.hexcrawlDays;
        const time = this.hexcrawlTime;
        const roll = await new Roll("1d20").evaluate();
        const d20 = roll.total;
        let encounterName = "No Encounter";
        let encounterDescription = "";
        let tableId = null;
        let tableName = null;
        let bRolledEncounter = false;
        let tableRoll = null;

        if (d20 >= 16) {
          bRolledEncounter = true;
          const table = this._getEncounterTable(terrainSelection);
          if (table) {
            tableId = table.id ?? null;
            tableName = table.name ?? null;
            tableRoll = await table.draw({ displayChat: false });
            const encounterDraw = this._getEncounterDrawInfo(tableRoll);
            encounterName = encounterDraw.name || "Encounter!";
            encounterDescription = encounterDraw.description || "";
          }
          else{
            encounterName = "Encounter!"
          }
        }

        await this._setEncounterResult(day, time, {
          d20,
          day,
          time,
          terrainSelection,
          terrainName,
          encounterName,
          encounterDescription,
          tableId,
          tableName,
          noEncounter: encounterName === "No Encounter"
        });

        await roll.toMessage({
          flavor: `Encounter Roll | Day ${day}, ${this._getTimeofDayString(time)}: ${encounterName} ${encounterName != "No Encounter" && !tableId ? " (No Rollable Table)" : ""}`
        });
        if(bRolledEncounter){
          await ChatMessage.create({
            content: `
              <div class="dice-roll">
                <div class="dice-result">
                  <div>${tableName} Roll${encounterName != "Encounter" && encounterName != "No Encounter" ? (": " + encounterName) : ""}</div>
                  <div class="dice-formula">${tableRoll.roll._formula}</div>
                  <div class="dice-total">${tableRoll.roll._total}</div>
                </div>
              </div>
            `
          });          
        }
      });
    }
  }

  _getEncounterTable(inTerrainSelection) {    
    const tables = game.tables?.contents ?? [];
    
    function getTable(terrainSelection) {
        return tables.find(table => {
        const flagValue = table.flags?.merlin?.hexcrawlEncounters;
        if(flagValue === undefined) return null;
        if (Array.isArray(flagValue)) {
          if (flagValue.some(value => game.merlin._matchTerrainCodes(value, terrainSelection))) return table;
        }
        return game.merlin._matchTerrainCodes(flagValue, terrainSelection) ? table : null;
      }) ?? null;
    }
    // Prioritise water encounters
    let terrainSelection = {...inTerrainSelection};
    if(terrainSelection[0] != 0){
      terrainSelection[1], terrainSelection[2] = 0;
      const table = getTable(terrainSelection);
      if(table != null) return table;
      terrainSelection = {...inTerrainSelection};
    }
    return getTable(terrainSelection);
  }

  _matchTerrainCodes(terrainCode, terrainSelection){
    // terrainCode is the string attached to a table's flags, e.g. "10" == Coast, "001020" = Light Undead Jungle, "0010xx" = Light Undead, any terrain
    // terrainSelection is the unformatted pixel code
    if (terrainCode.length === 2) {
      return terrainCode == "xx" || terrainCode === this._getTerrainCodeString(terrainSelection[2]);
    }
    else if (terrainCode.length === 6) {
      let match = terrainCode.substring(0,2) === "xx" || terrainCode.substring(0,2) === this._getTerrainCodeString(terrainSelection[0]);
      match &&= terrainCode.substring(2,4) === "xx" || terrainCode.substring(2,4) === this._getTerrainCodeString(terrainSelection[1]);
      match &&= terrainCode.substring(4,6) === "xx" || terrainCode.substring(4,6) === this._getTerrainCodeString(terrainSelection[2]);
      return match;
    }
  }

  _getTerrainCodeString(code){
    let string = code.toString(16);
    if(code < 16) string = "0" + string;
    return string;
  }

  _getEncounterDrawName(drawResult) {
    if(drawResult.results.size <= 0) return "";
    return drawResult.results[0].name;
  }

  _getEncounterDrawInfo(drawResult) {
    const results = Array.isArray(drawResult?.results)
      ? drawResult.results
      : Array.from(drawResult?.results ?? []);
    const firstResult = results[0];
    if (!firstResult) return { name: "", description: "" };

    return {
      name: firstResult.name ?? firstResult.document?.name ?? "",
      description: firstResult.description ?? firstResult.document?.description ?? ""
    };
  }

  _openEncounterPopup(encounterResult) {
    if (!encounterResult?.encounterName || encounterResult.encounterName === "No Encounter") return;

    const day = encounterResult.day ?? this.hexcrawlDays;
    const time = encounterResult.time ?? this.hexcrawlTime;
    const title = `Day ${day}, ${this._getTimeofDayString(time)} Encounter${encounterResult.encounterName != "Encounter!" ? (": " + encounterResult.encounterName) : ""}`;
    new HexcrawlEncounterPopup({
      window: {
        title
      },
      description: encounterResult.encounterDescription ?? ""
    }).render(true);
  }

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
    await game.settings.set("merlins-miscellany", "hexcrawlNavigationResults", results);
    this.hexcrawlNavigationControlsVisible = false;
    this._updateNavigationUI();
  }

  async _updateNavigationUI() {
    if(!this.showHexcrawlUI) return;
    const navigationResult = this._getNavigationResult();
    const hexcrawlNavigationInterface = document.getElementById("hexcrawl-navigation-interface");
    if (!hexcrawlNavigationInterface) return;

    const showControls = !navigationResult || this.hexcrawlNavigationControlsVisible;
    const cancelButton = navigationResult && showControls
      ? `
        <button type="button" class="hexcrawl-navigation-toggle hexcrawl-navigation-cancel" id="hexcrawl-navigation-cancel" aria-label="Cancel">
          <i class="fas fa-xmark"></i>
        </button>
      `
      : "";
    const rerollButton = navigationResult && !showControls && this.hexcrawlAllowRerolls
      ? `
        <div class="hexcrawl-navigation-reroll-hover-detector"></div>
        <button type="button" class="hexcrawl-navigation-toggle hexcrawl-navigation-reroll" id="hexcrawl-navigation-reroll" aria-label="Reroll">
          <i class="fas fa-rotate-right"></i>
        </button>
      `
      : "";
    let bIsLost = false;
    if(!showControls && navigationResult){
      bIsLost = navigationResult.lost;
    }
    hexcrawlNavigationInterface.innerHTML = `
      <div class="hexcrawl-navigation-box">
        <div class="hexcrawl-navigation-header">          
          <div class="hexcrawl-navigation-title-row" style="display: ${showControls ? "none" : "flex"}">
            <div class="${bIsLost ? "hexcrawl-navigation-title-lost" : "hexcrawl-navigation-title"}">${bIsLost ? "Lost!" : "Navigation Success!"}</div>
          </div>
          <div class="hexcrawl-navigation-actions">
            ${cancelButton}
          </div>
        </div>
        <div class="hexcrawl-navigation-body">
          ${showControls ? await this._renderNavigationControls() : this._renderNavigationResults(navigationResult)}
        </div>
        ${rerollButton}
      </div>
    `;
    hexcrawlNavigationInterface.style.display = this.hexcrawlNavigationInterfaceVisible ? "block" : "none";

    const cancel = hexcrawlNavigationInterface.querySelector(".hexcrawl-navigation-cancel");
    if (cancel) {
      const cancelTooltip = game.merlin._addCustomTooltip(cancel, "Cancel Reroll");
      cancel.addEventListener("click", () => {
        game.merlin._hideCustomTooltip(cancelTooltip);
        this.hexcrawlNavigationControlsVisible = !this.hexcrawlNavigationControlsVisible;
        this._updateNavigationUI();
      });
    }

    const reroll = hexcrawlNavigationInterface.querySelector(".hexcrawl-navigation-reroll");
    if (reroll) {
      const rerollTooltip = game.merlin._addCustomTooltip(reroll, "Reroll");
      reroll.addEventListener("click", () => {
        game.merlin._hideCustomTooltip(rerollTooltip);
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

    let results = `<ul class="hexcrawl-navigation-list">`;
    if(movementDistance != 0){
      results += `<li><span class='hexcrawl-navigation-label'>Movement:</span> ${movementDistance}</li>`
    }
    if(perceptionModifier != 0){
      results += `<li><span class='hexcrawl-navigation-label'>Perception:</span> ${perceptionModifier}</li>`
    }
    results += `</ul>`;
    return results;
  }

  async _renderNavigationControls() {
    const terrains = this._getAvailableTerrains();
    const terrainSelection = await this._getNavigationTerrainSelection();
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
        <div class="hexcrawl-navigation-column hexcrawl-navigation-column-left">
          <div class="hexcrawl-control-group hexcrawl-speed-selection">
            <div class="hexcrawl-control-title">Travel Speed</div>
            <label class="hexcrawl-speed-option" id="hexcrawl-slow-speed">
              <input type="radio" name="speed" value="slow" ${this.speedSelection === 0 ? "checked" : ""}>
              Slow
            </label>
            <label class="hexcrawl-speed-option" id="hexcrawl-normal-speed">
              <input type="radio" name="speed" value="normal" ${this.speedSelection === 1 ? "checked" : ""}>
              Normal
            </label>
            <label class="hexcrawl-speed-option" id="hexcrawl-fast-speed">
              <input type="radio" name="speed" value="fast" ${this.speedSelection === 2 ? "checked" : ""}>
              Fast
            </label>
          </div>

          <div class="hexcrawl-control-group hexcrawl-character-selection">
            <div class="hexcrawl-control-title">Navigator</div>
            <select style="color: white">
              <option value="" disabled ${navigatorSelected ? "" : "selected"}>Select Navigator</option>
              ${actors.map(actor => `
                <option value="${actor.id}" ${actor.id === game.merlin.hexcrawlNavigatorId ? "selected" : ""}>
                  ${actor.name}
                </option>
              `).join("")}
            </select>
          </div>

          <div class="hexcrawl-control-group hexcrawl-terrain-selection">
            <div class="hexcrawl-control-title">Terrain</div>
            <select style="color: white">
              ${[...terrains].map(([key, value]) => `
                <option value="${key}" ${key === terrainSelection[2].toString(16) ? "selected" : ""}>
                  ${value}
                </option>
              `).join("")}
            </select>
          </div>
        </div>

        <div class="hexcrawl-navigation-column hexcrawl-navigation-column-right">
          <div class="hexcrawl-navmod-info" id="hexcrawl-navmod-info"></div>

          <div class="hexcrawl-navigation-action">
            <button type="button">Navigate</button>
          </div>

          <div class="hexcrawl-navdc-info" id="hexcrawl-navdc-info"></div>
        </div>
      </div>
    `;
  }

  async _getNavigationTerrainSelection() {
    if (this.terrainSelection && this.terrainSelection != ""
      && game.merlin.lastTokenMovement == null) {
        return this.terrainSelection;
    }
    if (canvas.scene?.tokens?.size > 0) {
      let token = canvas.scene.tokens.get(game.merlin._getPartyTokenId());
      if(!token) token = canvas.scene.tokens.contents[0];
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
      const pixel = await game.merlin._getTerrainMapPixel(centre.x, centre.y);
      if (pixel) return pixel;
    }
    const terrains = game.merlin._getAvailableTerrains?.();
    const firstTerrain = terrains ? [...terrains.keys()][0] : "";
    return [0, 0, parseInt(firstTerrain, 16)];
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

    const speedTooltipMap = {
      slow: "At a slow pace, characters have a 50% chance to move one hex fewer than usual. They also gain a +5 bonus to navigation checks, and to passive Wisdom (Perception) scores.",
      normal: "At a normal pace, characters can move 1 hex on foot, and 2 hexes by canoe.",
      fast: "At a fast pace, characters get a 50% chance to move one bonus hex. They also suffer a -5 penalty to navigation checks, and to passive Wisdom (Perception) scores."
    };
    container.querySelectorAll('input[name="speed"]').forEach(radio => {
      const label = radio.closest("label");
      if (!label) return;
      const tooltipText = speedTooltipMap[radio.value];
      if (tooltipText) {
        game.merlin._addCustomTooltip(label, tooltipText, 2000, "rgba(0, 0, 0, 0.9)");
        label.classList.add("hexcrawl-speed-tooltip-target");
      }
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
      this.navModifierTooltip = game.merlin._addCustomTooltip(modifierInfo, "", 500, "rgba(0, 0, 0, 0.9)");
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
        const partyToken = canvas.scene.tokens.get(this._getPartyTokenId());
        if(partyToken) {
          partyToken.update({"hidden": !success});
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
      navModifier.textContent = this.navMod === 0
        ? "No Bonus"
        : (this.navMod > 0 ? "+" : "") + this.navMod;
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
    await game.settings.set("merlins-miscellany", "hexcrawlWeatherLog", this.hexcrawlWeatherLog);
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
  async _hexcrawlOnUpdateToken(id, destination, width, height) {
    if (this.hexcrawlDays <= 0) return;
    if (this.hexcrawlPartyTokenId != id) return;
    this.lastTokenMovement = {destination: destination, width: width, height: height};
    this._updateNavigationUI();
    this._updateEncounterUI();
    this.lastTokenMovement = null;
  }

  async _getTerrainMapPixel(x, y){
    if (!this.hexcrawlTerrainImages.has(canvas.scene.flags.merlin.hexcrawlTerrain)) {
      const newTerrainTexture = await this._loadTexture(canvas.scene.flags.merlin.hexcrawlTerrain);
      if(newTerrainTexture){
        this.hexcrawlTerrainImages.set(canvas.scene.flags.merlin.hexcrawlTerrain, newTerrainTexture.baseTexture.resource);
      }
    }
    const image = this.hexcrawlTerrainImages.get(canvas.scene.flags.merlin.hexcrawlTerrain);
    return this._getPixel(x, y, image);
  }
  
  _getPixel(x, y, image) {    
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

  _getPartyTokenId() {
    if(this.hexcrawlPartyTokenId && canvas.scene.tokens.get(this.hexcrawlPartyTokenId)){
      return this.hexcrawlPartyTokenId;
    }
    if(canvas.scene.tokens.size > 0) {
      this.hexcrawlPartyTokenId = canvas.scene.tokens.contents[0].id;
      game.settings.set("merlins-miscellany", "hexcrawlPartyTokenId", this.hexcrawlPartyTokenId);
      return this.hexcrawlPartyTokenId;
    }
    return "";    
  }

  customTooltips = new Map();
  _addCustomTooltip(element, text, delay = 500, background = "") {
    // Give all elements at least a random id
    if(element.id === ""){
      console.warn("Element has no id, cannot be used with this function.");
      return;
    }
    let tooltip = null;
    if(this.customTooltips.has(element.id)){
      tooltip = this.customTooltips.get(element.id);      
    }
    else{
      tooltip = document.createElement("div");
      this.customTooltips.set(element.id, tooltip);
    }    
    tooltip.classList.add("hexcrawl-tooltip");
    tooltip.textContent = text;
    document.body.appendChild(tooltip);

    tooltip._hexcrawlTimer = null;

    element.addEventListener("mouseenter", (event) => {
        clearTimeout(tooltip._hexcrawlTimer);
        tooltip._hexcrawlTimer = setTimeout(() => {
            tooltip.style.left = `${event.clientX + 12}px`;
            tooltip.style.top = `${event.clientY + 12}px`;
            tooltip.style.opacity = "1";
            tooltip.style.display = "block";
            if(background != "") tooltip.style.background = background;
        }, delay);
    });

    element.addEventListener("mousemove", (event) => {
        tooltip.style.left = `${event.clientX + 12}px`;
        tooltip.style.top = `${event.clientY + 12}px`;
    });

    element.addEventListener("mouseleave", () => {
        clearTimeout(tooltip._hexcrawlTimer);
        tooltip.style.opacity = "0";
        tooltip.style.display = "none";
    });

    return tooltip;
  }

  _hideCustomTooltip(tooltip) {
    if (!tooltip) return;
    clearTimeout(tooltip._hexcrawlTimer);
    tooltip.style.display = "none";
    tooltip.style.opacity = "0";
  }

}

class HexcrawlPopup extends foundry.applications.api.ApplicationV2 {

    constructor(options = {}) {
      super(options);
      this.showRestartConfirm = false;
    }
  
    static DEFAULT_OPTIONS = {
        id: "hexcrawl-popup",
        classes: ["hexcrawl-popup"],
        window: {
            title: "Hexcrawl Settings",
            resizable: true
        },
        position: {
            width: 400,
            height: 400
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
          <div class="hexcrawl-popup-body">
            <section class="hexcrawl-popup-section hexcrawl-popup-partySelect">
              <div class="hexcrawl-popup-section-title">Party Token</div>
              <select class="hexcrawl-popup-select">
                ${canvas.scene.tokens.map(token => `
                    <option value="${token.id}" ${token.id === game.merlin._getPartyTokenId() ? "selected" : ""}>
                        ${game.actors.get(token.actorId)?.name}
                    </option>
                `).join("")}
              </select>
            </section>
            <section class="hexcrawl-popup-section hexcrawl-popup-rerolls">
              <label class="hexcrawl-popup-checkbox">
                <input type="checkbox" name="hexcrawl-allow-rerolls" ${game.merlin.hexcrawlAllowRerolls ? "checked" : ""}>
                <span>Allow Rerolls</span>
              </label>
              <label class="hexcrawl-popup-checkbox">
                <input type="checkbox" name="hexcrawl-update-bgs" ${game.merlin.hexcrawlAutoUpdateBG ? "checked" : ""}>
                <span>Auto-Update Backgrounds</span>
              </label>
            </section>
            <section class="hexcrawl-popup-section hexcrawl-popup-actions">
              <button type="button" class="hexcrawl-popup-button hexcrawl-popup-button-secondary" name="hexcrawl-restart-adventure">Restart Adventure</button>
            </section>
            ${this.showRestartConfirm ? `
              <section class="hexcrawl-popup-section hexcrawl-popup-confirm">
                <div class="hexcrawl-popup-confirm-text">Really clear all logs and restart adventure?</div>
                <div class="hexcrawl-popup-confirm-actions">
                  <button type="button" class="hexcrawl-popup-button hexcrawl-popup-button-danger" name="hexcrawl-restart-confirm">Restart</button>
                  <button type="button" class="hexcrawl-popup-button hexcrawl-popup-button-secondary" name="hexcrawl-restart-cancel">Cancel</button>
                </div>
              </section>
            ` : ""}
          </div>
        `;
    }

    _replaceHTML(result, content, options) {
      content.innerHTML = result;

      const partySelect = content.querySelector(".hexcrawl-popup-partySelect select");
      if (partySelect) {
        partySelect.addEventListener("change", (event) => {          
          game.merlin.hexcrawlPartyTokenId = event.target.value;
          game.settings.set("merlins-miscellany", "hexcrawlPartyTokenId", game.merlin.hexcrawlPartyTokenId);
          game.merlin.terrainSelection = "";
          game.merlin._updateNavigationUI();
          game.merlin._updateEncounterUI();
        });
      }

      const rerollsCheckbox = content.querySelector('input[name="hexcrawl-allow-rerolls"]');
      if (rerollsCheckbox) {
        rerollsCheckbox.addEventListener("change", (event) => {
          game.merlin.hexcrawlAllowRerolls = event.target.checked;
          game.settings.set("merlins-miscellany", "hexcrawlAllowRerolls", game.merlin.hexcrawlAllowRerolls);
          game.merlin._updateNavigationUI();
          game.merlin._updateEncounterUI();
        });
      }

      const autoUpdateCheckbox = content.querySelector('input[name="hexcrawl-update-bgs"]');
      if (autoUpdateCheckbox) {
        autoUpdateCheckbox.addEventListener("change", (event) => {
          game.merlin.hexcrawlAutoUpdateBG = event.target.checked;
          game.settings.set("merlins-miscellany", "hexcrawlAutoUpdateBG", game.merlin.hexcrawlAutoUpdateBG);
          
        });
      }

      const restartAdventureButton = content.querySelector('button[name="hexcrawl-restart-adventure"]');
      if (restartAdventureButton) {
        restartAdventureButton.addEventListener("click", () => {
          this.showRestartConfirm = true;
          this.render(true);
        });
      }

      const restartConfirmButton = content.querySelector('button[name="hexcrawl-restart-confirm"]');
      if (restartConfirmButton) {
        restartConfirmButton.addEventListener("click", () => {
          this._restartAdventure();
          this.showRestartConfirm = false;
        });
      }

      const restartCancelButton = content.querySelector('button[name="hexcrawl-restart-cancel"]');
      if (restartCancelButton) {
        restartCancelButton.addEventListener("click", () => {
          this.showRestartConfirm = false;
          this.render(true);
        });
      }
    }

    async _restartAdventure() {
      game.merlin.hexcrawlDays = 0;
      game.merlin.hexcrawlTime = 0;
      game.merlin.hexcrawlWeatherLog = [];
      game.merlin.hexcrawlNavigationResults = {};
      game.merlin.hexcrawlEncounterResults = {};
      game.settings.set("merlins-miscellany", "hexcrawlDays", game.merlin.hexcrawlDays);
      game.settings.set("merlins-miscellany", "hexcrawlTime", game.merlin.hexcrawlTime);
      game.settings.set("merlins-miscellany", "hexcrawlWeatherLog", game.merlin.hexcrawlWeatherLog);
      game.settings.set("merlins-miscellany", "hexcrawlNavigationResults", game.merlin.hexcrawlNavigationResults);
      game.settings.set("merlins-miscellany", "hexcrawlEncounterResults", game.merlin.hexcrawlEncounterResults);
      
      await this.close();
      game.merlin._showHexcrawlUI(game.merlin.showHexcrawlUI);
    }
}

class HexcrawlEncounterPopup extends foundry.applications.api.ApplicationV2 {

    constructor(options = {}) {
      super(options);
      this.encounterDescription = options.description ?? "";
    }
  
    static DEFAULT_OPTIONS = {
        id: "hexcrawl-encounter-popup",
        classes: ["hexcrawl-popup", "hexcrawl-encounter-popup"],
        window: {
            title: "Encounter",
            resizable: true
        },
        position: {
            width: 500,
            height: 320
        }
    };

    async _renderHTML(context, options) {
      const description = await TextEditor.enrichHTML(this.encounterDescription ?? "");
      return `
        <div class="hexcrawl-encounter-popup-box">
          <div class="hexcrawl-encounter-popup-description">${description}</div>
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
  game.settings.register("merlins-miscellany", "hexcrawlEncounterResults", {
    name: "Hexcrawl Encounter Results",
    hint: "Encounter results for each day and time period.",
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
  game.settings.register("merlins-miscellany", "hexcrawlEncounterInterfaceVisible", {
    name: "Hexcrawl Encounter Interface Visible",
    hint: "Whether the encounter interface is visible.",
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
  game.settings.register("merlins-miscellany", "hexcrawlAllowRerolls", {
    name: "Allow Rerolls",
    hint: "Whether the reroll buttons stay hidden on the encounter and navigation panels.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });
  game.settings.register("merlins-miscellany", "hexcrawlAutoUpdateBG", {
    name: "Auto-update Background",
    hint: "Whether to automatically update the background when the weather/time changes.",
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
  game.settings.register("merlins-miscellany", "hexcrawlPartyTokenId", {
    name: "Hexcrawl Party Token ID",
    hint: "ID of token used to represent the party in the world",
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
  game.merlin.hexcrawlEncounterResults = game.settings.get("merlins-miscellany", "hexcrawlEncounterResults");
  game.merlin.hexcrawlWeatherInterfaceVisible = game.settings.get("merlins-miscellany", "hexcrawlWeatherInterfaceVisible");
  game.merlin.hexcrawlNavigationInterfaceVisible = game.settings.get("merlins-miscellany", "hexcrawlNavigationInterfaceVisible");
  game.merlin.hexcrawlEncounterInterfaceVisible = game.settings.get("merlins-miscellany", "hexcrawlEncounterInterfaceVisible");
  game.merlin.hexcrawlMainInterfaceVisible = game.settings.get("merlins-miscellany", "hexcrawlMainInterfaceVisible");
  game.merlin.hexcrawlAllowRerolls = game.settings.get("merlins-miscellany", "hexcrawlAllowRerolls");
  game.merlin.hexcrawlAutoUpdateBG = game.settings.get("merlins-miscellany", "hexcrawlAutoUpdateBG");
  game.merlin.hexcrawlNavigatorId = game.settings.get("merlins-miscellany", "hexcrawlNavigatorId");
  game.merlin.hexcrawlPartyTokenId = game.settings.get("merlins-miscellany", "hexcrawlPartyTokenId");
}
