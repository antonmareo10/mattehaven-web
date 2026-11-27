// Visor 3D de MatteHaven: la montaña real de la carrera con su recorrido encima, para girarla con el dedo o el ratón.
// Lo copia scripts/visor-3d.mjs a dist/web/3d/visor.js; los datos de cada carrera van dentro de su página
// (<script id="datos-visor">) y en dist/web/3d/datos/<slug>/. three.js 0.180.0 (MIT) en vendor/.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, BufferGeometry, BufferAttribute, MeshBasicMaterial, ShaderMaterial,
  Texture, SRGBColorSpace, Vector3, Spherical, AdditiveBlending, OrbitControls,
} from './vendor/three-r180.min.js'

const D = JSON.parse(document.getElementById('datos-visor').textContent)
const html = document.documentElement
const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches
const tactil = matchMedia('(pointer: coarse)').matches
const lienzo = document.getElementById('lienzo')
const capa = document.getElementById('etiquetas')
const pista = document.getElementById('pista')
const VISOR = (window.__visor = { listo: false, entrada: 0, errores: [], parado: false })
const $ = (s) => document.querySelector(s)

// Sin 3D (sin WebGL 2, contexto perdido, datos que no llegan): la lámina estática en el hueco del relieve.
function colocarEstatica() {
  const cab = $('.cabeza').getBoundingClientRect(), pie = $('.pie').getBoundingClientRect(), ancho = innerWidth >= 720
  html.style.setProperty('--arriba', `${Math.round(ancho ? 40 : cab.bottom + 14)}px`)
  html.style.setProperty('--abajo', `${Math.round(ancho ? 40 : innerHeight - pie.top + 14)}px`)
  html.style.setProperty('--izq', `${Math.round(ancho ? Math.max(cab.right, pie.right) + 40 : 16)}px`)
}
function sin3d(motivo) {
  VISOR.errores.push(String(motivo))
  VISOR.parado = true
  if (html.classList.contains('sin-3d')) return
  html.classList.add('sin-3d')
  const img = $('.estatica img')
  if (img) img.loading = 'eager'
  colocarEstatica()
  addEventListener('resize', colocarEstatica)
}

let gl2 = false
try { gl2 = !!document.createElement('canvas').getContext('webgl2') } catch { gl2 = false }
if (!gl2) sin3d('sin WebGL 2')
else {
  // Si en 20 s no ha llegado lo necesario para la primera vista, la lámina estática.
  const espera = setTimeout(() => { if (!VISOR.listo) sin3d('tiempo agotado') }, 20000)
  arrancar().then(() => clearTimeout(espera)).catch((e) => { clearTimeout(espera); console.error(e); sin3d(e?.message || e) })
}

// ── Datos ────────────────────────────────────────────────────────────────────────────────────────
// La página ya la pide en su <head> (window.__alturas), antes de que llegue este módulo; si eso falló, otra vez aquí.
async function leerAlturas({ url, nx, ny, suma }) {
  const pedir = async () => { const r = await fetch(url); if (!r.ok) throw new Error(`alturas: HTTP ${r.status}`); return r.blob() }
  const blob = await (window.__alturas || Promise.reject(new Error('sin pedido previo'))).catch(pedir)
  let fuente
  try { fuente = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }) } catch {
    fuente = new Image(); fuente.src = URL.createObjectURL(blob); await fuente.decode()
  }
  const c = document.createElement('canvas')
  c.width = nx; c.height = ny
  const x = c.getContext('2d', { willReadFrequently: true })
  x.drawImage(fuente, 0, 0)
  const px = x.getImageData(0, 0, nx, ny).data
  const Q = new Float32Array(nx * ny)
  let s = 0
  for (let k = 0; k < Q.length; k++) { Q[k] = px[k * 4] * 256 + px[k * 4 + 1]; s += Q[k] }
  // Algunos navegadores meten ruido al leer el canvas (protección contra el rastreo): un ±1 en el byte alto es un pico
  // falso de 128 m. Si la suma no cuadra, cada punto que se separa más de 60 m de la mediana de sus vecinos se corrige.
  if (suma != null && s !== suma) {
    const lim = 60 / D.pasoM, orig = Float32Array.from(Q)
    let n = 0
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const v = []
      if (i > 0) v.push(orig[j * nx + i - 1]); if (i < nx - 1) v.push(orig[j * nx + i + 1])
      if (j > 0) v.push(orig[(j - 1) * nx + i]); if (j < ny - 1) v.push(orig[(j + 1) * nx + i])
      v.sort((a, b) => a - b)
      const med = v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2
      if (Math.abs(orig[j * nx + i] - med) > lim) { Q[j * nx + i] = med; n++ }
    }
    VISOR.reparadas = n
  }
  const H = new Float32Array(nx * ny)
  for (let k = 0; k < H.length; k++) H[k] = Q[k] * D.pasoM
  return { H, nx, ny }
}

