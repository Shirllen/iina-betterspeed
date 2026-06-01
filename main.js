var console = iina.console;
var core = iina.core;
var event = iina.event;
var input = iina.input;
var menu = iina.menu;
var mpv = iina.mpv;
var preferences = iina.preferences;

var MENU_TITLE = "Toggle Playback Speed";
var NORMAL_SPEED = 1.0;
var DEFAULT_FALLBACK_SPEED = 2.0;
var DEFAULT_HOLD_KEY = "SPACE";
var DEFAULT_TEMPORARY_SPEED = 2.0;
var DEFAULT_HOLD_TRIGGER_DELAY_MS = 250;
var SPEED_TOLERANCE = 0.0001;
var shortcutCache = null;
var holdKeyCache = null;
var activeHoldKey = "";
var ignoredSpeedQueue = [];
var temporaryHoldState = {
  active: false,
  restoreSpeed: NORMAL_SPEED,
  holdTriggered: false,
  isKeyDown: false,
  timerId: null
};

function trimString(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/^\s+|\s+$/g, "");
}

function isFiniteNumber(value) {
  return typeof value === "number" && isFinite(value);
}

function parseSpeed(value) {
  var speed = Number(value);
  return isFinite(speed) ? speed : NaN;
}

function isSameSpeed(left, right) {
  return Math.abs(left - right) < SPEED_TOLERANCE;
}

function isPositiveSpeed(speed) {
  return isFiniteNumber(speed) && speed > 0;
}

function isUsableToggleSpeed(speed) {
  return isPositiveSpeed(speed) && !isSameSpeed(speed, NORMAL_SPEED);
}

function getCurrentSpeed() {
  var currentSpeed = core.status.speed;
  if (!isPositiveSpeed(currentSpeed)) {
    return NORMAL_SPEED;
  }
  return currentSpeed;
}

function getSavedSpeed() {
  var savedSpeed = parseSpeed(preferences.get("saved_speed"));
  return isUsableToggleSpeed(savedSpeed) ? savedSpeed : null;
}

function getFallbackSpeed() {
  var fallbackSpeed = parseSpeed(preferences.get("fallback_speed"));
  if (!isUsableToggleSpeed(fallbackSpeed)) {
    return DEFAULT_FALLBACK_SPEED;
  }
  return fallbackSpeed;
}

function getShortcutKey() {
  var shortcut = preferences.get("shortcut_key");
  if (typeof shortcut !== "string") {
    return "z";
  }
  return trimString(shortcut);
}

function getHoldKey() {
  var holdKey = preferences.get("hold_key");
  if (typeof holdKey !== "string") {
    return DEFAULT_HOLD_KEY;
  }
  return trimString(holdKey);
}

function getTemporarySpeed() {
  var temporarySpeed = parseSpeed(preferences.get("temporary_speed"));
  if (!isPositiveSpeed(temporarySpeed)) {
    return DEFAULT_TEMPORARY_SPEED;
  }
  return temporarySpeed;
}

function queueIgnoredSpeed(speed) {
  if (isPositiveSpeed(speed)) {
    ignoredSpeedQueue.push(speed);
  }
}

function consumeIgnoredSpeed(speed) {
  var index;

  for (index = 0; index < ignoredSpeedQueue.length; index += 1) {
    if (isSameSpeed(ignoredSpeedQueue[index], speed)) {
      ignoredSpeedQueue.splice(index, 1);
      return true;
    }
  }

  return false;
}

function rememberSpeed(speed) {
  var currentSavedSpeed;

  if (!isUsableToggleSpeed(speed)) {
    return;
  }

  currentSavedSpeed = getSavedSpeed();
  if (currentSavedSpeed !== null && isSameSpeed(currentSavedSpeed, speed)) {
    return;
  }

  preferences.set("saved_speed", speed);
  preferences.sync();
}

function toggleSpeed() {
  var targetSpeed;
  var currentSpeed;

  if (core.status.idle) {
    core.osd("No media loaded");
    return;
  }

  currentSpeed = getCurrentSpeed();
  if (isSameSpeed(currentSpeed, NORMAL_SPEED)) {
    targetSpeed = getSavedSpeed();
    if (targetSpeed === null) {
      targetSpeed = getFallbackSpeed();
    }
  } else {
    rememberSpeed(currentSpeed);
    targetSpeed = NORMAL_SPEED;
  }

  core.setSpeed(targetSpeed);
}

function clearTemporaryHoldTimer() {
  if (temporaryHoldState.timerId === null) {
    return;
  }

  clearTimeout(temporaryHoldState.timerId);
  temporaryHoldState.timerId = null;
}

function clearTemporaryHoldInteraction() {
  clearTemporaryHoldTimer();
  temporaryHoldState.holdTriggered = false;
  temporaryHoldState.isKeyDown = false;
}

function beginTemporarySpeed() {
  var currentSpeed;
  var temporarySpeed;

  if (temporaryHoldState.active) {
    return true;
  }

  if (core.status.idle) {
    return false;
  }

  currentSpeed = getCurrentSpeed();
  temporarySpeed = getTemporarySpeed();

  temporaryHoldState.active = true;
  temporaryHoldState.restoreSpeed = currentSpeed;

  rememberSpeed(currentSpeed);

  if (!isSameSpeed(currentSpeed, temporarySpeed)) {
    queueIgnoredSpeed(temporarySpeed);
    core.setSpeed(temporarySpeed);
  }

  return true;
}

