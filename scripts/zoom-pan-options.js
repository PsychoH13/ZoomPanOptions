import { libWrapper } from './libwrapper-shim.js'

const MODULE_ID = 'zoom-pan-options'

// note: 'Default' is the old name for 'AutoDetect'
// 'DefaultMouse' is the old name for 'Mouse'

function getSetting (settingName) {
  return game.settings.get(MODULE_ID, settingName)
}

function checkRotationRateLimit (layer) {
  const hasTarget = layer.options?.controllableObjects ? layer.controlled.length : !!layer._hover
  if (!hasTarget)
    return false
  const t = Date.now()
  const rate_limit = isNewerVersion(game.version, '9.231')
    ? game.mouse.MOUSE_WHEEL_RATE_LIMIT
    : game.keyboard.constructor.MOUSE_WHEEL_RATE_LIMIT

  if ((t - game.keyboard._wheelTime) < rate_limit)
    return false
  game.keyboard._wheelTime = t
  return true
}

function getSettingsByModifiers() {
  let result = {}

  const zoomModifiers = getSetting('zoom-modifier')
  result[zoomModifiers] = 'zoom'

  const rotateModifiers = getSetting('rotate-modifier')
  if (!result[rotateModifiers])
    result[rotateModifiers] = 'rotate'

  const rotateSnapModifiers = getSetting('rotate-snap-modifier')
  if (!result[rotateSnapModifiers])
    result[rotateSnapModifiers] = 'rotate-snap'

  const panModifiers = getSetting('pan-modifier')
  if (!result[panModifiers])
    result[panModifiers] = 'pan'

  const horizontalPanModifiers = getSetting('horizontal-pan-modifier')
  if (!result[horizontalPanModifiers])
    result[horizontalPanModifiers] = 'horizontal-pan'

  return result
}

function modifiersForEvent(event) {
  let array = []
  if (event.shiftKey)
    array.push('shift')

  if (event.ctrlKey)
    array.push('ctrl')

  if (event.altKey)
    array.push('alt')

  if (event.metaKey)
    array.push('meta')

  return array.join('-')
}

/**
 * (note: return value is meaningless here)
 */
function _onWheel_Override (event) {
  const ctrlOrMeta = event.ctrlKey || event.metaKey  // meta key (cmd on mac, winkey in windows) will behave like ctrl

  const settingsByModifiers = getSettingsByModifiers()
  const eventModifiers = modifiersForEvent(event)
  const scrollMode = settingsByModifiers[eventModifiers]

  // Prevent zooming the entire browser window
  if (ctrlOrMeta) {
    event.preventDefault()
  }

  // Take no actions if the canvas is not hovered
  if (!canvas?.ready)
    return

  const hover = document.elementFromPoint(event.clientX, event.clientY)
  if (!hover || (hover.id !== 'board'))
    return

  event.preventDefault()

  const layer = canvas.activeLayer

  // Case 1 - rotate stuff
  if (layer instanceof PlaceablesLayer) {
    const deltaY = event.wheelDelta !== undefined ? event.wheelDelta
      // wheelDelta is undefined in firefox
      : event.deltaY

    if (scrollMode == 'rotate' || scrollMode == 'rotate-snap') {
      return checkRotationRateLimit(layer) && layer._onMouseWheel({
        deltaY: deltaY,
        shiftKey: scrollMode == 'rotate-snap',
      })
    }
  }

  // Case 2 - zoom the canvas
  if (scrollMode == 'zoom')
    return zoom(event)

  // Cast 3 - pan the canvas horizontally (shift+scroll)
  if (scrollMode == 'horizontal-pan') {
    // noinspection JSSuspiciousNameCombination
    return panWithMultiplier({
      deltaX: event.deltaY,
    })
  }

  // Case 4 - pan the canvas in the direction of the mouse/touchpad event
  if (scrollMode == 'pan')
    return panWithMultiplier(event)
}

/**
 * note - this is useless once we get to V10
 */