async function leerImagen(url) {
  const img = new Image()
  img.decoding = 'async'
  img.src = url
  await img.decode()
  return img
}

// Lo mismo que ISLA y enIsla en scripts/visor-3d.mjs: el relieve se funde con el fondo en un cuadrado redondeado.
const [ISLA0, ISLA1] = D.isla
const enIsla = (u, v) => ((2 * u - 1) ** 4 + (2 * v - 1) ** 4) ** 0.25

// ── Escena ───────────────────────────────────────────────────────────────────────────────────────
async function arrancar() {
  // En el móvil, la rejilla de 256 y la textura de 1536 (la textura lleva el detalle); en el ordenador, 512 y 2048.
  const pAlturas = leerAlturas(tactil ? D.alturasMovil : D.alturas)
  const pPrevia = leerImagen(D.previa)
  const { H, nx, ny } = await pAlturas
  const A = D.ancho, F = D.fondo, EX = D.exag
  const X = (u) => (u - 0.5) * A, Z = (v) => (v - 0.5) * F, Yk = (m) => (m / 1000) * EX
  let hMax = 0
  for (const v of H) if (v > hMax) hMax = v
  const alto = Yk(hMax)
  // Altura (m sobre la cota mínima) en (u, v), bilineal.
  const hEn = (u, v) => {
    const x = Math.min(nx - 1.0001, Math.max(0, u * (nx - 1))), y = Math.min(ny - 1.0001, Math.max(0, v * (ny - 1)))
    const x0 = Math.floor(x), y0 = Math.floor(y), dx = x - x0, dy = y - y0, k = y0 * nx + x0
    return (H[k] * (1 - dx) + H[k + 1] * dx) * (1 - dy) + (H[k + nx] * (1 - dx) + H[k + nx + 1] * dx) * dy
  }
  const yEn = (x, z) => Yk(hEn(x / A + 0.5, z / F + 0.5))

  const renderer = new WebGLRenderer({ canvas: lienzo, antialias: true, alpha: true, powerPreference: 'high-performance' })
  // Si el navegador retira el contexto WebGL (poca memoria, la app en segundo plano en iOS), la lámina estática.
  lienzo.addEventListener('webglcontextlost', (e) => { e.preventDefault(); sin3d('contexto WebGL perdido') })
  renderer.outputColorSpace = SRGBColorSpace
  renderer.setClearColor(0x000000, 0)
  let ratio = Math.min(devicePixelRatio || 1, 2)
  renderer.setPixelRatio(ratio)
  const escena = new Scene()
  const camara = new PerspectiveCamera(32, 1, 0.01, 400)
  const grupo = new Group()
  escena.add(grupo)

  // Terreno: rejilla desplazada, con la textura y el borde fundido con el fondo.
  const pos = new Float32Array(nx * ny * 3), uv = new Float32Array(nx * ny * 2)
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, u = i / (nx - 1), v = j / (ny - 1)
    pos[k * 3] = X(u); pos[k * 3 + 1] = Yk(H[k]); pos[k * 3 + 2] = Z(v)
    uv[k * 2] = u; uv[k * 2 + 1] = 1 - v
  }
  const idx = new Uint32Array((nx - 1) * (ny - 1) * 6)
  let q = 0
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const k = j * nx + i
    idx[q++] = k; idx[q++] = k + nx; idx[q++] = k + 1
    idx[q++] = k + 1; idx[q++] = k + nx; idx[q++] = k + nx + 1
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
  const matT = new MeshBasicMaterial({ map: tex, transparent: true })
  matT.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      { vec2 q = abs(vMapUv * 2.0 - 1.0); float d = pow(pow(q.x, 4.0) + pow(q.y, 4.0), 0.25);
        diffuseColor.a *= 1.0 - smoothstep(${ISLA0.toFixed(3)}, ${ISLA1.toFixed(3)}, d); }`)
  }
  const terreno = new Mesh(geoT, matT)
  terreno.renderOrder = 1
  grupo.add(terreno)

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
  // uMin: altura mínima sobre el suelo (4 m reales): de cerca, el radio en pantalla es muy poco y la malla, que no es
  // la bilineal, tapaba trozos del tubo.
  const comun = {
    uProg: { value: reducido ? 1 : 0 }, uT: { value: 0 }, uPx: { value: 1 }, uLift: { value: 1 }, uMin: { value: Yk(4) }, uPulso: { value: reducido ? 0 : 1 },
  }
  const vert = (ancho, levanta) => `attribute vec3 aN; attribute float aS;
    uniform float uPx, uLift, uMin; varying float vS; varying float vF;
    void main(){
      vec4 c = modelMatrix * vec4(position, 1.0);
      float d = distance(cameraPosition, c.xyz);
      float r = ${ancho.toFixed(2)} * uPx * d;
      c.y += (r * ${levanta.toFixed(2)} + uMin) * uLift;
      vec3 n = normalize(aN);
      vec4 w = c + vec4(n * r, 0.0);
      vec3 V = normalize(cameraPosition - w.xyz);
      vF = abs(dot(n, V));
      vS = aS;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`
  // Pulso: una chispa cálida que recorre el trazado cada ~18 s, como el circuito de un calendario de carreras.
  const pulso = `uniform float uPulso; float pulso(float s, float t){ float p = fract(t * 0.055); float d = s - p; d -= floor(d + 0.5); return uPulso * exp(-d * d * 6000.0); }`
  const matR = new ShaderMaterial({
    uniforms: comun,
    vertexShader: vert(1.0, 1.15),
    fragmentShader: `uniform float uProg, uT; varying float vS; varying float vF; ${pulso}
      void main(){
        if (vS > uProg) discard;
        float cab = uProg < 0.999 ? exp(-pow((uProg - vS) * 90.0, 2.0)) : 0.0;
        float pl = uProg >= 0.999 ? pulso(vS, uT) : 0.0;
        vec3 c = mix(vec3(1.0, 0.22, 0.1), vec3(1.0, 0.7, 0.56), pow(vF, 4.0) * 0.8);
        c = mix(c, vec3(1.0, 0.84, 0.66), clamp(cab + pl, 0.0, 1.0) * 0.75);
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
        float a = pow(vF, 2.2) * (0.45 + 0.6 * (cab + pl));
        gl_FragColor = vec4(vec3(1.0, 0.27, 0.12) * a, a);
      }`,
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  })
  const ruta = new Mesh(geoR, matR), halo = new Mesh(geoR, matHalo)
  for (const m of [ruta, halo]) { m.frustumCulled = false; grupo.add(m) }
  ruta.renderOrder = 0; halo.renderOrder = 3

  // ── Etiquetas (HTML): salida, meta y cumbres ──────────────────────────────────────────────────
  const etiquetas = []
  const nueva = (clase, contenido, u, v, prioridad, alza = 0) => {
    const el = document.createElement('div')
    el.className = `et ${clase}`
    el.innerHTML = contenido
    capa.appendChild(el)
    // El punto de anclaje: abajo en el centro (cumbre) o el centro del punto rojo (salida y meta).
    const e = { el, p: new Vector3(X(u), Yk(hEn(u, v)), Z(v)), alza, prioridad, oculta: false, ver: false, w: 0, h: 0, cima: clase === 'cima' }
    etiquetas.push(e)
    return e
  }
  const escH = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const nombreHito = (t, n) => `<i></i><span>${escH(t)}${n ? ` · <em>${escH(n)}</em>` : ''}</span>`
  nueva('hito', nombreHito(D.t.salida, D.t.salidaN), D.salida[0], D.salida[1], 10, 0.02)
  if (!D.juntas) nueva('hito', nombreHito(D.t.meta, D.t.metaN), D.meta[0], D.meta[1], 9, 0.02)
  const cimas = D.cumbres.map((c, i) => nueva('cima', `<div class="caja"><b>${escH(c.n)}</b><small>${escH(c.t)}</small></div>`, c.u, c.v, 5 - i * 0.5, 0.004))
  // Tamaño de la caja de texto (la etiqueta en sí mide 0 × 0 y se coloca en el punto exacto).
  const medirEtiquetas = () => { for (const e of etiquetas) { e.caja = e.el.querySelector('.caja, span'); const r = e.caja.getBoundingClientRect(); e.w = r.width; e.h = r.height } }
  medirEtiquetas()
  document.fonts?.ready.then(() => { medirEtiquetas(); medirInterfaz() })

  // ── Cámara y controles ───────────────────────────────────────────────────────────────────────
  const controles = new OrbitControls(camara, lienzo)
  controles.enableDamping = true
  controles.dampingFactor = 0.075
  controles.rotateSpeed = 0.7
  controles.zoomSpeed = 0.9
  controles.screenSpacePanning = false
  controles.minPolarAngle = 0.12
  controles.maxPolarAngle = 1.3
  controles.autoRotateSpeed = 1.1
  // Lo que tiene que caber en pantalla: el contorno de la isla (con la altura real del terreno) y sus picos más altos.
  // La isla es casi redonda: cabe igual al girar.
  const ajuste = []
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a)
    const r = 0.92 / ((c ** 4 + s ** 4) ** 0.25), u = 0.5 + (c * r) / 2, v = 0.5 + (s * r) / 2
    ajuste.push(new Vector3(X(u), Yk(hEn(u, v)), Z(v)))
  }
  for (let tj = 0; tj < 6; tj++) for (let ti = 0; ti < 6; ti++) {
    let m = -1, mi = 0, mj = 0
    for (let j = Math.floor((tj * (ny - 1)) / 6); j < Math.floor(((tj + 1) * (ny - 1)) / 6); j++) for (let i = Math.floor((ti * (nx - 1)) / 6); i < Math.floor(((ti + 1) * (nx - 1)) / 6); i++) if (H[j * nx + i] > m) { m = H[j * nx + i]; mi = i; mj = j }
    if (enIsla(mi / (nx - 1), mj / (ny - 1)) < ISLA0) ajuste.push(new Vector3(X(mi / (nx - 1)), Yk(m), Z(mj / (ny - 1))))
  }
  const estrecho = () => innerWidth < 720
  const objetivo0 = new Vector3(0, alto * 0.3, 0)
  const vista0 = { dist: 1, polar: 0, az: 0 }
  // Acimut de la lámina (0 = desde el sur; 225 = desde el noreste mirando al suroeste).
  vista0.az = Math.atan2(-Math.sin((D.acimut * Math.PI) / 180), Math.cos((D.acimut * Math.PI) / 180))
  const tmp = new Vector3(), sph = new Spherical()
  // Lo que ocupa la interfaz (columna de textos, botones, controles): una etiqueta que caiga encima no se enseña.
  let ocupado = []
  const medirInterfaz = () => {
    ocupado = ['.controles', '.pie .oferta', '.cred', '.kicker', 'h1', '.distancia', '.cifras', '.leyenda'].map((s) => $(s)?.getBoundingClientRect())
      .filter((r) => r && r.width && r.height).map((r) => [r.left, r.top, r.right, r.bottom])
  }
  // Planos de recorte según la distancia: con uno fijo y muy cercano, a 100 km la ruta y el terreno se pisaban.
  function planos(d) {
    const n = Math.max(0.004, d * 0.02), f = d * 4 + Math.max(A, F) * 2
    if (Math.abs(camara.near - n) > n * 0.05 || Math.abs(camara.far - f) > f * 0.05) { camara.near = n; camara.far = f; camara.updateProjectionMatrix() }
  }
  // Zona libre de la pantalla, en píxeles: a la derecha de la columna de textos (ordenador) o entre la cabecera y los
  // botones (móvil).
  function zonaLibre() {
    const W = innerWidth, Hh = innerHeight
    const cab = $('.cabeza').getBoundingClientRect(), pie = $('.pie').getBoundingClientRect()
    if (!estrecho()) return { x0: Math.max(cab.right, pie.right) + 24, x1: W - 24, y0: 70, y1: Hh - 24 }
    return { x0: 8, x1: W - 8, y0: cab.bottom + 8, y1: pie.top - 8 }
  }
  // Distancia a la que todo cabe en la zona libre, mirando desde (polar, az), con el centro óptico en el de la zona.
  // Prueba con la cámara y luego la deja como estaba (si no, al cambiar el tamaño se perdía la vista del usuario).
  function encajar(polar, az) {
    const W = innerWidth, Hh = innerHeight, z = zonaLibre()
    const p0 = camara.position.clone(), q0 = camara.quaternion.clone()
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
      for (const e of ajuste) {
        tmp.copy(e).project(camara)
        const px = ((tmp.x + 1) / 2) * W, py = ((1 - tmp.y) / 2) * Hh
        if (tmp.z > 1 || px < z.x0 || px > z.x1 || py < z.y0 || py > z.y1) return false
      }
      return true
    }
    let lo = 0.1, hi = 400
    for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (cabe(m)) hi = m; else lo = m }
    camara.position.copy(p0); camara.quaternion.copy(q0); camara.updateMatrixWorld()
    return hi
  }
  function medir() {
    const W = innerWidth, Hh = innerHeight
    renderer.setSize(W, Hh, false)
    camara.aspect = W / Hh
    vista0.polar = ((estrecho() ? 41 : 52) * Math.PI) / 180
    vista0.dist = encajar(vista0.polar, vista0.az)
    controles.minDistance = vista0.dist * 0.16
    controles.maxDistance = vista0.dist * 1.7
    comun.uPx.value = (tactil ? 1.6 : 1.8) * (Math.tan((camara.fov * Math.PI) / 360) * 2) / Hh
    colocarAvisos()
    medirInterfaz()
  }
  // La pista de uso y el «cargando», en el hueco del relieve.
  function colocarAvisos() {
    const z = zonaLibre()
    pista.style.left = `${Math.round((z.x0 + z.x1) / 2)}px`
    pista.style.top = `${Math.round(z.y1 - 26)}px`
    pista.style.maxWidth = `${Math.round(z.x1 - z.x0 - 16)}px`
  }

  // ── Animación de entrada: el terreno sube desde plano y la ruta se dibuja de la salida a la meta ──
  const DUR = reducido ? 0 : 2800
  const ease = (t) => 1 - Math.pow(1 - t, 3), suave = (t) => t * t * (3 - 2 * t)
  let desde = null, t0 = 0, entrada = DUR > 0
  function ponerVista(v) {
    sph.set(v.dist, v.polar, v.az)
    camara.position.setFromSpherical(sph).add(controles.target)
    camara.lookAt(controles.target)
  }
  medir()
  desde = { dist: vista0.dist * 1.32, polar: vista0.polar - 0.24, az: vista0.az - 0.55 }
  controles.target.copy(objetivo0)
  ponerVista(DUR ? desde : vista0)
  controles.update()
  grupo.scale.y = DUR ? 0.001 : 1
  // Las cifras de la cabecera cuentan hasta su valor mientras sube el relieve.
  // (Separadores de la página: «1.404» y «12,5», o en inglés «1,404» y «12.5».)
  const SM = D.sepMiles || '.', SD = D.sepDec || ','
  const cifras = [...document.querySelectorAll('.cifras b[data-n]')].map((b) => ({ b, n: +b.dataset.n, txt: b.textContent, dec: !Number.isInteger(+b.dataset.n) }))
  const pintaCifra = (c, v) => { c.b.textContent = c.dec ? v.toFixed(1).replace('.', SD) : String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, SM) }

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
  let giroDesde = 0
  const girar = (si) => { controles.autoRotate = si && !reducido; giroDesde = performance.now() }
  function volverInicio() { girar(true); volar(objetivo0, vista0) }
  const pararGiro = () => { girar(false); quitarPista() }
  controles.addEventListener('start', () => { pararGiro(); vuelo = null; despertar() })
  controles.addEventListener('change', despertar)
  lienzo.addEventListener('dblclick', (e) => { e.preventDefault(); volverInicio() })
  // Doble toque: dos toques cortos (menos de 250 ms y 10 px cada uno) seguidos; el final de un arrastre no cuenta.
  const abajo = new Map()
  let ultimoToque = 0, ultimoXY = [0, 0]
  lienzo.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') abajo.set(e.pointerId, { t: performance.now(), x: e.clientX, y: e.clientY, n: abajo.size }) })
  lienzo.addEventListener('pointerup', (e) => {
    const d0 = abajo.get(e.pointerId)
    abajo.delete(e.pointerId)
    if (!d0 || d0.n > 0 || abajo.size) { ultimoToque = 0; return }
    const ahora = performance.now()
    if (ahora - d0.t > 250 || Math.hypot(e.clientX - d0.x, e.clientY - d0.y) > 10) { ultimoToque = 0; return }
    if (ahora - ultimoToque < 320 && Math.hypot(e.clientX - ultimoXY[0], e.clientY - ultimoXY[1]) < 30) { ultimoToque = 0; volverInicio(); return }
    ultimoToque = ahora; ultimoXY = [e.clientX, e.clientY]
  })
  lienzo.addEventListener('pointercancel', (e) => abajo.delete(e.pointerId))
  $('#reset').addEventListener('click', volverInicio)
  // Brújula: gira con la vista; al pulsarla, el norte vuelve arriba sin cambiar la distancia ni la inclinación.
  const aguja = $('#aguja')
  let azAguja = null
  $('#norte').addEventListener('click', () => {
    pararGiro()
    sph.setFromVector3(tmp.copy(camara.position).sub(controles.target))
    volar(controles.target, { dist: sph.radius, polar: sph.phi, az: 0 }, 900)
  })
  for (const b of document.querySelectorAll('[data-cima]')) {
    b.addEventListener('click', () => {
      const c = cimas[+b.dataset.cima]
      if (!c) return
      pararGiro()
      sph.setFromVector3(tmp.copy(camara.position).sub(controles.target))
      volar(c.p.clone().setY(c.p.y * 0.85), { dist: vista0.dist * 0.42, polar: Math.min(sph.phi, 1.05), az: sph.theta })
    })
  }
  // Teclado (con el foco en el relieve): flechas para girar e inclinar, + y − para acercar, Esc o 0 para volver.
  lienzo.addEventListener('keydown', (e) => {
    sph.setFromVector3(tmp.copy(camara.position).sub(controles.target))
    const ir = (v) => { e.preventDefault(); pararGiro(); volar(controles.target, { dist: sph.radius, polar: sph.phi, az: sph.theta, ...v }, 350) }
    if (e.key === 'Escape' || e.key === 'Home' || e.key === '0') { e.preventDefault(); volverInicio() }
    else if (e.key === 'ArrowLeft') ir({ az: sph.theta - 0.35 })
    else if (e.key === 'ArrowRight') ir({ az: sph.theta + 0.35 })
    else if (e.key === 'ArrowUp') ir({ polar: Math.max(controles.minPolarAngle, sph.phi - 0.15) })
    else if (e.key === 'ArrowDown') ir({ polar: Math.min(controles.maxPolarAngle, sph.phi + 0.15) })
    else if (e.key === '+' || e.key === '=') ir({ dist: Math.max(controles.minDistance, sph.radius * 0.8) })
    else if (e.key === '-' || e.key === '_') ir({ dist: Math.min(controles.maxDistance, sph.radius * 1.25) })
  })

  // Pista de uso: unos segundos después de la entrada, hasta que se toque.
  let pistaQuitada = false
  function quitarPista() { pistaQuitada = true; pista.classList.remove('ver') }
  pista.querySelector('span').textContent = tactil ? D.t.gira : D.t.giraRaton
  colocarAvisos()

  // Textura buena en segundo plano.
  // (Una textura nueva: three reserva la memoria de la primera con su tamaño y no se puede subir otra más grande encima.)
  leerImagen(tactil ? D.texturaMovil : D.textura).then((img) => {
    const buena = new Texture(img)
    buena.colorSpace = SRGBColorSpace
    buena.anisotropy = tex.anisotropy
    buena.needsUpdate = true
    matT.map = buena
    tex.dispose()
    VISOR.texturaBuena = true
    despertar()
  }).catch((e) => VISOR.errores.push(`textura: ${e.message || e}`))

  // ── Etiquetas: proyección, ocultas tras el relieve y sin solaparse ──────────────────────────────
  let cuadro = 0
  const visible = (p) => {
    // ¿Tapa el relieve el punto? Se recorre el rayo desde la cámara con la rejilla de alturas (sin el borde fundido).
    const c = camara.position, n = 40
    for (let k = 1; k < n; k++) {
      const t = k / n, x = c.x + (p.x - c.x) * t, y = c.y + (p.y - c.y) * t, z = c.z + (p.z - c.z) * t
      if (Math.abs(x) > A / 2 || Math.abs(z) > F / 2 || enIsla(x / A + 0.5, z / F + 0.5) > ISLA0 + 0.05) continue
      if (yEn(x, z) * grupo.scale.y > y + alto * 0.01) return false
    }
    return true
  }
  function etiquetar(mostrar) {
    const W = innerWidth, Hh = innerHeight
    const comprobar = cuadro++ % 6 === 0
    const cajas = ocupado.slice()
    const orden = etiquetas.slice().sort((a, b) => b.prioridad - a.prioridad)
    for (const e of orden) {
      tmp.set(e.p.x, e.p.y * grupo.scale.y + e.alza * Math.max(A, F) * 0.02, e.p.z).project(camara)
      const x = ((tmp.x + 1) / 2) * W, y = ((1 - tmp.y) / 2) * Hh
      if (comprobar) e.oculta = !visible(tmp.set(e.p.x, e.p.y * grupo.scale.y + alto * 0.012, e.p.z))
      let ver = mostrar && tmp.z < 1 && x > -40 && x < W + 40 && y > 0 && y < Hh && !e.oculta
      // La caja no se sale de la pantalla: la de una cumbre se corre de lado (el palito sigue en su sitio) y la de
      // salida y meta pasa al otro lado del punto.
      let caja
      if (e.cima) {
        const l = x - e.w / 2, dx = l < 8 ? 8 - l : l + e.w > W - 8 ? W - 8 - (l + e.w) : 0
        caja = [l + dx, y - 26 - e.h, l + dx + e.w, y + 3]
        if (dx !== e.dx) { e.dx = dx; e.caja.style.transform = `translateX(${(-e.w / 2 + dx).toFixed(1)}px)` }
      } else {
        const izq = x + 15 + e.w > W - 8
        if (izq !== e.izq) { e.izq = izq; e.el.classList.toggle('izq', izq) }
        caja = izq ? [x - 15 - e.w, y - 12, x + 7, y + 12] : [x - 7, y - 12, x + 15 + e.w, y + 12]
      }
      if (ver && cajas.some((b) => caja[0] < b[2] + 4 && caja[2] > b[0] - 4 && caja[1] < b[3] + 2 && caja[3] > b[1] - 2)) ver = false
      if (ver) cajas.push(caja)
      e.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`
      if (ver !== e.ver) { e.ver = ver; e.el.classList.toggle('ver', ver) }
    }
  }
  // Nunca por debajo del terreno (tampoco en un vuelo).
  function sobreElSuelo() {
    const c = camara.position
    if (Math.abs(c.x) < A / 2 && Math.abs(c.z) < F / 2) {
      const suelo = yEn(c.x, c.z) * grupo.scale.y + Math.max(A, F) * 0.012
      if (c.y < suelo) { c.y = suelo; camara.lookAt(controles.target) }
    }
  }

  // ── Bucle: se para cuando no hay nada que mover (batería) ───────────────────────────────────────
  // El giro automático se para solo a los 90 s; sin tocar, 20 s después se deja de pintar (el pulso se queda quieto).
  let pedido = false, quieto = 0, ultimo = performance.now(), reloj = 0
  const frames = []
  function despertar() { quieto = performance.now(); if (!pedido && !VISOR.parado) { pedido = true; requestAnimationFrame(cuadroFn) } }
  function cuadroFn(ahora) {
    pedido = false
    if (VISOR.parado) return
    const dt = ahora - ultimo
    ultimo = ahora
    if (entrada) {
      if (!t0) t0 = ahora
      const t = Math.min(1, (ahora - t0) / DUR)
      grupo.scale.y = Math.max(0.001, ease(Math.min(1, t / 0.5)))
      comun.uProg.value = suave(Math.min(1, Math.max(0, (t - 0.22) / 0.74)))
      const k = ease(t)
      ponerVista({ dist: desde.dist + (vista0.dist - desde.dist) * k, polar: desde.polar + (vista0.polar - desde.polar) * k, az: desde.az + (vista0.az - desde.az) * k })
      const kc = ease(Math.min(1, t / 0.6))
      for (const c of cifras) pintaCifra(c, c.n * kc)
      if (t >= 1) {
        entrada = false
        comun.uProg.value = 1
        for (const c of cifras) c.b.textContent = c.txt
        VISOR.entrada = Math.round(ahora - t0)
        girar(true)
        controles.update()
        if (!pistaQuitada) { pista.classList.add('ver'); setTimeout(quitarPista, 5000) }
      }
    } else if (vuelo) {
      const t = Math.min(1, (ahora - vuelo.t0) / vuelo.ms), k = suave(t), { de, a } = vuelo
      controles.target.lerpVectors(de.o, a.o, k)
      ponerVista({ dist: de.dist + (a.dist - de.dist) * k, polar: de.polar + (a.polar - de.polar) * k, az: de.az + (a.az - de.az) * k })
      sobreElSuelo()
      if (t >= 1) vuelo = null
    } else {
      if (controles.autoRotate && ahora - giroDesde > 90000) controles.autoRotate = false
      controles.update(Math.min(0.05, dt / 1000))
      // Sin salirse de la isla al desplazar ni meterse bajo el terreno.
      const lim = 0.42
      controles.target.x = Math.max(-A * lim, Math.min(A * lim, controles.target.x))
      controles.target.z = Math.max(-F * lim, Math.min(F * lim, controles.target.z))
      sobreElSuelo()
    }
    planos(camara.position.distanceTo(controles.target))
    sph.setFromVector3(tmp.copy(camara.position).sub(controles.target))
    if (azAguja === null || Math.abs(sph.theta - azAguja) > 0.002) { azAguja = sph.theta; aguja.style.transform = `rotate(${azAguja.toFixed(3)}rad)` }
    // Con movimiento reducido, el pulso no corre.
    if (!reducido) reloj += Math.min(dt, 100) / 1000
    comun.uT.value = reloj
    renderer.render(escena, camara)
    etiquetar(!entrada || comun.uProg.value > 0.92)
    if (!entrada && dt < 200) { frames.push(dt); if (frames.length > 90) frames.shift() }
    if (frames.length === 90 && ratio > 1 && !VISOR.ajustado) {
      const media = frames.reduce((a, b) => a + b, 0) / frames.length
      if (media > 24) { ratio = Math.max(1, ratio - 0.5); renderer.setPixelRatio(ratio); medir(); frames.length = 0; VISOR.ratio = ratio } else VISOR.ajustado = true
    }
    const sigue = entrada || vuelo || controles.autoRotate || ahora - quieto < (reducido ? 1600 : 20000)
    if (sigue && !document.hidden && !pedido) { pedido = true; requestAnimationFrame(cuadroFn) }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { ultimo = performance.now(); despertar() } })
  // Al girar el móvil o cambiar la ventana, la vista conserva su ángulo y se acerca o aleja en proporción.
  addEventListener('resize', () => {
    if (VISOR.parado) return
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
  // Para las pruebas (scripts de comprobación): giro, posición de la cámara y si está por debajo del terreno.
  VISOR.gira = () => controles.autoRotate
  VISOR.camara = () => camara.position.toArray().map((v) => +v.toFixed(4))
  VISOR.acimut = () => +sph.setFromVector3(tmp.copy(camara.position).sub(controles.target)).theta.toFixed(3)
  VISOR.bajoTerreno = () => Math.abs(camara.position.x) < A / 2 && Math.abs(camara.position.z) < F / 2 && camara.position.y < yEn(camara.position.x, camara.position.z)
  VISOR.vertices = nx * ny
  VISOR.puntosRuta = NP
  despertar()
}
