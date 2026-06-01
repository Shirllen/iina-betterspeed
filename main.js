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
var activeShortcutKey = "";
var holdKeyCache = null;
var activeHoldKey = "";
var isWindowLoaded = false;
var holdKeyConflictCache = "";
var hasShownHoldKeyConflictWarning = false;
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

function normalizeKeyCode(code) {
  var trimmedCode = trimString(code);

  if (!trimmedCode) {
    return "";
  }

  try {
    return input.normalizeKeyCode(trimmedCode);
  } catch (error) {
    return trimmedCode.toUpperCase();
  }
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

function isSpaceKey(key) {
  return normalizeKeyCode(key) === "SPACE";
}

function getRegisteredBindingForKey(key) {
  var normalizedKey = normalizeKeyCode(key);
  var bindings;

  if (!normalizedKey) {
    return null;
  }

  try {
    bindings = input.getAllKeyBindings();
  } catch (error) {
    console.log("Failed to read current key bindings: " + error);
    return null;
  }

  if (!bindings || !bindings[normalizedKey]) {
    return null;
  }

  return bindings[normalizedKey];
}

function getIINACommandBindingForKey(key) {
  var binding = getRegisteredBindingForKey(key);

  if (!binding || !binding.isIINACommand) {
    return null;
  }

  return binding;
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
  var item;

  menu.removeAllItems();

  try {
    item = menu.item(MENU_TITLE, toggleSpeed);
  } catch (error) {
    console.log("Failed to rebuild plugin menu: " + error);
    item = menu.item(MENU_TITLE, toggleSpeed);
  }

  menu.addItem(item);
  if (isWindowLoaded) {
    setTimeout(function () {
      try {
        menu.forceUpdate();
      } catch (error) {
        console.log("Failed to refresh plugin menu: " + error);
      }
    }, 0);
  }
  shortcutCache = getShortcutKey();
}

function clearHoldKeyListeners(key) {
  if (!key) {
    return;
  }

  input.onKeyDown(key, null, input.PRIORITY_HIGH);
  input.onKeyUp(key, null, input.PRIORITY_HIGH);
}

function clearShortcutKeyListener(key) {
  if (!key) {
    return;
  }

  input.onKeyDown(key, null, input.PRIORITY_HIGH);
}

function handleShortcutKeyDown(data) {
  if (data.isRepeat) {
    return true;
  }

  toggleSpeed();
  return true;
}

function rebuildShortcutKeyListener() {
  var shortcut = getShortcutKey();

  if (activeShortcutKey && activeShortcutKey !== shortcut) {
    clearShortcutKeyListener(activeShortcutKey);
    activeShortcutKey = "";
  }

  if (!shortcut) {
    shortcutCache = shortcut;
    return;
  }

  if (activeShortcutKey === shortcut) {
    shortcutCache = shortcut;
    return;
  }

  try {
    input.onKeyDown(
      shortcut,
      handleShortcutKeyDown,
      input.PRIORITY_HIGH
    );
    activeShortcutKey = shortcut;
  } catch (error) {
    console.log("Invalid shortcut key '" + shortcut + "': " + error);
    activeShortcutKey = "";
  }

  shortcutCache = shortcut;
}

function refreshShortcutKeyListener() {
  var shortcut = getShortcutKey();
  if (shortcut !== shortcutCache) {
    rebuildShortcutKeyListener();
  }
}

function showHoldKeyConflictWarningIfNeeded() {
  var holdKey = getHoldKey();
  var message;

  if (!holdKeyConflictCache || !isWindowLoaded || hasShownHoldKeyConflictWarning) {
    return;
  }

  if (isSpaceKey(holdKey)) {
    message = "BetterSpeed: remap IINA's SPACE shortcut first, then SPACE tap/hold will work.";
  } else {
    message = "BetterSpeed: remap the temporary speed key in IINA before hold-to-speed can work.";
  }

  try {
    core.osd(message);
  } catch (error) {
    console.log("Failed to show hold key conflict warning: " + error);
  }

  hasShownHoldKeyConflictWarning = true;
}

function performSyntheticTapAction(holdKey) {
  if (!isSpaceKey(holdKey)) {
    return false;
  }

  try {
    mpv.command("cycle", ["pause"]);
    return true;
  } catch (error) {
    console.log("Failed to toggle pause for hold key '" + holdKey + "': " + error);
    return false;
  }
}

function replayOriginalHoldKeyAction() {
  var holdKey = activeHoldKey || getHoldKey();

  if (!holdKey) {
    return;
  }

  if (performSyntheticTapAction(holdKey)) {
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
  var holdKeyBinding;
  var holdKey = getHoldKey();

  if (activeHoldKey && activeHoldKey !== holdKey) {
    clearTemporaryHoldInteraction();
    endTemporarySpeed();
    clearHoldKeyListeners(activeHoldKey);
    activeHoldKey = "";
  }

  if (!holdKey) {
    holdKeyCache = holdKey;
    holdKeyConflictCache = "";
    hasShownHoldKeyConflictWarning = false;
    return;
  }

  holdKeyBinding = getIINACommandBindingForKey(holdKey);
  if (holdKeyBinding) {
    clearTemporaryHoldInteraction();
    endTemporarySpeed();
    clearHoldKeyListeners(activeHoldKey);
    activeHoldKey = "";
    holdKeyCache = holdKey;
    holdKeyConflictCache = normalizeKeyCode(holdKey);
    hasShownHoldKeyConflictWarning = false;
    console.log(
      "Temporary speed key '" +
        holdKey +
        "' is currently bound to IINA action '" +
        holdKeyBinding.action +
        "'. Remap that IINA shortcut first so BetterSpeed can detect holds."
    );
    showHoldKeyConflictWarningIfNeeded();
    return;
  }

  if (activeHoldKey === holdKey) {
    holdKeyCache = holdKey;
    holdKeyConflictCache = "";
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
  holdKeyConflictCache = "";
  hasShownHoldKeyConflictWarning = false;
}

function refreshHoldKeyListeners() {
  var holdKeyBinding;
  var holdKeyConflict = "";
  var holdKey = getHoldKey();

  if (holdKey) {
    holdKeyBinding = getIINACommandBindingForKey(holdKey);
    if (holdKeyBinding) {
      holdKeyConflict = normalizeKeyCode(holdKey);
    }
  }

  if (holdKey !== holdKeyCache || holdKeyConflict !== holdKeyConflictCache) {
    rebuildHoldKeyListeners();
  }
}

function refreshBindings() {
  refreshShortcutKeyListener();
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

event.on("iina.window-loaded", function () {
  isWindowLoaded = true;
  showHoldKeyConflictWarningIfNeeded();
});

event.on("iina.file-loaded", function () {
  showHoldKeyConflictWarningIfNeeded();
});

rebuildMenu();
rebuildShortcutKeyListener();
rebuildHoldKeyListeners();
setInterval(refreshBindings, 1000);