function _constrainView_Override ({ x, y, scale } = {}) {
  const d = canvas.dimensions

  // Constrain the maximum zoom level
  if (Number.isNumeric(scale) && scale !== canvas.stage.scale.x) {
    const max = CONFIG.Canvas.maxZoom
    const ratio = Math.max(d.width / window.innerWidth, d.height / window.innerHeight, max)
    // override changes are just for this part:
    if (getSetting('disable-zoom-rounding')) scale = Math.clamped(scale, 1 / ratio, max)
    else scale = Math.round(Math.clamped(scale, 1 / ratio, max) * 100) / 100
  } else {
    scale = canvas.stage.scale.x
  }

  // Constrain the pivot point using the new scale
  if (Number.isNumeric(x) && x !== canvas.stage.pivot.x) {
    const padw = 0.4 * (window.innerWidth / scale)
    x = Math.clamped(x, -padw, d.width + padw)
  } else x = canvas.stage.pivot.x
  if (Number.isNumeric(y) && x !== canvas.stage.pivot.y) {
    const padh = 0.4 * (window.innerHeight / scale)
    y = Math.clamped(y, -padh, d.height + padh)
  } else y = canvas.stage.pivot.y

  // Return the constrained view dimensions
  return { x, y, scale }
}

/**
 * Will zoom around cursor, and based on delta.
 */
function zoom (event) {
  const multiplier = getSetting('zoom-speed-multiplier')
  let dz = -event.deltaY * 0.0005 * multiplier + 1
  // default foundry behavior if zoom-speed-multiplier is 0
  if (multiplier === 0) dz = event.deltaY < 0 ? 1.05 : 0.95

  if (!getSetting('zoom-around-cursor')) {
    canvas.pan({ scale: dz * canvas.stage.scale.x })
    return
  }

  const scale = dz * canvas.stage.scale.x
  const d = canvas.dimensions
  const max = CONFIG.Canvas.maxZoom
  const min = 1 / Math.max(d.width / window.innerWidth, d.height / window.innerHeight, max)

  if (scale > max || scale < min) {
    canvas.pan({ scale: scale > max ? max : min })
    console.log('Zoom/Pan Options |', `scale limit reached (${scale}).`)
    return
  }

  // Acquire the cursor position transformed to Canvas coordinates
  const t = canvas.stage.worldTransform
  const dx = ((-t.tx + event.clientX) / canvas.stage.scale.x - canvas.stage.pivot.x) * (dz - 1)
  const dy = ((-t.ty + event.clientY) / canvas.stage.scale.y - canvas.stage.pivot.y) * (dz - 1)
  const x = canvas.stage.pivot.x + dx
  const y = canvas.stage.pivot.y + dy
  canvas.pan({ x, y, scale })
}

function panWithMultiplier (event) {
  const multiplier = (1 / canvas.stage.scale.x) * getSetting('pan-speed-multiplier')
  const invertVerticalScroll = getSetting('invert-vertical-scroll') ? -1 : 1
  const x = canvas.stage.pivot.x + event.deltaX * multiplier
  const y = canvas.stage.pivot.y + event.deltaY * multiplier * invertVerticalScroll
  canvas.pan({ x, y })
}

function disableMiddleMouseScrollIfMiddleMousePanIsActive (isActive) {
  if (isActive) {
    // this will prevent middle-click from showing the scroll icon
    document.body.onmousedown__disabled = document.body.onmousedown
    document.body.onmousedown = function (e) { if (e.button === 1) return false }
  } else {
    document.body.onmousedown = document.body.onmousedown__disabled
  }
}