function endTemporarySpeed() {
  var restoreSpeed;
  var currentSpeed;

  if (!temporaryHoldState.active) {
    return false;
  }

  restoreSpeed = temporaryHoldState.restoreSpeed;
  temporaryHoldState.active = false;
  temporaryHoldState.restoreSpeed = NORMAL_SPEED;

  currentSpeed = getCurrentSpeed();
  if (!isSameSpeed(currentSpeed, restoreSpeed)) {
    core.setSpeed(restoreSpeed);
  }

  return true;
}

function scheduleTemporarySpeed() {
  clearTemporaryHoldTimer();
  temporaryHoldState.timerId = setTimeout(function () {
    temporaryHoldState.timerId = null;

    if (!temporaryHoldState.isKeyDown || temporaryHoldState.holdTriggered) {
      return;
    }

    if (beginTemporarySpeed()) {
      temporaryHoldState.holdTriggered = true;
    }
  }, DEFAULT_HOLD_TRIGGER_DELAY_MS);
}

function rebuildMenu() {
  var shortcut = getShortcutKey();
  var item;
  var options;

  menu.removeAllItems();

  try {
    if (shortcut) {
      options = { keyBinding: shortcut };
      item = menu.item(MENU_TITLE, toggleSpeed, options);
    } else {
      item = menu.item(MENU_TITLE, toggleSpeed);
    }
  } catch (error) {
    console.log("Invalid shortcut key '" + shortcut + "': " + error);
    item = menu.item(MENU_TITLE, toggleSpeed);
  }

  menu.addItem(item);
  menu.forceUpdate();
  shortcutCache = shortcut;
}

function refreshMenuShortcut() {
  var shortcut = getShortcutKey();
  if (shortcut !== shortcutCache) {
    rebuildMenu();
  }
}

function clearHoldKeyListeners(key) {
  if (!key) {
    return;
  }

  input.onKeyDown(key, null, input.PRIORITY_HIGH);
  input.onKeyUp(key, null, input.PRIORITY_HIGH);
}

function replayOriginalHoldKeyAction() {
  var holdKey = activeHoldKey || getHoldKey();

  if (!holdKey) {
    return;
  }

  clearHoldKeyListeners(holdKey);
  activeHoldKey = "";

  try {
    mpv.command("keypress", [holdKey]);
  } catch (error) {
    console.log("Failed to replay hold key '" + holdKey + "': " + error);
  }

  setTimeout(function () {
    rebuildHoldKeyListeners();
  }, 0);
}

function rebuildHoldKeyListeners() {
  var holdKey = getHoldKey();

  if (activeHoldKey && activeHoldKey !== holdKey) {
    clearTemporaryHoldInteraction();
    endTemporarySpeed();
    clearHoldKeyListeners(activeHoldKey);
    activeHoldKey = "";
  }

  if (!holdKey) {
    holdKeyCache = holdKey;
    return;
  }

  if (activeHoldKey === holdKey) {
    holdKeyCache = holdKey;
    return;
  }

  try {
    input.onKeyDown(
      holdKey,
      handleHoldKeyDown,
      input.PRIORITY_HIGH
    );
    input.onKeyUp(
      holdKey,
      handleHoldKeyUp,
      input.PRIORITY_HIGH
    );
    activeHoldKey = holdKey;
  } catch (error) {
    console.log("Invalid temporary speed key '" + holdKey + "': " + error);
    activeHoldKey = "";
  }

  holdKeyCache = holdKey;
}

function refreshHoldKeyListeners() {
  var holdKey = getHoldKey();
  if (holdKey !== holdKeyCache) {
    rebuildHoldKeyListeners();
  }
}

function refreshBindings() {
  refreshMenuShortcut();
  refreshHoldKeyListeners();
}

function handleHoldKeyDown(data) {
  if (temporaryHoldState.isKeyDown || data.isRepeat) {
    return true;
  }

  temporaryHoldState.isKeyDown = true;
  temporaryHoldState.holdTriggered = false;
  scheduleTemporarySpeed();
  return true;
}

function handleHoldKeyUp() {
  var shouldReplayOriginalAction = temporaryHoldState.isKeyDown && !temporaryHoldState.holdTriggered;

  clearTemporaryHoldTimer();
  temporaryHoldState.isKeyDown = false;

  if (temporaryHoldState.holdTriggered) {
    temporaryHoldState.holdTriggered = false;
    endTemporarySpeed();
    return true;
  }

  if (shouldReplayOriginalAction) {
    replayOriginalHoldKeyAction();
  }

  return true;
}

event.on("mpv.speed.changed", function () {
  var currentSpeed = getCurrentSpeed();

  if (consumeIgnoredSpeed(currentSpeed)) {
    return;
  }

  rememberSpeed(currentSpeed);
});

event.on("mpv.end-file", function () {
  clearTemporaryHoldInteraction();
  endTemporarySpeed();
});

rebuildMenu();
rebuildHoldKeyListeners();
setInterval(refreshBindings, 1000);
