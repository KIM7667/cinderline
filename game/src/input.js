// Keyboard and mouse state, plus pointer lock. The simulation reads a plain
// state object each fixed step; look deltas are accumulated by the mouse
// handler and drained once per frame so no movement is lost or doubled.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = new Set(); // keys that went down since the last drain
  let lookX = 0;
  let lookY = 0;
  let firing = false;
  let aiming = false; // right mouse held (DMR zoom)
  let locked = false;

  function onKeyDown(event) {
    if (event.repeat) return;
    keys.add(event.code);
    pressed.add(event.code);
    if (['Space', 'Tab', 'ControlLeft'].includes(event.code)) event.preventDefault();
  }
  function onKeyUp(event) {
    keys.delete(event.code);
  }
  function onMouseMove(event) {
    if (!locked) return;
    lookX += event.movementX || 0;
    lookY += event.movementY || 0;
  }
  function onMouseDown(event) {
    if (!locked) return;
    if (event.button === 0) firing = true;
    if (event.button === 2) aiming = true;
  }
  function onMouseUp(event) {
    if (event.button === 0) firing = false;
    if (event.button === 2) aiming = false;
  }
  function onLockEvent() {
    locked = document.pointerLockElement === canvas;
    if (!locked) {
      firing = false;
      aiming = false;
      keys.clear();
    }
    onLockChange(locked);
  }
  function onContextMenu(event) {
    event.preventDefault();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('pointerlockchange', onLockEvent);

  return {
    state: { keys },
    get locked() {
      return locked;
    },
    get firing() {
      return firing;
    },
    get aiming() {
      return aiming;
    },
    requestLock() {
      canvas.requestPointerLock();
    },
    takeLook() {
      const out = { x: lookX, y: lookY };
      lookX = 0;
      lookY = 0;
      return out;
    },
    // One-shot key presses (buy menu, plant, throw) drained by the frame loop.
    takePressed() {
      const out = new Set(pressed);
      pressed.clear();
      return out;
    },
  };
}