function _handleMouseDown_Wrapper (wrapped, ...args) {
  if (!getSetting('middle-mouse-pan')) return wrapped(...args)
  const event = args[0]
  if (event.data.originalEvent.button === 0) return wrapped(...args) // left-click
  if (event.data.originalEvent.button !== 1) return // additional buttons other than middle click - still ignoring!

  // Middle-mouse click will *only* pan;  ignoring anything else on the canvas
  const mim = canvas.mouseInteractionManager
  if (![mim.states.HOVER, mim.states.CLICKED, mim.states.DRAG].includes(mim.state)) return wrapped(...args)
  canvas.currentMouseManager = mim

  // Update event data
  event.data.object = mim.object
  event.data.origin = event.data.getLocalPosition(mim.layer)

  // piggy-backing off of the right-mouse-drag code, for lack of a better option
  const action = 'clickRight'
  if (!mim.can(action, event)) return
  event.stopPropagation()
  mim._dragRight = true

  // Upgrade hover to clicked
  if (mim.state === mim.states.HOVER) mim.state = mim.states.CLICKED
  if (CONFIG.debug.mouseInteraction) console.log(`${mim.object.constructor.name} | ${action}`)

  // Trigger callback function
  mim.callback(action, event)

  // Activate drag handlers
  if ((mim.state < mim.states.DRAG) && mim.can('dragRight', event)) {
    mim._activateDragEvents()
  }
}

/**
 * Changes from original function:
 * `pad` value and `shift` divisor are both customizable instead of being the default of 25 and 2.
 */
function _onDragCanvasPan_override (event) {
  // Throttle panning by 200ms
  const now = Date.now()
  if (now - (this._panTime || 0) <= 200) return
  this._panTime = now

  // Shift by a few grid spaces at a time
  const { x, y } = event
  const pad = getSetting('pad-value-when-dragging')
  const shift = (this.dimensions.size * getSetting('shift-value-when-dragging')) / this.stage.scale.x

  // Shift horizontally
  let dx = 0
  if (x < pad) dx = -shift
  else if (x > window.innerWidth - pad) dx = shift

  // Shift vertically
  let dy = 0
  if (y < pad) dy = -shift
  else if (y > window.innerHeight - pad) dy = shift

  // Enact panning
  if (dx || dy) return this.animatePan({ x: this.stage.pivot.x + dx, y: this.stage.pivot.y + dy, duration: 200 })
}

const migrateOldSettings = () => {
  const mode = getSetting('pan-zoom-mode')
  if (mode === 'DefaultMouse') {
    console.log(`Zoom/Pan Options | Migrating old setting 'pan-zoom-mode': 'DefaultMouse' to 'Mouse'`)
    game.settings.set('zoom-pan-options', 'pan-zoom-mode', 'Mouse')
  }
  if (mode === 'Default') {
    console.log(`Zoom/Pan Options | Migrating old setting 'pan-zoom-mode': 'Default' to 'Mouse'`)
    game.settings.set('zoom-pan-options', 'pan-zoom-mode', 'Mouse')
  }

  if (mode === 'Mouse') {
    console.log(`Zoom/Pan Options | Migrating old setting 'zoom-pan-options': to zoom-modifier: '', rotate-modifier: 'ctrl', rotate-snap-modifier: 'shift', horizontal-pan-modifier: 'disabled', pan-modifier: 'disabled'`)
    game.settings.set('zoom-modifier', '')
    game.settings.set('rotate-modifier', 'ctrl')
    game.settings.set('rotate-snap-modifier', 'shift')
    game.settings.set('horizontal-pan-modifier', 'disabled')
    game.settings.set('pan-modifier', 'disabled')
  } else if (mode === 'Touchpad') {
    console.log(`Zoom/Pan Options | Migrating old setting 'zoom-pan-options': to zoom-modifier: 'ctrl', rotate-modifier: 'shift', rotate-snap-modifier: 'shift-ctrl', horizontal-pan-modifier: 'disabled', pan-modifier: 'disabled'`)
    game.settings.set('zoom-modifier', 'ctrl')
    game.settings.set('rotate-modifier', 'shift')
    game.settings.set('rotate-snap-modifier', 'shift-ctrl')
    game.settings.set('horizontal-pan-modifier', 'disabled')
    game.settings.set('pan-modifier', 'disabled')
  } else if (mode === 'Alternative') {
    console.log(`Zoom/Pan Options | Migrating old setting 'zoom-pan-options': to zoom-modifier: 'ctrl', rotate-modifier: 'shift-alt', rotate-snap-modifier: 'ctrl-alt', horizontal-pan-modifier: 'shift', pan-modifier: ''`)
    game.settings.set('zoom-modifier', 'ctrl')
    game.settings.set('rotate-modifier', 'shift-alt')
    game.settings.set('rotate-snap-modifier', 'ctrl-alt')
    game.settings.set('horizontal-pan-modifier', 'shift')
    game.settings.set('pan-modifier', '')
  }
}

