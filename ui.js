// What's drawn over the game in HTML: the controls hint, and on touch screens, a joystick to drive with.

// Phones and tablets: a touch screen, and no mouse or trackpad to point with.
export const touchScreen = matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;

// The hint's lettering: a font of our own, 3 × 5 pixels a letter (each row's 3 bits, top to bottom),
// drawn into small canvases that the page scales up in sharp blocks, as it does the game's picture:
// real pixels in every browser, with no font to load. The arrows are 5 × 5 (ARROWS: the wider glyphs).
const FONT = {
  A: '25755', B: '65656', C: '34443', D: '65556', E: '74647', F: '74644', G: '34553', H: '55755', I: '72227',
  J: '11152', K: '55655', L: '44447', N: '65555', O: '75557', P: '65644', Q: '75571', R: '65655',
  S: '34216', T: '72222', U: '55557', V: '55552', X: '55255', Y: '55222', Z: '71247',
  '/': '11244', ' ': '00000',
};
// (M and W are 5 wide: at 3, M was H with one more pixel, and read as it.)
const ARROWS = {
  M: ['10001', '11011', '10101', '10001', '10001'], W: ['10001', '10001', '10101', '11011', '10001'],
  '↑': ['00000', '00100', '01110', '11111', '00000'], '↓': ['00000', '11111', '01110', '00100', '00000'],
  '←': ['00010', '00110', '01110', '00110', '00010'], '→': ['01000', '01100', '01110', '01100', '01000'],
};
// `text` as a canvas, a pixel of the font a pixel of it (CSS sizes it: --u px a pixel), in `color`.
function lettering(text, color) {
  const rows = [...text.toUpperCase()].map(c => ARROWS[c] ?? [...(FONT[c] ?? FONT[' '])].map(n => Number(n).toString(2).padStart(3, '0')));
  const canvas = document.createElement('canvas');
  canvas.width = rows.reduce((w, glyph) => w + glyph[0].length + 1, -1);
  canvas.height = 5;
  canvas.style.setProperty('--w', canvas.width);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  let x = 0;
  for (const glyph of rows) {
    glyph.forEach((row, y) => [...row].forEach((bit, k) => { if (bit === '1') ctx.fillRect(x + k, y, 1, 1); }));
    x += glyph[0].length + 1;
  }
  return canvas;
}
// A key: its cap, with what's printed on it. `kind`: 'wide' for the space bar, 'yellow' for H.
const INK = '#20241c', PALE = '#e9e5d2', YELLOW = '#ffd23f';
function keycap(label, kind = '') {
  const key = document.createElement('span');
  key.className = `key ${kind}`;
  key.append(lettering(label, INK));
  return key;
}
// What's shown: H on a row of its own, in the middle, in yellow, to catch the eye first (asked for,
// 14 Nov 2026); under it, left to right, the keys (several: the arrows, laid out as on a keyboard)
// and what they do.
const KEYS = [
  [['H'], 'hide / show help'],
  [['↑', '←', '↓', '→'], 'drive'], [['Space'], 'handbrake'], [['T'], 'tow to road'],
  [['R'], 'flip upright'], [['F'], 'full screen'], [['M'], 'sound on / off'],
];
const SHOWN_FOR = 8;  // s after the first press, then it fades

// The keys, at the bottom of the screen until SHOWN_FOR s after the first press (or H). None on
// touch screens: the joystick explains itself.
export function createHint() {
  const hint = document.createElement('div');
  hint.className = 'hint';
  const row = document.createElement('div');
  row.className = 'row';
  for (const [keys, what] of KEYS) {
    const item = document.createElement('span'), yellow = keys[0] === 'H';
    item.className = yellow ? 'item toggle' : 'item';
    if (keys.length > 1) {
      const arrows = document.createElement('span');
      arrows.className = 'arrows';
      arrows.append(...keys.map(key => keycap(key)));
      item.append(arrows);
    } else {
      item.append(keycap(keys[0], yellow ? 'yellow' : keys[0] === 'Space' ? 'wide' : ''));
    }
    item.append(lettering(what, yellow ? YELLOW : PALE));
    (yellow ? hint : row).append(item);
  }
  hint.append(row);
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
