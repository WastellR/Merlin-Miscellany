export class Hexcrawl {
  _configureHexcrawlSceneControls(controls) {    

    // Add hexcrawl UI toggle button if we are in a hexcrawl scene
    if (canvas.scene?.flags?.merlin?.hexcrawl) {
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
    }

    this._showHexcrawlUI(canvas.scene?.flags?.merlin?.hexcrawl == true && this.showHexcrawlUI);
  }

  _showHexcrawlUI(show = true) {
    console.log("Merlin | Toggling hexcrawl UI to " + (show ? "show" : "hide"));
    const obj = { isNew: false };
    let beginAdventure = this._getOrAddElement("hexcrawl-begin-adventure", "ui-top", obj);
    if (beginAdventure) {
      if (obj.isNew) {
        beginAdventure.innerHTML = `<div><button class="hexcrawl-begin-adventure">Begin Adventure</button></div>`;
        beginAdventure?.addEventListener("click", () => {
          this._crawlNextDay();
          const hexcrawlLeftColumn = document.getElementById("hexcrawl-left-column");
          if (hexcrawlLeftColumn) {
            hexcrawlLeftColumn.style.display = "flex";
          }
        });
      }
      beginAdventure.style.display = this.hexcrawlDays === 0 && show ? "flex" : "none";
    }

    let hexcrawlLeftColumn = this._getOrAddElement("hexcrawl-left-column", "ui-left-column-1", obj, false, "players");
    if (hexcrawlLeftColumn) {
      hexcrawlLeftColumn.className = "hexcrawl-left-column";
      hexcrawlLeftColumn.style.display = this.hexcrawlDays > 0 && show ? "flex" : "none";
    }

    // Weather interface
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
      if (obj.isNew) {
        hexcrawlControlPanelButton.addEventListener("click", () => {
          hexcrawlControlPanelButton.classList.toggle("active");
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
    switch (this.hexcrawlClimate) {
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
      switch (this.hexcrawlClimate) {
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
    switch (this.hexcrawlClimate) {
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
    switch (this.hexcrawlClimate) {
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

  _crawlSetTime() {
    let timeCounter = document.getElementById("hexcrawl-time-counter");
    timeCounter.innerHTML = `<div class="hexcrawl-time-counter"><span>${this._getTimeofDayString(this.hexcrawlTime)}</span></div>`;
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
  game.settings.register("merlins-miscellany", "hexcrawlClimate", {
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
  game.settings.register("merlins-miscellany", "hexcrawlWeatherInterfaceVisible", {
    name: "Hexcrawl Weather Interface Visible",
    hint: "Whether the weather interface is visible.",
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  if (!game.merlin) return;
  game.merlin.showHexcrawlUI = game.settings.get("merlins-miscellany", "showHexcrawlUI");
  game.merlin.hexcrawlClimate = game.settings.get("merlins-miscellany", "hexcrawlClimate");
  game.merlin.hexcrawlDays = game.settings.get("merlins-miscellany", "hexcrawlDays");
  game.merlin.hexcrawlTime = game.settings.get("merlins-miscellany", "hexcrawlTime");
  game.merlin.hexcrawlWeatherLog = game.settings.get("merlins-miscellany", "hexcrawlWeatherLog");
  game.merlin.hexcrawlWeatherInterfaceVisible = game.settings.get("merlins-miscellany", "hexcrawlWeatherInterfaceVisible");
}