Hooks.on('init', function () {
  console.log('Initializing Zoom/Pan Options')
  game.settings.register(MODULE_ID, 'zoom-around-cursor', {
    name: 'Zoom around cursor',
    hint: 'Center zooming around cursor. Does not apply to zooming with pageup or pagedown.',
    scope: 'client',
    config: true,
    default: true,
    type: Boolean,
  })
  game.settings.register(MODULE_ID, 'middle-mouse-pan', {
    name: 'Middle-mouse to pan',
    hint: 'Middle mouse press will pan the canvas, instead of the default of doing nothing.',
    scope: 'client',
    config: true,
    default: false,
    type: Boolean,
    onChange: disableMiddleMouseScrollIfMiddleMousePanIsActive,
  })
  game.settings.register(MODULE_ID, 'disable-zoom-rounding', {
    name: 'Disable zoom rounding',
    hint:
      'Disables default Foundry behavior, which rounds zoom to the nearest 1%. Will make zooming smoother, especially for touchpad users.',
    scope: 'client',
    config: true,
    default: true,
    type: Boolean,
  })
  game.settings.register(MODULE_ID, 'min-max-zoom-override', {
    name: 'Minimum/maximum zoom override',
    hint: 'Override for the minimum and maximum zoom scale limits. 3 is the Foundry default (x3 and x0.333 scaling).',
    scope: 'client',
    config: true,
    default: CONFIG.Canvas.maxZoom, // 3.0
    type: Number,
    onChange: value => {
      CONFIG.Canvas.maxZoom = value
    },
  })

  const modifierChoices = {
    '': '-',
    'shift': 'Shift',
    'ctrl': 'Ctrl',
    'alt': 'Alt',
    'meta': 'Meta',
    'shift-ctrl': 'Shift + Ctrl',
    'shift-alt': 'Shift + Alt',
    'shift-meta': 'Shift + Meta',
    'ctrl-alt': 'Ctrl + Alt',
    'ctrl-meta': 'Ctrl + Meta',
    'alt-meta': 'Alt + Meta',
    'shift-ctrl-alt': 'Shift + Ctrl + Alt',
    'shift-ctrl-meta': 'Shift + Ctrl + Meta',
    'shift-alt-meta': 'Shift + Alt + Meta',
    'ctrl-alt-meta': 'Ctrl + Alt + Meta',
    'shift-ctrl-alt-meta': 'Shift + Ctrl + Alt + Meta',
    'disabled': 'Disabled',
  }

  game.settings.register(MODULE_ID, 'zoom-modifier', {
    name: 'Scroll to Zoom Modifiers',
    hint: 'Key to hold to zoom.',
    scope: 'client',
    config: true,
    type: String,
    choices: modifierChoices,
    default: '',
  })
  game.settings.register(MODULE_ID, 'pan-modifier', {
    name: 'Scroll to Pan Modifiers',
    hint: 'Key to hold to pan.',
    scope: 'client',
    config: true,
    type: String,
    choices: modifierChoices,
    default: 'disabled',
  })
  game.settings.register(MODULE_ID, 'horizontal-pan-modifier', {
    name: 'Scroll to Pan Horizontally Modifiers',
    hint: 'Key to hold to pan horizontally. Useful if your mouse doesn\'t support horizontal scrolling.',
    scope: 'client',
    config: true,
    type: String,
    choices: modifierChoices,
    default: 'disabled',
  })
  game.settings.register(MODULE_ID, 'rotate-modifier', {
    name: 'Scroll to Rotate Modifiers',
    hint: 'Key to hold to rotate an item.',
    scope: 'client',
    config: true,
    type: String,
    choices: modifierChoices,
    default: 'ctrl',
  })
  game.settings.register(MODULE_ID, 'rotate-snap-modifier', {
    name: 'Scroll to Snap Rotate Modifiers',
    hint: 'Key to hold to rotate an item and snap to the grid.',
    scope: 'client',
    config: true,
    type: String,
    choices: modifierChoices,
    default: 'shift',
  })

  game.settings.register(MODULE_ID, 'zoom-speed-multiplier', {
    name: 'Zoom speed',
    hint:
      'Multiplies zoom speed, affecting scaling speed. 0.1 or 10 might be better for some touchpads. 0 for default Foundry behavior (which ignores scroll "intensity", and feels worse for touchpads).',
    scope: 'client',
    config: true,
    default: 0,
    type: Number,
  })
  game.settings.register(MODULE_ID, 'pan-speed-multiplier', {
    name: 'Pan speed',
    hint:
      'Multiplies pan speed. Defaults to 1, which should be close to the pan speed when right-click-dragging the canvas.',
    scope: 'client',
    config: true,
    default: 1,
    type: Number,
  })
  game.settings.register(MODULE_ID, 'invert-vertical-scroll', {
    name: 'Invert vertical scroll',
    hint: 'If set to true, you will scroll up when dragging/scrolling down.',
    scope: 'client',
    config: true,
    default: false,
    type: Boolean,
  })
  game.settings.register(MODULE_ID, 'pad-value-when-dragging', {
    name: '"pad" value when dragging something to the edge of the screen',
    hint:
      'When holding down the cursor and moving it towards the edge of the screen, the canvas will pan.  "pad" is the distance that will trigger it. Foundry default is 50px.',
    scope: 'client',
    config: true,
    default: 50,
    type: Number,
  })
  game.settings.register(MODULE_ID, 'shift-value-when-dragging', {
    name: '"shift" value when dragging something to the edge of the screen',
    hint:
      'When holding down the cursor and moving it towards the edge of the screen, the canvas will pan.  "shift" is the panning distance in tiles. Foundry default is 3 tiles.',
    scope: 'client',
    config: true,
    default: 3,
    type: Number,
  })
  migrateOldSettings()
})

