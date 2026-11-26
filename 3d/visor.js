// Visor 3D de MatteHaven: la montaña real de la carrera con su recorrido encima, para girarla con el dedo o el ratón.
// Lo copia scripts/visor-3d.mjs a dist/web/3d/visor.js; los datos de cada carrera van dentro de su página
// (<script id="datos-visor">) y en dist/web/3d/datos/<slug>/. three.js 0.180.0 (MIT) en vendor/.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, BufferGeometry, BufferAttribute, MeshBasicMaterial, ShaderMaterial,
  Texture, CanvasTexture, SRGBColorSpace, Vector3, Spherical, AdditiveBlending,
  GreaterDepth, PlaneGeometry, OrbitControls,
} from './vendor/three-r180.min.js'

const D = JSON.parse(document.getElementById('datos-visor').textContent)
const html = document.documentElement
const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches
const tactil = matchMedia('(pointer: coarse)').matches
const lienzo = document.getElementById('lienzo')
const capa = document.getElementById('etiquetas')
const pista = document.getElementById('pista')
const VISOR = (window.__visor = { fps: [], listo: false, entrada: 0, errores: [] })

function sin3d(motivo) {
  VISOR.errores.push(String(motivo))
  html.classList.add('sin-3d')
  const img = document.querySelector('.estatica img')
  if (img) img.loading = 'eager'
}

let gl2 = false
try { gl2 = !!document.createElement('canvas').getContext('webgl2') } catch { gl2 = false }
if (!gl2) sin3d('sin WebGL 2')
else arrancar().catch((e) => { console.error(e); sin3d(e?.message || e) })

// ── Datos ────────────────────────────────────────────────────────────────────────────────────────
async function leerAlturas({ url, nx, ny }) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`alturas: HTTP ${r.status}`)
  const blob = await r.blob()
  let fuente
  try { fuente = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }) } catch {
    fuente = new Image(); fuente.src = URL.createObjectURL(blob); await fuente.decode()
  }
  const c = document.createElement('canvas')
  c.width = nx; c.height = ny
  const x = c.getContext('2d', { willReadFrequently: true })
  x.drawImage(fuente, 0, 0)
  const px = x.getImageData(0, 0, nx, ny).data
  const H = new Float32Array(nx * ny)
  for (let k = 0; k < H.length; k++) H[k] = (px[k * 4] * 256 + px[k * 4 + 1]) * D.pasoM
  return { H, nx, ny }
}

async function leerImagen(url) {
  const img = new Image()
  img.decoding = 'async'
  img.src = url
  await img.decode()
  return img
}

