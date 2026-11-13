/* ============================================================
   Web Studio Tycoon — wst-3d.js : bureau 3D du studio (Three.js)
   Chargé APRÈS wst-v20.js. Remplace le bureau SVG de l'accueil par
   une vraie scène 3D qui lit G (équipe, niveau de bureau, outil,
   jour/nuit, argent) sans jamais écrire dans G.
   Plan B : si Three.js ne charge pas (hors ligne) ou si le WebGL
   n'est pas disponible, le bureau SVG d'origine reste affiché.
   Three.js : cherche d'abord « three.min.js » à côté de index.html
   (mode 100 % hors ligne), sinon le CDN cdnjs (r128, version fixe).
   ============================================================ */
(function () {
  'use strict';
  function safe(fn, fb) { try { return fn(); } catch (e) { try { console.warn('[wst3d]', e); } catch (_) {} return fb; } }

  var LS = 'wst3d';
  function prefOn() { return safe(function () { return localStorage.getItem(LS) !== 'off'; }, true); }
  function setPref(on) { safe(function () { localStorage.setItem(LS, on ? 'on' : 'off'); }); }
  var URLS = ['three.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'];

  var S = {
    active: false, gl: false, tried: false, THREE: null,
    renderer: null, scene: null, camera: null, hemi: null, dir: null, pt: null,
    room: null, sig: '', dim: { W: 8, D: 6, H: 3 },
    night: 0, nightT: 0, az: 0.66, azT: 0.66, el: 0.55,
    visible: false, raf: 0, last: 0, t: 0, interacted: false, hintShown: false,
    persons: [], pick: [], cat: null, sway: [], leds: [], holo: null, coins: [], screens: [], winNight: [], ledT: 0,
    lastMoney: null, quality: 1, slow: 0, w: 0, h: 0, hud: null, hudKey: ''
  };

  /* ---------- Chargement de Three.js ---------- */
  function loadThree(cb) {
    if (window.THREE) { S.THREE = window.THREE; return cb(true); }
    (function next(i) {
      if (i >= URLS.length) return cb(false);
      var s = document.createElement('script');
      s.async = true; s.src = URLS[i];
      s.onload = function () { if (window.THREE) { S.THREE = window.THREE; cb(true); } else next(i + 1); };
      s.onerror = function () { try { s.parentNode && s.parentNode.removeChild(s); } catch (_) {} next(i + 1); };
      document.head.appendChild(s);
    })(0);
  }

  /* ---------- Styles ---------- */
  safe(function () {
    var st = document.createElement('style');
    st.textContent =
      '.wst3d{position:relative;height:clamp(220px,60vw,320px);background:radial-gradient(120% 90% at 50% 0%,#cfe8ff,#eaf4ff 55%,#d3e4f4);transition:background .9s ease}' +
      '.wst3d.night{background:radial-gradient(120% 90% at 50% 0%,#1d2760,#0a0f2e 72%)}' +
      '.wst3d canvas{display:block;width:100%;height:100%;touch-action:pan-y;outline:none;-webkit-user-select:none;user-select:none}' +
      '.wst3dHud{position:absolute;left:10px;right:10px;top:8px;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;pointer-events:none}' +
      '.wst3dHud>div{background:rgba(9,14,28,.58);color:#fff;border-radius:12px;padding:5px 10px;font-size:12px;line-height:1.35;max-width:64%}' +
      '.wst3dHud>div+div{text-align:right;max-width:36%}' +
      '.wst3dHud b{display:block;font-weight:800;font-size:13px}' +
      '.wst3dHud span{color:#cbd5e1;font-size:11px}' +
      '.wst3dHint{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);background:rgba(9,14,28,.62);color:#e2e8f0;border-radius:999px;padding:5px 12px;font-size:11px;white-space:nowrap;pointer-events:none;animation:wst3dHint 6.5s ease forwards}' +
      '@keyframes wst3dHint{0%,70%{opacity:1}100%{opacity:0;visibility:hidden}}' +
      '@media (prefers-reduced-motion:reduce){.wst3dHint{animation:none;opacity:0}}';
    document.head.appendChild(st);
  });

  /* ---------- Outils de construction ---------- */
  var GC = {}, MC = {};
  function geo(key, mk) { return GC[key] || (GC[key] = mk()); }
  function box(w, h, d) { return geo('b' + w + '_' + h + '_' + d, function () { return new S.THREE.BoxGeometry(w, h, d); }); }
  function cyl(rt, rb, h, n) { return geo('c' + rt + '_' + rb + '_' + h + '_' + n, function () { return new S.THREE.CylinderGeometry(rt, rb, h, n); }); }
  function sph(r, w, h) { return geo('s' + r + '_' + w + '_' + h, function () { return new S.THREE.SphereGeometry(r, w || 10, h || 8); }); }
  function lam(c) { return MC['l' + c] || (MC['l' + c] = new S.THREE.MeshLambertMaterial({ color: c })); }
  function bas(c) { return MC['b' + c] || (MC['b' + c] = new S.THREE.MeshBasicMaterial({ color: c })); }
  function mesh(g, m, x, y, z, parent, cast, recv) {
    var o = new S.THREE.Mesh(g, m);
    o.position.set(x || 0, y || 0, z || 0);
    if (cast) o.castShadow = true;
    if (recv) o.receiveShadow = true;
    if (parent) parent.add(o);
    return o;
  }
  function grp(x, y, z, parent) {
    var g = new S.THREE.Group(); g.position.set(x || 0, y || 0, z || 0);
    if (parent) parent.add(g); return g;
  }
  function G_() { return (typeof G !== 'undefined') ? G : null; }
  function isNight() { var g = G_(); return !!(g && typeof g.day === 'number' && g.day % 2 === 0); }

  /* ---------- Textures dessinées au canvas ---------- */
  var TC = {};
  function canvasTex(key, w, h, draw, repeat) {
    var c = TC[key];
    if (!c) { c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); TC[key] = c; }
    var t = new S.THREE.CanvasTexture(c);
    if (repeat) t.wrapS = t.wrapT = S.THREE.RepeatWrapping;
    return t;
  }
  function rnd(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function floorTex(lvl) {
    var base = ['#b98a5e', '#a9835a', '#c29a6b', '#9c7a5a', '#8f6f55'][lvl] || '#b98a5e';
    return canvasTex('floor' + lvl, 256, 256, function (x, w, h) {
      var r = rnd(7 + lvl); x.fillStyle = base; x.fillRect(0, 0, w, h);
      for (var i = 0; i < 8; i++) {
        x.fillStyle = 'rgba(' + (r() > .5 ? '255,255,255' : '0,0,0') + ',' + (0.04 + r() * 0.07) + ')';
        x.fillRect(0, i * 32, w, 32);
        x.fillStyle = 'rgba(0,0,0,.28)'; x.fillRect(0, i * 32, w, 2);
        var off = r() * 200; x.fillRect(off, i * 32, 2, 32);
      }
    }, true);
  }
  function screenTex() {
    return canvasTex('screen', 128, 128, function (x, w, h) {
      var r = rnd(42); x.fillStyle = '#0b1220'; x.fillRect(0, 0, w, h);
      var cols = ['#22d3ee', '#a78bfa', '#4ade80', '#fbbf24', '#f472b6', '#94a3b8'];
      for (var i = 0; i < 18; i++) {
        var ind = Math.floor(r() * 3) * 10, ww = 18 + r() * 70;
        x.fillStyle = cols[Math.floor(r() * cols.length)]; x.fillRect(8 + ind, 6 + i * 7, ww, 3);
      }
    }, true);
  }
  function skyTex(night) {
    return canvasTex(night ? 'skyN' : 'skyD', 64, 96, function (x, w, h) {
      var g = x.createLinearGradient(0, 0, 0, h);
      if (night) { g.addColorStop(0, '#0a0f2e'); g.addColorStop(1, '#2a2f6b'); } else { g.addColorStop(0, '#7cc4ff'); g.addColorStop(1, '#dff1ff'); }
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      var r = rnd(night ? 5 : 9);
      if (night) {
        x.fillStyle = '#fff'; for (var i = 0; i < 18; i++) x.fillRect(r() * w, r() * h * .7, 1.5, 1.5);
        x.fillStyle = '#fef3c7'; x.beginPath(); x.arc(w * .72, h * .22, 7, 0, 6.3); x.fill();
      } else {
        x.fillStyle = 'rgba(255,255,255,.85)';
        for (var j = 0; j < 3; j++) { var cx = r() * w, cy = 14 + r() * 40; x.beginPath(); x.arc(cx, cy, 8, 0, 6.3); x.arc(cx + 9, cy + 2, 6, 0, 6.3); x.arc(cx - 8, cy + 3, 5, 0, 6.3); x.fill(); }
      }
    });
  }
  function signTex() {
    return canvasTex('sign', 256, 72, function (x, w, h) {
      x.fillStyle = '#0b1030'; x.fillRect(0, 0, w, h);
      x.strokeStyle = '#22d3ee'; x.lineWidth = 4; x.strokeRect(5, 5, w - 10, h - 10);
      x.font = '800 34px system-ui,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.shadowColor = '#ec4899'; x.shadowBlur = 12; x.fillStyle = '#fbcfe8'; x.fillText('WEB STUDIO', w / 2, h / 2 + 2);
    });
  }
  var LABELS = {};
  function labelSprite(text) {
    if (LABELS[text]) return LABELS[text].clone();
    var c = document.createElement('canvas'); c.width = 256; c.height = 64; var x = c.getContext('2d');
    x.fillStyle = 'rgba(9,14,28,.78)';
    x.beginPath(); if (x.roundRect) x.roundRect(4, 8, 248, 48, 24); else x.rect(4, 8, 248, 48); x.fill();
    x.font = '700 28px system-ui,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff';
    x.fillText(String(text).slice(0, 14), 128, 33);
    var s = new S.THREE.Sprite(new S.THREE.SpriteMaterial({ map: new S.THREE.CanvasTexture(c), transparent: true, depthTest: false }));
    s.scale.set(1.35, 0.34, 1); s.renderOrder = 10; LABELS[text] = s; return s.clone();
  }

  /* ---------- Personnages, bureaux, décor ---------- */
  function personColors(seed, hero) {
    var sn = (typeof seedNum === 'function') ? seedNum(seed) : 7;
    var P = function (arr, off) { return arr[(sn + off) % arr.length]; };
    var skin = typeof SKIN !== 'undefined' ? P(SKIN, 1) : '#f1c27d';
    var hair = typeof HAIR !== 'undefined' ? P(HAIR, 3) : '#222222';
    var shirt = typeof SHIRT !== 'undefined' ? P(SHIRT, 5) : '#3f8fd2';
    return { skin: skin, hair: hero ? '#222222' : hair, shirt: hero ? '#1f2937' : shirt, st: sn % 5 };
  }
  function makeHair(head, st, col) {
    var m = lam(col);
    var cap = function (y) { mesh(geo('cap', function () { return new S.THREE.SphereGeometry(0.205, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55); }), m, 0, y, 0, head, true); };
    if (st === 0) cap(0.01);
    else if (st === 1) mesh(sph(0.27, 10, 8), m, 0, 0.06, 0.02, head, true);
    else if (st === 2) { cap(0.01); mesh(box(0.34, 0.42, 0.08), m, 0, -0.1, 0.15, head, true); }
    else if (st === 3) { cap(0.01); mesh(sph(0.085, 8, 6), m, -0.2, 0.13, 0, head); mesh(sph(0.085, 8, 6), m, 0.2, 0.13, 0, head); }
    else { mesh(sph(0.26, 10, 8), m, 0, 0.07, 0.02, head, true); mesh(sph(0.12, 8, 6), m, -0.2, 0.2, 0, head); mesh(sph(0.12, 8, 6), m, 0.2, 0.2, 0, head); mesh(sph(0.12, 8, 6), m, 0, 0.3, 0, head); }
  }
  function makePerson(p, hero, parent, x, z) {
    var c = personColors(p.seed, hero), g = grp(x, 0, z, parent);
    var ph = (x * 3 + z) % 6.28;
    mesh(box(0.46, 0.5, 0.28), lam(c.shirt), 0, 0.85, 0, g, true);
    var head = grp(0, 1.27, 0, g);
    mesh(sph(0.19, 12, 10), lam(c.skin), 0, 0, 0, head, true);
    makeHair(head, c.st, c.hair);
    if (hero) { var hp = mesh(geo('hp', function () { return new S.THREE.TorusGeometry(0.2, 0.03, 6, 14, Math.PI); }), lam('#22d3ee'), 0, 0.02, 0, head); hp.rotation.z = 0; }
    var arms = [];
    [-1, 1].forEach(function (s) {
      var sh = grp(s * 0.3, 1.02, -0.02, g);
      mesh(box(0.11, 0.11, 0.42), lam(c.shirt), 0, 0, -0.2, sh, true);
      mesh(box(0.1, 0.1, 0.1), lam(c.skin), 0, 0, -0.45, sh);
      sh.rotation.x = -0.75; arms.push(sh);
      mesh(box(0.17, 0.17, 0.46), lam('#334155'), s * 0.12, 0.54, -0.2, g, true);
      mesh(box(0.15, 0.46, 0.15), lam('#334155'), s * 0.12, 0.28, -0.42, g);
    });
    g.userData.pick = { type: hero ? 'hero' : 'person', name: p.name, role: p.role, bump: 0 };
    g.userData.anim = { head: head, arms: arms, ph: ph, base: 0 };
    S.persons.push(g); S.pick.push(g);
    var lb = labelSprite(p.name); lb.position.set(0, 1.95, 0); g.add(lb);
    return g;
  }
  function makeChair(parent, x, z) {
    var g = grp(x, 0, z, parent), col = '#2b3445';
    mesh(cyl(0.2, 0.24, 0.06, 8), lam('#1e2633'), 0, 0.05, 0, g);
    mesh(cyl(0.03, 0.03, 0.4, 6), lam('#1e2633'), 0, 0.27, 0, g);
    mesh(box(0.52, 0.08, 0.5), lam(col), 0, 0.5, 0, g, true);
    mesh(box(0.5, 0.6, 0.07), lam(col), 0, 0.84, 0.26, g, true);
  }
  function makeMonitor(parent, x, z, w, ry, on, texIdx) {
    var g = grp(x, 0.79, z, parent); g.rotation.y = ry || 0;
    mesh(cyl(0.05, 0.08, 0.2, 6), lam('#1e2633'), 0, 0.1, 0, g);
    mesh(box(w, w * 0.64, 0.04), lam('#10151f'), 0, 0.42, 0, g, true);
    var sc = new S.THREE.Mesh(geo('pl' + w, function () { return new S.THREE.PlaneGeometry(w * 0.92, w * 0.64 * 0.88); }),
      on ? S.screens[texIdx % S.screens.length].mat : lam('#0d121b'));
    sc.position.set(0, 0.42, 0.023); g.add(sc);
  }
  function makeDesk(parent, x, z, isHero, tool, person, idx) {
    var g = grp(x, 0, z, parent);
    mesh(box(1.8, 0.07, 0.9), lam('#d9c3a1'), 0, 0.75, 0, g, true, true);
    mesh(box(0.06, 0.72, 0.8), lam('#8a7355'), -0.84, 0.36, 0, g, true);
    mesh(box(0.06, 0.72, 0.8), lam('#8a7355'), 0.84, 0.36, 0, g, true);
    if (isHero && tool === 0) {
      mesh(box(0.55, 0.03, 0.38), lam('#9aa8b8'), 0, 0.82, -0.1, g, true);
      var lid = grp(0, 0.835, -0.28, g); lid.rotation.x = -0.25;
      mesh(box(0.55, 0.36, 0.025), lam('#10151f'), 0, 0.18, 0, lid, true);
      var s0 = new S.THREE.Mesh(geo('lp', function () { return new S.THREE.PlaneGeometry(0.5, 0.31); }), S.screens[0].mat); s0.position.set(0, 0.18, 0.015); lid.add(s0);
    } else if (isHero && tool >= 2) {
      makeMonitor(g, -0.42, -0.2, 0.66, 0.28, true, 0);
      makeMonitor(g, 0.42, -0.2, 0.66, -0.28, true, 1);
    } else {
      makeMonitor(g, 0, -0.18, isHero ? 0.82 : 0.74, 0, !!person, idx);
    }
    if (person || isHero) mesh(box(0.5, 0.02, 0.16), lam('#2b3445'), 0.1, 0.79, 0.2, g);
    mesh(cyl(0.05, 0.05, 0.1, 8), lam(['#ec4899', '#22d3ee', '#fbbf24'][idx % 3]), 0.7, 0.84, 0.1, g);
    var lamp = grp(-0.72, 0.785, -0.12, g);
    mesh(cyl(0.05, 0.06, 0.03, 8), lam('#1e2633'), 0, 0.015, 0, lamp);
    mesh(cyl(0.012, 0.012, 0.32, 5), lam('#1e2633'), 0, 0.18, 0, lamp);
    mesh(sph(0.06, 8, 6), bas('#ffd27a'), 0, 0.36, 0, lamp);
    return g;
  }
  function makeCat(parent, x, z) {
    var g = grp(x, 0, z, parent), O = lam('#e8873a'), W = lam('#fff4e6');
    mesh(cyl(0.5, 0.5, 0.08, 18), lam('#ec4899'), 0, 0.04, 0, g, false, true);
    var b = mesh(sph(0.26, 12, 10), O, 0, 0.32, 0, g, true); b.scale.set(1, 0.9, 1.25);
    var head = grp(0, 0.62, 0.2, g);
    mesh(sph(0.19, 12, 10), O, 0, 0, 0, head, true);
    mesh(sph(0.08, 8, 6), W, 0, -0.06, 0.15, head);
    [-1, 1].forEach(function (s) {
      var ear = mesh(geo('ear', function () { return new S.THREE.ConeGeometry(0.07, 0.15, 4); }), O, s * 0.12, 0.2, 0, head, true); ear.rotation.z = -s * 0.25;
      mesh(sph(0.025, 6, 5), bas('#1a1a1a'), s * 0.075, 0.03, 0.17, head);
      var gl = mesh(geo('gl', function () { return new S.THREE.TorusGeometry(0.058, 0.012, 6, 14); }), lam('#334155'), s * 0.075, 0.03, 0.185, head);
    });
    mesh(box(0.1, 0.012, 0.012), lam('#334155'), 0, 0.03, 0.185, head);
    var tail = grp(0, 0.2, -0.3, g);
    var t1 = mesh(cyl(0.04, 0.05, 0.4, 6), O, 0, 0.18, -0.05, tail); t1.rotation.x = -0.5;
    g.userData.pick = { type: 'cat', bump: 0 };
    g.userData.anim = { head: head, tail: tail };
    S.cat = g; S.pick.push(g);
    return g;
  }
  function makePlant(parent, x, z) {
    var g = grp(x, 0, z, parent);
    mesh(cyl(0.26, 0.19, 0.42, 10), lam('#c46a35'), 0, 0.21, 0, g, true);
    var top = grp(0, 0.42, 0, g);
    [[0, 0.3, 0, 0.28], [-0.2, 0.15, 0.05, 0.2], [0.2, 0.2, -0.05, 0.22], [0.05, 0.55, 0.05, 0.2], [-0.1, 0.4, -0.15, 0.18]].forEach(function (l) {
      var m = mesh(geo('ico' + l[3], function () { return new S.THREE.IcosahedronGeometry(l[3], 0); }), lam(l[3] > 0.21 ? '#2e9e5b' : '#3fbf74'), l[0], l[1], l[2], top, true); m.scale.y = 0.85;
    });
    S.sway.push(top);
  }
  function makeShelf(parent, x, z) {
    var g = grp(x, 0, z, parent);
    mesh(box(0.05, 2.0, 1.6), lam('#8a6a48'), -0.17, 1.0, 0, g, true, true);
    mesh(box(0.4, 2.0, 0.05), lam('#8a6a48'), 0, 1.0, -0.775, g, true);
    mesh(box(0.4, 2.0, 0.05), lam('#8a6a48'), 0, 1.0, 0.775, g, true);
    var r = rnd(11), cols = ['#ef5350', '#42a5f5', '#ab47bc', '#66bb6a', '#ffa726', '#ec4899', '#22d3ee'];
    [0.02, 0.62, 1.22, 1.82].forEach(function (y, k) {
      mesh(box(0.4, 0.04, 1.6), lam('#8a6a48'), 0, y + 0.02, 0, g, false, true);
      if (k === 3) return;
      var zz = -0.68;
      while (zz < 0.66) {
        var bw = 0.07 + r() * 0.05, bh = 0.3 + r() * 0.2;
        mesh(box(0.22, bh, bw), lam(cols[Math.floor(r() * cols.length)]), 0.02, y + 0.04 + bh / 2, zz + bw / 2, g);
        zz += bw + 0.012;
      }
    });
  }
  function makeRack(parent, x, z) {
    var g = grp(x, 0, z, parent);
    mesh(box(0.7, 1.7, 0.7), lam('#1b222c'), 0, 0.85, 0, g, true);
    for (var i = 0; i < 7; i++) {
      mesh(box(0.6, 0.12, 0.02), lam('#2b3445'), 0, 0.2 + i * 0.22, 0.36, g);
      var m = new S.THREE.MeshBasicMaterial({ color: i % 2 ? '#22c55e' : '#22d3ee' });
      mesh(box(0.05, 0.05, 0.02), m, 0.22, 0.2 + i * 0.22, 0.375, g);
      S.leds.push(m);
    }
  }
  function makeHolo(parent, x, y, z) {
    var g = grp(x, y, z, parent);
    var m = new S.THREE.MeshBasicMaterial({ color: '#22d3ee', wireframe: true });
    mesh(geo('holoS', function () { return new S.THREE.IcosahedronGeometry(0.22, 1); }), m, 0, 0, 0, g);
    var ring = mesh(geo('holoR', function () { return new S.THREE.TorusGeometry(0.38, 0.012, 6, 28); }), bas('#a78bfa'), 0, 0, 0, g); ring.rotation.x = 1.2;
    S.holo = g;
  }

  /* ---------- Construction de la pièce ---------- */
  function roomData() {
    var g = G_(), lvl = Math.max(0, Math.min(4, (g.office | 0))), seats = OFFICES[lvl].max + 1;
    var people = [{ seed: 'hero-darkman', name: 'Toi', role: 'Fondateur' }].concat((g.team || []).map(function (e) { return { seed: e.seed, name: e.name, role: e.role || '' }; }));
    return { lvl: lvl, seats: seats, people: people.slice(0, seats), tool: Math.max(0, Math.min(4, (g.tool | 0))), total: people.length };
  }
  function sigOf(d) { return d.lvl + '|' + d.tool + '|' + d.people.map(function (p) { return p.seed + ':' + p.name; }).join(','); }

  function buildRoom(d) {
    var T = S.THREE;
    if (S.room) S.scene.remove(S.room);
    S.persons = []; S.pick = []; S.cat = null; S.sway = []; S.leds = []; S.holo = null; S.winNight = [];
    var room = new T.Group(); S.room = room;
    var rows = d.seats <= 2 ? 1 : 2, cols = Math.ceil(d.seats / rows);
    var W = cols * 2.3 + 1.8, D = rows * 3.0 + 1.8, H = 3.0; S.dim = { W: W, D: D, H: H };
    var wallC = ['#bfe6ea', '#cfeee4', '#d8ecfa', '#fde8f1', '#e9e2fa'][d.lvl];

    /* sol, murs */
    var ft = floorTex(d.lvl); ft.repeat.set(W / 2.2, D / 2.2);
    var side = lam('#6b4f36');
    var floor = new T.Mesh(box(W, 0.3, D), [side, side, new T.MeshLambertMaterial({ map: ft }), side, side, side]);
    floor.position.y = -0.15; floor.receiveShadow = true; room.add(floor);
    mesh(box(W + 0.2, H, 0.2), lam(wallC), 0, H / 2, -D / 2 - 0.1, room, false, true);
    mesh(box(0.2, H, D), lam(wallC), -W / 2 - 0.1, H / 2, 0, room, false, true);
    mesh(box(W, 0.14, 0.05), lam('#ffffff'), 0, 0.07, -D / 2 + 0.025, room);
    mesh(box(0.05, 0.14, D), lam('#ffffff'), -W / 2 + 0.025, 0.07, 0, room);

    /* fenêtres (jour + nuit en fondu) */
    var startX = -(cols - 1) * 2.3 / 2 + 0.3;
    for (var c = 0; c < cols; c++) {
      var wx = startX + c * 2.3;
      mesh(box(1.7, 1.2, 0.06), lam('#ffffff'), wx, 2.0, -D / 2 + 0.03, room);
      var dayM = new T.MeshBasicMaterial({ map: skyTex(false) }), nightM = new T.MeshBasicMaterial({ map: skyTex(true), transparent: true, opacity: S.night });
      var pd = new T.Mesh(box(1.5, 1.0, 0.01), dayM); pd.position.set(wx, 2.0, -D / 2 + 0.07); room.add(pd);
      var pn = new T.Mesh(box(1.5, 1.0, 0.01), nightM); pn.position.set(wx, 2.0, -D / 2 + 0.078); room.add(pn);
      S.winNight.push(nightM);
    }
    var sg = new T.Mesh(new T.PlaneGeometry(1.9, 0.54), new T.MeshBasicMaterial({ map: signTex() }));
    sg.position.set(-W / 2 + 0.03, 2.3, 0); sg.rotation.y = Math.PI / 2; room.add(sg);

    /* tapis, plante, étagère, chat, lit */
    var rug = mesh(cyl(1.7, 1.7, 0.02, 28), lam('#6366f1'), 0.3, 0.012, D / 2 - 1.0, room, false, true);
    mesh(cyl(1.35, 1.35, 0.022, 28), lam('#818cf8'), 0.3, 0.013, D / 2 - 1.0, room, false, true);
    makePlant(room, W / 2 - 0.6, -D / 2 + 0.6);
    makeShelf(room, -W / 2 + 0.22, D / 2 - 1.1);
    makeCat(room, -W / 2 + 1.5, D / 2 - 0.9);
    if (d.lvl >= 2) makePlant(room, -W / 2 + 0.6, -D / 2 + 0.6);
    if (d.lvl === 0) {
      var bed = grp(W / 2 - 1.0, 0, D / 2 - 1.5, room);
      mesh(box(1.0, 0.3, 1.9), lam('#6b4f36'), 0, 0.15, 0, bed, true, true);
      mesh(box(0.92, 0.16, 1.8), lam('#e2e8f0'), 0, 0.38, 0, bed, true);
      mesh(box(0.6, 0.12, 0.35), lam('#93c5fd'), 0, 0.5, -0.7, bed);
    }
    if (d.tool >= 3) makeRack(room, -W / 2 + 0.55, -D / 2 + 0.6);

    /* postes de travail */
    var heroPos = null;
    for (var i = 0; i < d.seats; i++) {
      var r = Math.floor(i / cols), cc = i % cols;
      var x = startX + cc * 2.3, z = -D / 2 + 1.2 + r * 3.0;
      var p = d.people[i];
      makeDesk(room, x, z, i === 0, d.tool, !!p, i);
      makeChair(room, x + 0.4, z + 0.85);
      if (p) makePerson(p, i === 0, room, x + 0.4, z + 0.85);
      if (i === 0) heroPos = { x: x, z: z };
    }
    S.heroPos = heroPos || { x: 0, z: 0 };
    if (d.tool >= 4 && heroPos) makeHolo(room, heroPos.x, 2.0, heroPos.z + 0.1);

    S.scene.add(room);

    /* lumière : l'ombre couvre toute la pièce */
    var R = Math.max(W, D) * 0.78;
    S.dir.position.set(-W * 0.45, 10, D * 0.35);
    var sc = S.dir.shadow.camera; sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = 30; sc.updateProjectionMatrix();
    S.pt.position.set(0, 2.7, 0);
    applyLighting(S.night, true);
    S.w = 0; /* force le recadrage de la caméra */
  }

  /* ---------- Lumière jour / nuit ---------- */
  var _c1, _c2;
  function lerpC(target, a, b, n) { _c1 = _c1 || new S.THREE.Color(); _c2 = _c2 || new S.THREE.Color(); _c1.set(a); _c2.set(b); target.lerpColors(_c1, _c2, n); }
  function applyLighting(n, force) {
    S.hemi.intensity = 0.78 - 0.34 * n; lerpC(S.hemi.color, '#ffffff', '#7686d8', n); lerpC(S.hemi.groundColor, '#cbb89a', '#1d2144', n);
    S.dir.intensity = 0.85 - 0.62 * n; lerpC(S.dir.color, '#fff1d6', '#8197ff', n);
    S.pt.intensity = 1.05 * n;
    S.winNight.forEach(function (m) { m.opacity = n; });
    var k = 0.88 + 0.3 * n; S.screens.forEach(function (s) { s.mat.color.setScalar(k); });
    var nt = n > 0.5, host = document.querySelector('.wst3d');
    if (host) host.classList.toggle('night', nt);
  }

  /* ---------- Caméra ---------- */
  function fitCamera() {
    var cv = S.renderer.domElement, w = cv.clientWidth || 360, h = cv.clientHeight || 240;
    if (w === S.w && h === S.h) return; S.w = w; S.h = h;
    S.renderer.setSize(w, h, false);
    var cam = S.camera, aspect = w / h; cam.aspect = aspect; cam.fov = 32;
    var vf = cam.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
    var Rr = 0.5 * Math.sqrt(S.dim.W * S.dim.W + S.dim.D * S.dim.D + S.dim.H * S.dim.H) * 0.86;
    S.dist = Rr / Math.sin(Math.min(vf, hf) / 2);
    cam.near = 1; cam.far = S.dist * 3; cam.updateProjectionMatrix();
  }
  function placeCamera(az) {
    var d = S.dist || 20, el = S.el, cam = S.camera, ty = S.dim.H * 0.26;
    cam.position.set(Math.sin(az) * Math.cos(el) * d, ty + Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
    cam.lookAt(0, ty, 0);
  }

  /* ---------- Boucle d'animation ---------- */
  function spawnCoins() {
    var n = 0, hp = S.heroPos || { x: 0, z: 0 };
    for (var i = 0; i < S.coins.length && n < 6; i++) {
      var c = S.coins[i]; if (c.life > 0) continue;
      c.life = 1.1 + Math.random() * 0.5; c.age = 0;
      c.mesh.position.set(hp.x + (Math.random() - 0.5) * 0.8, 1.6, hp.z + 0.3 + (Math.random() - 0.5) * 0.4);
      c.mesh.visible = true; n++;
    }
  }
  function frame(now) {
    S.raf = 0;
    if (!S.active || !S.visible || document.hidden) return;
    var dt = Math.min(0.05, (now - S.last) / 1000); S.last = now; S.t += dt; var t = S.t;
    /* gouverneur de performance : si trop lent, on baisse la qualité */
    if (S.quality && dt > 0.034) { S.slow++; if (S.slow > 90) { S.quality = 0; safe(function () { S.renderer.setPixelRatio(1); S.w = 0; S.dir.castShadow = false; }); } } else if (S.slow > 0) S.slow--;
    fitCamera();
    /* nuit */
    if (Math.abs(S.night - S.nightT) > 0.002) { S.night += Math.sign(S.nightT - S.night) * Math.min(Math.abs(S.nightT - S.night), dt / 1.4); applyLighting(S.night); }
    /* caméra : orbite douce + léger balancement */
    S.az += (S.azT - S.az) * (1 - Math.exp(-7 * dt));
    placeCamera(S.az + (S.interacted ? 0 : Math.sin(t * 0.35) * 0.05));
    /* personnages */
    for (var i = 0; i < S.persons.length; i++) {
      var g = S.persons[i], a = g.userData.anim, pk = g.userData.pick, k = t * 7 + a.ph;
      a.arms[0].rotation.x = -0.75 + Math.sin(k) * 0.07; a.arms[1].rotation.x = -0.75 + Math.sin(k + 2.1) * 0.07;
      a.head.rotation.y = Math.sin(t * 0.5 + a.ph) * 0.3; a.head.rotation.x = Math.sin(t * 0.9 + a.ph) * 0.04;
      var bump = 0; if (pk.bump > 0) { pk.bump = Math.max(0, pk.bump - dt * 2.4); bump = Math.sin(pk.bump * Math.PI) * 0.22; }
      g.position.y = Math.sin(t * 1.6 + a.ph) * 0.008 + bump;
    }
    /* chat : queue, tête vers la caméra */
    if (S.cat) {
      var cu = S.cat.userData.anim, cp = S.cat.userData.pick;
      cu.tail.rotation.y = Math.sin(t * 2.2) * 0.45; cu.head.rotation.z = Math.sin(t * 0.7) * 0.06;
      var want = Math.atan2(S.camera.position.x - S.cat.position.x, S.camera.position.z - S.cat.position.z);
      var diff = Math.atan2(Math.sin(want - S.cat.rotation.y), Math.cos(want - S.cat.rotation.y)); S.cat.rotation.y += diff * (1 - Math.exp(-2.5 * dt));
      var cb = 0; if (cp.bump > 0) { cp.bump = Math.max(0, cp.bump - dt * 2.4); cb = Math.sin(cp.bump * Math.PI) * 0.28; }
      S.cat.position.y = cb;
    }
    for (var j = 0; j < S.sway.length; j++) S.sway[j].rotation.z = Math.sin(t * 1.2 + j) * 0.04;
    if (S.holo) { S.holo.rotation.y = t * 0.9; S.holo.position.y = 2.0 + Math.sin(t * 1.5) * 0.06; }
    S.ledT -= dt; if (S.ledT <= 0) { S.ledT = 0.25; for (var q = 0; q < S.leds.length; q++) S.leds[q].color.set(Math.random() > 0.35 ? (q % 2 ? '#22c55e' : '#22d3ee') : '#0b2a1a'); }
    for (var s = 0; s < S.screens.length; s++) S.screens[s].tex.offset.y = (t * (0.04 + s * 0.015)) % 1;
    /* pièces */
    for (var c = 0; c < S.coins.length; c++) {
      var co = S.coins[c]; if (co.life <= 0) continue;
      co.age += dt; var u = co.age / co.life;
      if (u >= 1) { co.life = 0; co.mesh.visible = false; continue; }
      co.mesh.position.y += dt * (0.9 - u * 0.5); co.mesh.rotation.y += dt * 8; co.mat.opacity = u > 0.7 ? (1 - u) / 0.3 : 1;
    }
    S.renderer.render(S.scene, S.camera);
    S.raf = requestAnimationFrame(frame);
  }
  function start() { if (!S.raf && S.active && S.visible && !document.hidden) { S.last = performance.now(); S.raf = requestAnimationFrame(frame); } }
  function stop() { if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; } }

  /* ---------- Interaction : glisser pour tourner, toucher un perso ---------- */
  function onTap(e) {
    var cv = S.renderer.domElement, r = cv.getBoundingClientRect(), T = S.THREE;
    var v = new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    var ray = new T.Raycaster(); ray.setFromCamera(v, S.camera);
    var hits = ray.intersectObjects(S.pick, true);
    if (!hits || !hits.length) return;
    var o = hits[0].object, pk = null;
    while (o && !pk) { if (o.userData && o.userData.pick) pk = o.userData.pick; else o = o.parent; }
    if (!pk) return; pk.bump = 1;
    var msg;
    if (pk.type === 'cat') msg = ['😺 Miaou !', '🐾 Pixel ronronne…', '😸 Pixel te regarde par-dessus ses lunettes'][Math.floor(Math.random() * 3)];
    else if (pk.type === 'hero') msg = '👋 C\u2019est toi, patron !';
    else msg = '👤 ' + pk.name + (pk.role ? ' — ' + pk.role : '');
    safe(function () { if (typeof toast === 'function') toast(msg); });
  }
  function bindInput(cv) {
    var drag = null;
    cv.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, az: S.azT, moved: false, id: e.pointerId, t: performance.now() }; S.interacted = true; });
    cv.addEventListener('pointermove', function (e) {
      if (!drag) return; var dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) > 5) { drag.moved = true; try { cv.setPointerCapture(drag.id); } catch (_) {} }
      if (drag.moved) { S.azT = Math.max(0.12, Math.min(1.25, drag.az - dx * 0.006)); start(); }
    });
    cv.addEventListener('pointerup', function (e) { if (drag && !drag.moved && performance.now() - drag.t < 450) safe(function () { onTap(e); }); drag = null; });
    cv.addEventListener('pointercancel', function () { drag = null; });
    cv.addEventListener('webglcontextlost', function (e) { e.preventDefault(); safe(function () { deactivate(true); }); }, false);
  }

  /* ---------- Montage dans la page ---------- */
  var MOUNT = '<div class="wst3d" id="wst3dMount"><div class="wst3dHud"><div><b></b><span></span></div><div><b></b><span></span></div></div></div>';
  function ensureMounted() {
    var host = document.getElementById('officeScene'); if (!host || !S.renderer) return false;
    var w = host.querySelector('#wst3dMount');
    if (!w) { host.innerHTML = MOUNT; w = host.querySelector('#wst3dMount'); S.hudKey = ''; }
    if (!w) return false;
    var cv = S.renderer.domElement;
    if (cv.parentNode !== w) {
      w.insertBefore(cv, w.firstChild);
      if (!S.hintShown) { S.hintShown = true; var h = document.createElement('div'); h.className = 'wst3dHint'; h.textContent = '↔ Glisse pour tourner • touche un perso'; w.appendChild(h); }
      w.classList.toggle('night', S.night > 0.5); S.w = 0;
    }
    var hud = w.querySelector('.wst3dHud'); S.hud = hud ? hud.querySelectorAll('div') : null;
    return true;
  }
  function updateHud(d) {
    if (!S.hud || S.hud.length < 2) return;
    var g = G_(), sub = ((g.sites && g.sites.length) || (g.apps && g.apps.length)) ? ('Sites : ' + g.sites.length + ' • Apps : ' + (g.apps ? g.apps.length : 0)) : (g.active ? ('Projet : ' + g.active.t) : 'Lance ton premier site !');
    var lv = (typeof level === 'function') ? level() : 1;
    var key = [OFFICES[d.lvl].name, g.day, sub, lv, d.total].join('|'); if (key === S.hudKey) return; S.hudKey = key;
    S.hud[0].children[0].textContent = OFFICES[d.lvl].name; S.hud[0].children[1].textContent = 'Jour ' + g.day + ' • ' + sub;
    S.hud[1].children[0].textContent = 'Niveau ' + lv; S.hud[1].children[1].textContent = d.total + ' personne(s)';
  }

  function update3D() {
    if (!S.active) return;
    safe(function () {
      var g = G_(); if (!g || typeof OFFICES === 'undefined') return;
      if (!ensureMounted()) return;
      var d = roomData(), sg = sigOf(d);
      if (sg !== S.sig) { S.sig = sg; buildRoom(d); }
      S.nightT = isNight() ? 1 : 0;
      if (S.lastMoney === null) S.lastMoney = g.money;
      else { if (g.money > S.lastMoney) spawnCoins(); S.lastMoney = g.money; }
      updateHud(d); start();
    });
  }

  /* ---------- Démarrage / arrêt ---------- */
  function initGL() {
    var T = S.THREE;
    try {
      var r = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
      r.setClearColor(0x000000, 0); r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
      S.renderer = r;
    } catch (e) { return false; }
    S.scene = new T.Scene();
    S.camera = new T.PerspectiveCamera(32, 1.5, 1, 100);
    S.hemi = new T.HemisphereLight('#ffffff', '#cbb89a', 0.78); S.scene.add(S.hemi);
    S.dir = new T.DirectionalLight('#fff1d6', 0.85); S.dir.castShadow = true; S.dir.shadow.mapSize.set(1024, 1024); S.dir.shadow.bias = -0.0008; S.scene.add(S.dir);
    S.pt = new T.PointLight('#ffc680', 0, 22, 1); S.scene.add(S.pt);
    var tA = screenTex(), tB = screenTex();
    S.screens = [{ tex: tA, mat: new T.MeshBasicMaterial({ map: tA }) }, { tex: tB, mat: new T.MeshBasicMaterial({ map: tB }) }];
    tA.repeat.set(1, 0.5); tB.repeat.set(1, 0.5);
    for (var i = 0; i < 10; i++) {
      var cm = new T.MeshBasicMaterial({ color: '#fbbf24', transparent: true });
      var co = new T.Mesh(cyl(0.1, 0.1, 0.03, 12), cm); co.rotation.x = Math.PI / 2; co.visible = false; S.scene.add(co);
      /* la pièce tourne sur son axe vertical : on l'enveloppe */
      S.coins.push({ mesh: co, mat: cm, life: 0, age: 0 });
    }
    bindInput(S.renderer.domElement);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) { S.visible = !!(en[0] && en[0].isIntersecting); if (S.visible) start(); else stop(); }, { threshold: 0.05 }).observe(S.renderer.domElement);
    } else S.visible = true;
    document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
    S.gl = true; return true;
  }
  function activate() {
    if (!S.gl && !initGL()) return false;
    S.active = true; S.sig = ''; S.lastMoney = null;
    S.nightT = isNight() ? 1 : 0; S.night = S.nightT;
    update3D(); setBtn(); return true;
  }
  function deactivate(lost) {
    S.active = false; stop();
    if (lost) { S.gl = false; S.renderer = null; S.coins = []; }
    safe(function () { var host = document.getElementById('officeScene'); if (host && typeof officeSVG === 'function') host.innerHTML = officeSVG(); });
    setBtn();
  }

  /* officeSVG : renvoie le point de montage 3D tant que la 3D est active */
  safe(function () {
    var orig = window.officeSVG;
    if (typeof orig !== 'function' || orig.__wst3d) return;
    var w = function () { return S.active ? MOUNT : orig.apply(this, arguments); };
    w.__wst3d = true; window.officeSVG = w;
  });
  safe(function () {
    var orig = window.render;
    if (typeof orig !== 'function' || orig.__wst3d) return;
    var w = function () { var r = orig.apply(this, arguments); update3D(); return r; };
    w.__wst3d = true; window.render = w;
  });

  /* ---------- Bouton dans le menu ---------- */
  function setBtn() {
    var b = document.getElementById('wst3dBtn'); if (!b) return;
    b.textContent = S.active ? '🎬 Bureau 3D : on' : (S.tried && !S.gl && prefOn() ? '🎬 Bureau 3D : indisponible' : '🎬 Bureau 3D : off');
  }
  function addBtn() {
    safe(function () {
      if (document.getElementById('wst3dBtn')) return;
      var nav = document.getElementById('mainNav'), ref = document.getElementById('musicBtn'); if (!nav) return;
      var b = document.createElement('button'); b.id = 'wst3dBtn'; b.className = 'ghost'; b.style.cssText = 'width:100%;min-height:44px;margin-top:8px';
      b.onclick = function () {
        if (S.active) { setPref(false); deactivate(false); }
        else { setPref(true); boot(true); }
      };
      if (ref && ref.parentNode === nav) nav.insertBefore(b, ref.nextSibling); else nav.appendChild(b);
      setBtn();
    });
  }
  function boot(force) {
    addBtn();
    if (!force && !prefOn()) { setBtn(); return; }
    loadThree(function (ok) {
      S.tried = true;
      if (!ok || !activate()) { setBtn(); safe(function () { if (force && typeof toast === 'function') toast('🎬 3D indisponible (hors ligne ?) — le bureau classique reste affiché.'); }); }
    });
  }
  boot(false);
  window.wst3d = { state: S, boot: boot };
})();