Hooks.once('setup', function () {
  const wheelPrototype = isNewerVersion(game.version, '9.231')
    ? 'MouseManager.prototype._onWheel'
    : 'KeyboardManager.prototype._onWheel'

  libWrapper.register(
    MODULE_ID,
    wheelPrototype,
    (event) => {
      return _onWheel_Override(event)
    },
    'OVERRIDE',
  )
  if (isNewerVersion(game.version, '10.269')) {
    // temporary solution, due to constrainView becoming private in V10.
    // see https://github.com/foundryvtt/foundryvtt/issues/7382
    // or see https://github.com/foundryvtt/foundryvtt/issues/7189
    Hooks.on('canvasPan', (board, constrained) => {
      if (!getSetting('disable-zoom-rounding')) return

      const d = canvas.dimensions
      const max = CONFIG.Canvas.maxZoom
      const ratio = Math.max(d.width / window.innerWidth, d.height / window.innerHeight, max)
      constrained.scale = Math.clamped(constrained.scale, 1 / ratio, max)

      board.stage.scale.set(constrained.scale, constrained.scale)
      board.updateBlur(constrained.scale)
    })
  } else {
    libWrapper.register(
      MODULE_ID,
      'Canvas.prototype._constrainView',
      (obj) => {
        return _constrainView_Override(obj)
      },
      'OVERRIDE', // only overrides a tiny part of the function... would be nice if foundry made it more modular
    )
  }
  libWrapper.register(
    MODULE_ID,
    'Canvas.prototype._onDragCanvasPan',
    _onDragCanvasPan_override,
    'OVERRIDE', // (same as above)
  )
  libWrapper.register(
    MODULE_ID,
    'MouseInteractionManager.prototype._handleMouseDown',
    function (wrapped, ...args) {
      return _handleMouseDown_Wrapper.bind(this)(wrapped, ...args)
    },
    'MIXED', // only overrides if it's a middle click
  )
  disableMiddleMouseScrollIfMiddleMousePanIsActive(getSetting('middle-mouse-pan'))
  CONFIG.Canvas.maxZoom = getSetting('min-max-zoom-override')
  console.log('Done setting up Zoom/Pan Options.')
})