// ── Escena ───────────────────────────────────────────────────────────────────────────────────────
async function arrancar() {
  // En el móvil, la rejilla de 256 (la textura lleva el detalle); en el ordenador, la de 512.
  const pAlturas = leerAlturas(tactil ? D.alturasMovil : D.alturas)
  const pPrevia = leerImagen(D.previa)
  const { H, nx, ny } = await pAlturas
  const A = D.ancho, F = D.fondo, EX = D.exag
  const X = (u) => (u - 0.5) * A, Z = (v) => (v - 0.5) * F, Yk = (m) => (m / 1000) * EX
  let hMax = 0
  for (const v of H) if (v > hMax) hMax = v
  const alto = Yk(hMax)
  const base = Math.max(A, F) * 0.045 + alto * 0.08
  // Altura (m sobre la cota mínima) en (u, v), bilineal.
  const hEn = (u, v) => {
    const x = Math.min(nx - 1.0001, Math.max(0, u * (nx - 1))), y = Math.min(ny - 1.0001, Math.max(0, v * (ny - 1)))
    const x0 = Math.floor(x), y0 = Math.floor(y), dx = x - x0, dy = y - y0, k = y0 * nx + x0
    return (H[k] * (1 - dx) + H[k + 1] * dx) * (1 - dy) + (H[k + nx] * (1 - dx) + H[k + nx + 1] * dx) * dy
  }
  const yEn = (x, z) => Yk(hEn(x / A + 0.5, z / F + 0.5))

  const renderer = new WebGLRenderer({ canvas: lienzo, antialias: true, alpha: true, powerPreference: 'high-performance' })
  renderer.outputColorSpace = SRGBColorSpace
  renderer.setClearColor(0x000000, 0)
  let ratio = Math.min(devicePixelRatio || 1, 2)
  renderer.setPixelRatio(ratio)
  const escena = new Scene()
  const camara = new PerspectiveCamera(32, 1, 0.01, 400)
  const grupo = new Group()
  escena.add(grupo)

  // Terreno: rejilla desplazada.
  const paso = 1
  const cols = [], filas = []
  for (let i = 0; i < nx - 1; i += paso) cols.push(i)
  cols.push(nx - 1)
  for (let j = 0; j < ny - 1; j += paso) filas.push(j)
  filas.push(ny - 1)
  const NC = cols.length, NF = filas.length
  const pos = new Float32Array(NC * NF * 3), uv = new Float32Array(NC * NF * 2)
  for (let b = 0; b < NF; b++) for (let a = 0; a < NC; a++) {
    const i = cols[a], j = filas[b], k = b * NC + a, u = i / (nx - 1), v = j / (ny - 1)
    pos[k * 3] = X(u); pos[k * 3 + 1] = Yk(H[j * nx + i]); pos[k * 3 + 2] = Z(v)
    uv[k * 2] = u; uv[k * 2 + 1] = 1 - v
  }
  const idx = new Uint32Array((NC - 1) * (NF - 1) * 6)
  let q = 0
  for (let b = 0; b < NF - 1; b++) for (let a = 0; a < NC - 1; a++) {
    const k = b * NC + a
    idx[q++] = k; idx[q++] = k + NC; idx[q++] = k + 1
    idx[q++] = k + 1; idx[q++] = k + NC; idx[q++] = k + NC + 1
  }
  const geoT = new BufferGeometry()
  geoT.setAttribute('position', new BufferAttribute(pos, 3))
  geoT.setAttribute('uv', new BufferAttribute(uv, 2))
  geoT.setIndex(new BufferAttribute(idx, 1))
  geoT.computeBoundingSphere()
  const tex = new Texture(await pPrevia)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  tex.needsUpdate = true
  const matT = new MeshBasicMaterial({ map: tex })
  const terreno = new Mesh(geoT, matT)
  grupo.add(terreno)

  // Paredes del bloque, como un relieve cortado: degradado oscuro y una raya fina cada 100 m de altitud real.
  {
    const bordes = [
      cols.map((i) => [i, 0]), filas.map((j) => [nx - 1, j]), cols.slice().reverse().map((i) => [i, ny - 1]), filas.slice().reverse().map((j) => [0, j]),
    ]
    const p = [], nrm = [], id = []
    for (const borde of bordes) {
      const [i0, j0] = borde[0], [i1, j1] = borde[borde.length - 1]
      const tx = i1 - i0, tz = j1 - j0, L = Math.hypot(tx, tz)
      const n = [tz / L, 0, -tx / L]
      const o = p.length / 3
      for (const [i, j] of borde) {
        const x = X(i / (nx - 1)), z = Z(j / (ny - 1))
        p.push(x, Yk(H[j * nx + i]), z, x, -base, z)
        nrm.push(...n, ...n)
      }
      for (let k = 0; k < borde.length - 1; k++) { const a = o + k * 2; id.push(a, a + 1, a + 2, a + 2, a + 1, a + 3) }
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(p), 3))
    g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3))
    g.setIndex(id)
    const m = new ShaderMaterial({
      uniforms: { uEsc: { value: EX / 1000 }, uZmin: { value: D.zmin }, uBase: { value: base }, uTop: { value: alto } },
      vertexShader: `varying float vY; varying vec3 vN;
        void main(){ vY = position.y; vN = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uEsc, uZmin, uBase, uTop; varying float vY; varying vec3 vN;
        void main(){
          float t = clamp((vY + uBase) / (uTop + uBase), 0.0, 1.0);
          vec3 c = mix(vec3(0.045, 0.05, 0.056), vec3(0.23, 0.205, 0.18), pow(t, 1.6));
          float luz = 0.72 + 0.28 * dot(normalize(vN), normalize(vec3(-0.6, 0.0, -0.8)));
          c *= luz;
          float m = (vY / uEsc + uZmin) / 100.0;
          float d = abs(fract(m + 0.5) - 0.5);
          float raya = (1.0 - smoothstep(0.0, fwidth(m) * 1.2, d)) * step(0.0, vY);
          c += raya * vec3(0.11, 0.1, 0.09);
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
    grupo.add(new Mesh(g, m))
  }

  // Sombra suave bajo el bloque.
  {
    const c = document.createElement('canvas'); c.width = c.height = 128
    const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 8, 64, 64, 64)
    gr.addColorStop(0, 'rgba(0,0,0,0.62)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)')
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128)
    const s = new Mesh(new PlaneGeometry(A * 1.9, F * 1.9), new MeshBasicMaterial({ map: new CanvasTexture(c), transparent: true, depthWrite: false }))
    s.rotation.x = -Math.PI / 2
    s.position.y = -base - 0.002
    s.renderOrder = -1
    escena.add(s)
  }

  // ── Recorrido: tubo de grosor constante en pantalla, con halo aditivo y un pulso que lo recorre ────
  const celda = Math.min(A / (nx - 1), F / (ny - 1))
  const recorrido = []
  {
    const r = D.ruta.map(([u, v]) => [X(u), Z(v)])
    for (let k = 0; k < r.length; k++) {
      if (k === 0) { recorrido.push(r[0]); continue }
      const [ax, az] = r[k - 1], [bx, bz] = r[k], d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / (celda * 0.5)))
      for (let t = 1; t <= n; t++) recorrido.push([ax + ((bx - ax) * t) / n, az + ((bz - az) * t) / n])
    }
  }
  const NP = recorrido.length
  const centro = new Float32Array(NP * 3), largo = new Float32Array(NP)
  for (let k = 0; k < NP; k++) {
    const [x, z] = recorrido[k]
    centro[k * 3] = x; centro[k * 3 + 1] = yEn(x, z); centro[k * 3 + 2] = z
    if (k) largo[k] = largo[k - 1] + Math.hypot(x - recorrido[k - 1][0], centro[k * 3 + 1] - centro[k * 3 - 2], z - recorrido[k - 1][1])
  }
  // Suavizado de la altura del tubo (que no copie cada escalón de la rejilla) y nunca por debajo del suelo.
  {
    const y0 = Float32Array.from({ length: NP }, (_, k) => centro[k * 3 + 1])
    for (let k = 0; k < NP; k++) {
      let s = 0, c = 0
      for (let d = -2; d <= 2; d++) { const i = Math.min(NP - 1, Math.max(0, k + d)); s += y0[i]; c++ }
      centro[k * 3 + 1] = Math.max(y0[k], s / c)
    }
  }
  const LARGO = largo[NP - 1] || 1
  const RAD = 8
  function tubo() {
    const p = new Float32Array(NP * RAD * 3), n = new Float32Array(NP * RAD * 3), s = new Float32Array(NP * RAD)
    const T = new Vector3(), S = new Vector3(), U = new Vector3(), arriba = new Vector3(0, 1, 0)
    for (let k = 0; k < NP; k++) {
      const a = Math.max(0, k - 1), b = Math.min(NP - 1, k + 1)
      T.set(centro[b * 3] - centro[a * 3], centro[b * 3 + 1] - centro[a * 3 + 1], centro[b * 3 + 2] - centro[a * 3 + 2]).normalize()
      S.crossVectors(T, arriba)
      if (S.lengthSq() < 1e-8) S.set(1, 0, 0)
      S.normalize()
      U.crossVectors(S, T).normalize()
      for (let r = 0; r < RAD; r++) {
        const ang = (r / RAD) * Math.PI * 2, c = Math.cos(ang), sn = Math.sin(ang), o = (k * RAD + r) * 3
        p[o] = centro[k * 3]; p[o + 1] = centro[k * 3 + 1]; p[o + 2] = centro[k * 3 + 2]
        n[o] = S.x * c + U.x * sn; n[o + 1] = S.y * c + U.y * sn; n[o + 2] = S.z * c + U.z * sn
        s[k * RAD + r] = largo[k] / LARGO
      }
    }
    const id = new Uint32Array((NP - 1) * RAD * 6)
    let q = 0
    for (let k = 0; k < NP - 1; k++) for (let r = 0; r < RAD; r++) {
      const a = k * RAD + r, b = k * RAD + ((r + 1) % RAD), c = a + RAD, d = b + RAD
      id[q++] = a; id[q++] = c; id[q++] = b; id[q++] = b; id[q++] = c; id[q++] = d
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(p, 3))
    g.setAttribute('aN', new BufferAttribute(n, 3))
    g.setAttribute('aS', new BufferAttribute(s, 1))
    g.setIndex(new BufferAttribute(id, 1))
    return g
  }
  const geoR = tubo()
  const comun = {
    uProg: { value: reducido ? 1 : 0 }, uT: { value: 0 }, uPx: { value: 1 }, uLift: { value: 1 },
  }
  const vert = (ancho, levanta) => `attribute vec3 aN; attribute float aS;
    uniform float uPx, uLift; varying float vS; varying float vF;
    void main(){
      vec4 c = modelMatrix * vec4(position, 1.0);
      float d = distance(cameraPosition, c.xyz);
      float r = ${ancho.toFixed(2)} * uPx * d;
      c.y += r * ${levanta.toFixed(2)} * uLift;
      vec3 n = normalize(aN);
      vec4 w = c + vec4(n * r, 0.0);
      vec3 V = normalize(cameraPosition - w.xyz);
      vF = abs(dot(n, V));
      vS = aS;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`
  const pulso = `float pulso(float s, float t){ float p = fract(t * 0.055); float d = s - p; d -= floor(d + 0.5); return exp(-d * d * 9000.0); }`
  const matR = new ShaderMaterial({
    uniforms: comun,
    vertexShader: vert(1.0, 1.15),
    fragmentShader: `uniform float uProg, uT; varying float vS; varying float vF; ${pulso}
      void main(){
        if (vS > uProg) discard;
        float cab = uProg < 0.999 ? exp(-pow((uProg - vS) * 90.0, 2.0)) : 0.0;
        float pl = uProg >= 0.999 ? pulso(vS, uT) : 0.0;
        vec3 c = mix(vec3(1.0, 0.2, 0.1), vec3(1.0, 0.78, 0.66), pow(vF, 4.0) * 0.85);
        c = mix(c, vec3(1.0, 0.96, 0.9), clamp(cab + pl, 0.0, 1.0));
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
  const matHalo = new ShaderMaterial({
    uniforms: comun,
    vertexShader: vert(3.6, 0.32),
    fragmentShader: `uniform float uProg, uT; varying float vS; varying float vF; ${pulso}
      void main(){
        if (vS > uProg) discard;
        float cab = uProg < 0.999 ? exp(-pow((uProg - vS) * 50.0, 2.0)) : 0.0;
        float pl = uProg >= 0.999 ? pulso(vS, uT) : 0.0;
        float a = pow(vF, 2.2) * (0.42 + 0.9 * (cab + pl));
        gl_FragColor = vec4(vec3(1.0, 0.27, 0.12) * a, a);
      }`,
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  })
  const matRayos = new ShaderMaterial({
    uniforms: comun,
    vertexShader: vert(0.8, 1.15),
    fragmentShader: `uniform float uProg; varying float vS;
      void main(){ if (vS > uProg) discard; gl_FragColor = vec4(1.0, 0.33, 0.2, 0.26); }`,
    transparent: true, depthWrite: false, depthFunc: GreaterDepth,
  })
  const ruta = new Mesh(geoR, matR), halo = new Mesh(geoR, matHalo), rayos = new Mesh(geoR, matRayos)
  for (const m of [ruta, halo, rayos]) { m.frustumCulled = false; grupo.add(m) }
  ruta.renderOrder = 2; halo.renderOrder = 3; rayos.renderOrder = 4

  // ── Etiquetas (HTML): salida, meta y cumbres ──────────────────────────────────────────────────
  const etiquetas = []
  const nueva = (clase, contenido, u, v, prioridad, alza = 0) => {
    const el = document.createElement('div')
    el.className = `et ${clase}`
    el.innerHTML = contenido
    capa.appendChild(el)
    const x = X(u), z = Z(v)
    const e = { el, p: new Vector3(x, Yk(hEn(u, v)), z), alza, prioridad, oculta: false, ver: false, w: 0, h: 0, cima: clase === 'cima' }
    // El punto de anclaje: abajo en el centro (cumbre) o el centro del punto rojo (salida y meta).
    etiquetas.push(e)
    return e
  }
  const escH = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const nombreHito = (t, n) => `<i></i><span>${escH(t)}${n ? ` · <em>${escH(n)}</em>` : ''}</span>`
  nueva('hito', nombreHito(D.t.salida, D.t.salidaN), D.salida[0], D.salida[1], 10, 0.02)
  if (!D.juntas) nueva('hito', nombreHito(D.t.meta, D.t.metaN), D.meta[0], D.meta[1], 9, 0.02)
  const cimas = D.cumbres.map((c, i) => nueva('cima', `<div><b>${escH(c.n)}</b><small>${escH(c.t)}</small></div>`, c.u, c.v, 5 - i * 0.5, 0.004))
  const medirEtiquetas = () => { for (const e of etiquetas) { const r = e.el.getBoundingClientRect(); e.w = r.width; e.h = r.height } }
  medirEtiquetas()
  document.fonts?.ready.then(medirEtiquetas)

  // ── Cámara y controles ───────────────────────────────────────────────────────────────────────
  const controles = new OrbitControls(camara, lienzo)
  controles.enableDamping = true
  controles.dampingFactor = 0.075
  controles.rotateSpeed = 0.7
  controles.zoomSpeed = 0.9
  controles.screenSpacePanning = false
  controles.minPolarAngle = 0.12
  controles.maxPolarAngle = 1.3
  controles.autoRotateSpeed = 0.7
  const objetivo0 = new Vector3(0, alto * 0.32, 0)
  const vista0 = { dist: 1, polar: (52 * Math.PI) / 180, az: 0 }
  // Acimut de la lámina (0 = desde el sur; 225 = desde el noreste mirando al suroeste).
  vista0.az = Math.atan2(-Math.sin((D.acimut * Math.PI) / 180), Math.cos((D.acimut * Math.PI) / 180))
  const esquinas = []
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [-base, alto]) esquinas.push(new Vector3((sx * A) / 2, y, (sz * F) / 2))
  const tmp = new Vector3(), sph = new Spherical()
  // Planos de recorte según la distancia: con uno fijo y muy cercano, a 100 km la ruta y el terreno se pisaban.
  function planos(d) {
    const n = Math.max(0.004, d * 0.03), f = d * 4 + Math.max(A, F) * 2
    if (Math.abs(camara.near - n) > n * 0.05 || Math.abs(camara.far - f) > f * 0.05) { camara.near = n; camara.far = f; camara.updateProjectionMatrix() }
  }
  // Zona libre de la pantalla (sin la cabecera ni los botones), en píxeles.
  function zonaLibre() {
    const W = innerWidth, Hh = innerHeight
    const cab = document.querySelector('.cabeza').getBoundingClientRect(), pie = document.querySelector('.pie').getBoundingClientRect()
    if (W >= 720) return { x0: 24, x1: W - 24, y0: Math.min(cab.bottom * 0.55, Hh * 0.2), y1: Math.max(Hh * 0.72, pie.top - 8) }
    return { x0: 10, x1: W - 10, y0: cab.bottom + 6, y1: pie.top - 6 }
  }
  // Distancia a la que el bloque entero cabe en la zona libre, mirando desde (polar, az). Desplaza el centro óptico.
  function encajar(polar, az) {
    const W = innerWidth, Hh = innerHeight, z = zonaLibre()
    camara.clearViewOffset()
    const cx = (z.x0 + z.x1) / 2, cy = (z.y0 + z.y1) / 2
    camara.setViewOffset(W, Hh, W / 2 - cx, Hh / 2 - cy, W, Hh)
    camara.updateProjectionMatrix()
    const cabe = (d) => {
      planos(d)
      sph.set(d, polar, az)
      camara.position.setFromSpherical(sph).add(objetivo0)
      camara.lookAt(objetivo0)
      camara.updateMatrixWorld()
      for (const e of esquinas) {
        tmp.copy(e).project(camara)
        const px = ((tmp.x + 1) / 2) * W, py = ((1 - tmp.y) / 2) * Hh
        if (tmp.z > 1 || px < z.x0 || px > z.x1 || py < z.y0 || py > z.y1) return false
      }
      return true
    }
    let lo = 0.1, hi = 400
    for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (cabe(m)) hi = m; else lo = m }
    return hi
  }
  function medir() {
    const W = innerWidth, Hh = innerHeight
    renderer.setSize(W, Hh, false)
    camara.aspect = W / Hh
    vista0.dist = encajar(vista0.polar, vista0.az)
    controles.minDistance = vista0.dist * 0.18
    controles.maxDistance = vista0.dist * 1.7
    comun.uPx.value = 1.6 * (Math.tan((camara.fov * Math.PI) / 360) * 2) / Hh
  }
  medir()

  // ── Animación de entrada: el terreno sube desde plano y la ruta se dibuja de la salida a la meta ──
  const DUR = reducido ? 0 : 2800
  const ease = (t) => 1 - Math.pow(1 - t, 3), suave = (t) => t * t * (3 - 2 * t)
  const desde = { dist: vista0.dist * 1.32, polar: vista0.polar - 0.22, az: vista0.az - 0.5 }
  let t0 = 0, entrada = DUR > 0
  function ponerVista(v) {
    sph.set(v.dist, v.polar, v.az)
    camara.position.setFromSpherical(sph).add(controles.target)
    camara.lookAt(controles.target)
  }
  controles.target.copy(objetivo0)
  ponerVista(DUR ? desde : vista0)
  controles.update()
  grupo.scale.y = DUR ? 0.001 : 1

  // Vuelo suave de la cámara (volver a la vista inicial, ir a una cumbre).
  let vuelo = null
  function volar(objetivo, v, ms = 1100) {
    sph.setFromVector3(tmp.copy(camara.position).sub(controles.target))
    let az1 = v.az
    while (az1 - sph.theta > Math.PI) az1 -= Math.PI * 2
    while (az1 - sph.theta < -Math.PI) az1 += Math.PI * 2
    vuelo = { t0: performance.now(), ms: reducido ? 1 : ms, de: { o: controles.target.clone(), dist: sph.radius, polar: sph.phi, az: sph.theta }, a: { o: objetivo.clone(), dist: v.dist, polar: v.polar, az: az1 } }
    despertar()
  }
  function volverInicio() { controles.autoRotate = !reducido; volar(objetivo0, vista0) }

  let ultimoToque = 0, toques = 0, ultimoXY = [0, 0]
  const pararGiro = () => { controles.autoRotate = false; quitarPista() }
  controles.addEventListener('start', () => { pararGiro(); vuelo = null; despertar() })
  controles.addEventListener('change', despertar)
  lienzo.addEventListener('dblclick', (e) => { e.preventDefault(); volverInicio() })
  lienzo.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch') return
    const ahora = performance.now(), d = Math.hypot(e.clientX - ultimoXY[0], e.clientY - ultimoXY[1])
    toques = ahora - ultimoToque < 320 && d < 30 ? toques + 1 : 1
    ultimoToque = ahora; ultimoXY = [e.clientX, e.clientY]
    if (toques === 2) { toques = 0; volverInicio() }
  })
  document.getElementById('reset').addEventListener('click', volverInicio)
  for (const b of document.querySelectorAll('[data-cima]')) {
    b.addEventListener('click', () => {
      const c = cimas[+b.dataset.cima]
      if (!c) return
      pararGiro()
      sph.setFromVector3(tmp.copy(camara.position).sub(controles.target))
      volar(c.p.clone().setY(c.p.y * 0.85), { dist: vista0.dist * 0.42, polar: Math.min(sph.phi, 1.05), az: sph.theta })
    })
  }
  lienzo.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Home' || e.key === '0') volverInicio()
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { pararGiro(); sph.setFromVector3(tmp.copy(camara.position).sub(controles.target)); volar(controles.target, { dist: sph.radius, polar: sph.phi, az: sph.theta + (e.key === 'ArrowLeft' ? -0.35 : 0.35) }, 350) }
  })

  // Pista de uso: unos segundos después de la entrada, hasta que se toque.
  let pistaQuitada = false
  function quitarPista() { pistaQuitada = true; pista.classList.remove('ver') }
  pista.querySelector('span').textContent = tactil ? D.t.gira : D.t.giraRaton

  // Textura buena en segundo plano.
  leerImagen(D.textura).then((img) => {
    tex.image = img
    tex.needsUpdate = true
    VISOR.texturaBuena = true
    despertar()
  }).catch((e) => VISOR.errores.push(`textura: ${e.message || e}`))

  // ── Etiquetas: proyección, ocultas tras el relieve y sin solaparse ──────────────────────────────
  const W2 = () => innerWidth, H2 = () => innerHeight
  let cuadro = 0
  const visible = (p) => {
    // ¿Tapa el relieve el punto? Se recorre el rayo desde la cámara con la rejilla de alturas.
    const c = camara.position, n = 40
    for (let k = 1; k < n; k++) {
      const t = k / n, x = c.x + (p.x - c.x) * t, y = c.y + (p.y - c.y) * t, z = c.z + (p.z - c.z) * t
      if (Math.abs(x) > A / 2 || Math.abs(z) > F / 2) continue
      if (yEn(x, z) * grupo.scale.y > y + alto * 0.01) return false
    }
    return true
  }
  function etiquetar(mostrar) {
    const W = W2(), Hh = H2()
    const comprobar = cuadro++ % 6 === 0
    const cajas = []
    const orden = etiquetas.slice().sort((a, b) => b.prioridad - a.prioridad)
    for (const e of orden) {
      tmp.set(e.p.x, e.p.y * grupo.scale.y + e.alza * Math.max(A, F) * 0.02, e.p.z).project(camara)
      const x = ((tmp.x + 1) / 2) * W, y = ((1 - tmp.y) / 2) * Hh
      if (comprobar) e.oculta = !visible(tmp.set(e.p.x, e.p.y * grupo.scale.y + alto * 0.012, e.p.z))
      let ver = mostrar && tmp.z < 1 && x > -40 && x < W + 40 && y > 0 && y < Hh && !e.oculta
      const ox = e.cima ? x - e.w / 2 : x - 6, oy = e.cima ? y - e.h + 2.5 : y - e.h / 2
      const caja = [ox, oy, ox + e.w, oy + e.h]
      if (ver && cajas.some((b) => caja[0] < b[2] + 4 && caja[2] > b[0] - 4 && caja[1] < b[3] + 2 && caja[3] > b[1] - 2)) ver = false
      if (ver) cajas.push(caja)
      e.el.style.transform = `translate3d(${ox.toFixed(1)}px,${oy.toFixed(1)}px,0)`
      if (ver !== e.ver) { e.ver = ver; e.el.classList.toggle('ver', ver) }
    }
  }

  // ── Bucle: se para cuando no hay nada que mover (batería) ───────────────────────────────────────
  let pedido = false, quieto = 0, ultimo = performance.now()
  const frames = []
  function despertar() { quieto = performance.now(); if (!pedido) { pedido = true; requestAnimationFrame(cuadroFn) } }
  function cuadroFn(ahora) {
    pedido = false
    const dt = ahora - ultimo
    ultimo = ahora
    if (entrada) {
      if (!t0) t0 = ahora
      const t = Math.min(1, (ahora - t0) / DUR)
      grupo.scale.y = Math.max(0.001, ease(Math.min(1, t / 0.5)))
      comun.uProg.value = suave(Math.min(1, Math.max(0, (t - 0.22) / 0.74)))
      const k = ease(t)
      ponerVista({ dist: desde.dist + (vista0.dist - desde.dist) * k, polar: desde.polar + (vista0.polar - desde.polar) * k, az: desde.az + (vista0.az - desde.az) * k })
      if (t >= 1) {
        entrada = false
        comun.uProg.value = 1
        VISOR.entrada = Math.round(ahora - t0)
        controles.autoRotate = !reducido
        controles.update()
        if (!pistaQuitada) { pista.classList.add('ver'); setTimeout(quitarPista, 5000) }
      }
    } else if (vuelo) {
      const t = Math.min(1, (ahora - vuelo.t0) / vuelo.ms), k = suave(t), { de, a } = vuelo
      controles.target.lerpVectors(de.o, a.o, k)
      ponerVista({ dist: de.dist + (a.dist - de.dist) * k, polar: de.polar + (a.polar - de.polar) * k, az: de.az + (a.az - de.az) * k })
      if (t >= 1) vuelo = null
    } else {
      controles.update(Math.min(0.05, dt / 1000))
      // Sin meterse bajo el terreno ni salirse del bloque al desplazar.
      const lim = 0.5
      controles.target.x = Math.max(-A * lim, Math.min(A * lim, controles.target.x))
      controles.target.z = Math.max(-F * lim, Math.min(F * lim, controles.target.z))
      const c = camara.position
      if (Math.abs(c.x) < A / 2 && Math.abs(c.z) < F / 2) {
        const suelo = yEn(c.x, c.z) + Math.max(A, F) * 0.01
        if (c.y < suelo) { c.y = suelo; camara.lookAt(controles.target) }
      }
    }
    planos(camara.position.distanceTo(controles.target))
    comun.uT.value = ahora / 1000
    renderer.render(escena, camara)
    etiquetar(!entrada || comun.uProg.value > 0.92)
    if (!entrada && dt < 200) { frames.push(dt); if (frames.length > 90) frames.shift() }
    if (frames.length === 90 && ratio > 1 && !VISOR.ajustado) {
      const media = frames.reduce((a, b) => a + b, 0) / frames.length
      if (media > 24) { ratio = Math.max(1, ratio - 0.5); renderer.setPixelRatio(ratio); medir(); frames.length = 0; VISOR.ratio = ratio } else VISOR.ajustado = true
    }
    VISOR.ultimoDt = dt
    // Sigue mientras haya entrada, vuelo o giro automático, y 20 s después del último toque (el pulso de la ruta).
    const sigue = entrada || vuelo || controles.autoRotate || ahora - quieto < 20000
    if (sigue && !document.hidden) { pedido = true; requestAnimationFrame(cuadroFn) }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { ultimo = performance.now(); despertar() } })
  // Al girar el móvil o cambiar la ventana, la vista conserva su ángulo y se acerca o aleja en proporción.
  addEventListener('resize', () => {
    const antes = vista0.dist
    medir()
    if (!entrada) {
      sph.setFromVector3(tmp.copy(camara.position).sub(controles.target))
      sph.radius *= vista0.dist / antes
      camara.position.setFromSpherical(sph).add(controles.target)
      camara.lookAt(controles.target)
    }
    despertar()
  })

  html.classList.add('listo')
  VISOR.listo = true
  VISOR.tListo = Math.round(performance.now())
  VISOR.vertices = NC * NF
  VISOR.puntosRuta = NP
  despertar()
}
