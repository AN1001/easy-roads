// What's drawn over the game in HTML: the controls hint, and on touch screens, a joystick to drive with.

// Phones and tablets: a touch screen, and no mouse or trackpad to point with.
export const touchScreen = matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;

const KEYS = [
  ['↑ ↓ ← →', 'drive'], ['Space', 'handbrake'], ['T', 'tow to the road'], ['R', 'back on wheels'],
  ['F', 'full screen'], ['M', 'sound'], ['H', 'this help'],
];
const SHOWN_FOR = 8;  // s after the first press, then it fades

// The keys, at the bottom of the screen until SHOWN_FOR s after the first press (or H). None on
// touch screens: the joystick explains itself.
export function createHint() {
  const hint = document.createElement('div');
  hint.className = 'hint';
  for (const [key, what] of KEYS) {
    const item = document.createElement('span');
    const kbd = document.createElement('kbd');
    kbd.textContent = key;
    item.append(kbd, ` ${what}`);
    hint.append(item);
  }
  if (!touchScreen) document.body.append(hint);
  let timer = 0;
  return {
    // A key or button pressed: the hint goes SHOWN_FOR s after the first.
    pressed() {
      if (!timer) timer = setTimeout(() => hint.classList.add('hidden'), SHOWN_FOR * 1000);
    },
    toggle() {
      clearTimeout(timer);
      timer = -1;  // only H brings it back or hides it now
      hint.classList.toggle('hidden');
    },
  };
}

// On touch screens, the only control: a joystick. Its ring rests at the bottom left; a thumb put
// down anywhere brings it there, and dragging steers (left and right, as far as it's pushed) and
// drives (up: accelerate; down: brake, then reverse), up to REACH CSS px from where it went down.
// Read `x` (-1 left to 1 right) and `y` (-1 down to 1 up) each frame; both 0 when let go. The first
// touch also goes full screen, held sideways where the browser allows (not on iPhones, which
// only do that for a page added to the home screen: index.html's web app tags).
const REACH = 60;  // px
export function createJoystick() {
  const ring = document.createElement('div'), knob = document.createElement('div');
  ring.className = 'joystick';
  knob.className = 'knob';
  ring.append(knob);
  document.body.append(ring);
  const stick = { x: 0, y: 0 };
  let finger = null, fromX = 0, fromY = 0;

  function move(e) {
    let dx = e.clientX - fromX, dy = e.clientY - fromY;
    const length = Math.hypot(dx, dy);
    if (length > REACH) { dx *= REACH / length; dy *= REACH / length; }
    stick.x = dx / REACH; stick.y = -dy / REACH;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  addEventListener('pointerdown', e => {
    if (finger !== null || e.pointerType === 'mouse') return;
    finger = e.pointerId;
    fromX = e.clientX; fromY = e.clientY;
    ring.style.left = `${fromX}px`; ring.style.top = `${fromY}px`;
    ring.classList.add('held');
    move(e);
  });
  addEventListener('pointermove', e => { if (e.pointerId === finger) move(e); });
  const up = e => {
    if (e.pointerId !== finger) return;
    finger = null;
    stick.x = stick.y = 0;
    knob.style.transform = '';
    ring.classList.remove('held');
    ring.style.left = ring.style.top = '';
  };
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
  addEventListener('pointerup', fullScreen, { once: true });
  return stick;
}

async function fullScreen() {
  try {
    await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
    await screen.orientation?.lock?.('landscape');
  } catch {}  // not allowed here: it stays as it is
}
