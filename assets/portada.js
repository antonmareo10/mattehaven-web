// Portada de MatteHaven (26/11/2026). La copia web-carreras.mjs a dist/web/assets/portada.js y la carga con «defer».
// Dos partes:
//  1. Lo que funciona SIEMPRE (también con «reducir movimiento»): la ficha de Navidad con los días que quedan, calculados
//     con la fecha del navegador (es verdad, no es un reloj); quitar las promos ya caducadas; llevar el nombre escrito
//     a los enlaces «Mira la tuya»; ocultar la ficha al llegar al pie.
//  2. El movimiento, solo si la cabecera puso html.mov: revelados al entrar en pantalla (una vez), contadores que suben
//     hasta la cifra real, inclinación 3D con el ratón, botones imán y scroll suave (Lenis, en local) en escritorio.
(function () {
  'use strict'
  window.MH = true
  var d = document, h = d.documentElement
  var HOY = new Date().toLocaleDateString('sv')
  var dias = function (a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 864e5) }
  var todos = function (sel, raiz) { return Array.prototype.slice.call((raiz || d).querySelectorAll(sel)) }

  // Promos con fecha de fin: fuera al día siguiente.
  todos('[data-hasta]').forEach(function (el) { if (HOY > el.getAttribute('data-hasta')) el.parentNode.removeChild(el) })
  todos('.promos').forEach(function (ul) { if (!ul.children.length) ul.parentNode.removeChild(ul) })

  // La línea de Navidad del héroe: la misma cuenta que la ficha.
  var ph = d.getElementById('plazo-heroe')
  if (ph) {
    try {
      var P = JSON.parse(ph.getAttribute('data-txt')), m = dias(HOY, ph.closest('body').querySelector('#navidad').getAttribute('data-navidad'))
      ph.innerHTML = m > 1 ? P.antes.replace('§', m) : m === 1 ? P.uno : m === 0 ? P.hoy : P.despues
    } catch (e) { /* se queda el texto del día en que se generó */ }
  }

  // Ficha de Navidad.
  var nav = d.getElementById('navidad')
  if (nav) {
    try {
      var T = JSON.parse(nav.getAttribute('data-txt')), lim = nav.getAttribute('data-navidad'), n = dias(HOY, lim)
      var t = n > 0 ? T.antes : n === 0 ? T.hoy : T.despues
      var dd = n > 0 ? (n === 1 ? T.antes.uno : T.antes.varios.replace('§', n)) : t.dias
      nav.querySelector('.et').textContent = t.et
      nav.querySelector('.dias').textContent = dd
      nav.querySelector('.plazo').textContent = t.plazo
      nav.setAttribute('aria-label', [t.et, dd, t.plazo].join(' · '))
    } catch (e) { /* se queda el texto del día en que se generó */ }
    var pie = d.querySelector('.pie')
    if (pie && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { nav.classList.toggle('fuera', es[0].isIntersecting) }).observe(pie)
    }
    // Nunca encima de los botones del héroe: si caen en la franja de abajo, donde va la ficha, la ficha se aparta.
    var cta = d.querySelector('.heroe .botones'), io2 = null
    var franja = function () {
      if (!cta || !('IntersectionObserver' in window)) return
      if (io2) io2.disconnect()
      var alto = nav.offsetHeight + 22
      io2 = new IntersectionObserver(function (es) { nav.classList.toggle('tapa', es[0].isIntersecting) }, { rootMargin: '-' + Math.max(0, window.innerHeight - alto) + 'px 0px 0px 0px' })
      io2.observe(cta)
    }
    franja()
    window.addEventListener('resize', franja)
  }

  // El nombre escrito viaja en el «#» del enlace: la página de la carrera lo pinta en la lámina. No se envía a nadie.
  // El campo del héroe y el de la galería son el mismo nombre; «Elegir su carrera» baja a la galería con él puesto.
  var nombre = d.getElementById('tu-nombre'), nh = d.getElementById('nombre-heroe'), form = d.querySelector('.heroe-form')
  if (nombre) {
    var enlaces = todos('a[data-tu]')
    var pon = function () {
      var v = nombre.value.trim().slice(0, 40)
      enlaces.forEach(function (a) {
        var base = a.getAttribute('data-tu')
        a.href = v ? base + (base.indexOf('#') < 0 ? '#' : '&') + 'nombre=' + encodeURIComponent(v) : base
      })
    }
    nombre.addEventListener('input', function () { if (nh) nh.value = nombre.value; pon() })
    if (nh) nh.addEventListener('input', function () { nombre.value = nh.value; pon() })
    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault()
        if (nh) { nombre.value = nh.value; pon() }
        var dest = d.getElementById((form.getAttribute('action') || '#').slice(1))
        if (!dest) return
        if (window.lenis) window.lenis.scrollTo(dest)
        else dest.scrollIntoView({ behavior: h.classList.contains('mov') ? 'smooth' : 'auto', block: 'start' })
      })
    }
    pon()
  }

  if (!h.classList.contains('mov')) return

  // Contadores: la cifra real está ya en el HTML; con movimiento se pone a 0 y sube al entrar en pantalla.
  var sep = h.lang === 'es' ? '.' : ','
  var fmt = function (x) { return String(x).replace(/\B(?=(\d{3})+(?!\d))/g, sep) }
  var cuentas = todos('[data-cuenta]')
  cuentas.forEach(function (el) { el.textContent = '0' })
  var cuenta = function (el) {
    var fin = +el.getAttribute('data-cuenta'), t0 = performance.now(), dur = 1100
    var paso = function (t) {
      var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3)
      el.textContent = fmt(Math.round(fin * e))
      if (p < 1) requestAnimationFrame(paso)
    }
    requestAnimationFrame(paso)
  }

  // Un solo observador para revelados, dibujos y contadores. Cada cosa ocurre una vez.
  var revela = function (el) {
    el.classList.add('visto')
    if (el.hasAttribute('data-cuenta')) cuenta(el)
  }
  var vigilar = todos('[data-rev],[data-mano],.dibujable,.firma,[data-cuenta]')
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { revela(e.target); io.unobserve(e.target) } })
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.01 })
    vigilar.forEach(function (el) { io.observe(el) })
  } else vigilar.forEach(revela)

  var fino = window.matchMedia('(pointer: fine)').matches
  if (!fino) return

  // Inclinación 3D con el ratón (la lámina del héroe y las de la galería). Un solo rAF por movimiento.
  var inclina = function (zona, sel, max) {
    var pend = null
    zona.addEventListener('pointermove', function (ev) {
      var m = ev.target.closest ? ev.target.closest(sel) : null
      if (!m && sel === '.marco3d') m = zona.querySelector(sel)
      if (!m) return
      if (pend) cancelAnimationFrame(pend)
      pend = requestAnimationFrame(function () {
        var r = m.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width - 0.5, y = (ev.clientY - r.top) / r.height - 0.5
        x = Math.max(-0.7, Math.min(0.7, x)); y = Math.max(-0.7, Math.min(0.7, y))
        m.style.setProperty('--ry', (x * max).toFixed(2) + 'deg')
        m.style.setProperty('--rx', (-y * max).toFixed(2) + 'deg')
        m.style.setProperty('--gx', ((x + 0.5) * 100).toFixed(0) + '%')
        m.style.setProperty('--gy', ((y + 0.5) * 100).toFixed(0) + '%')
        m.style.setProperty('--brillo', (60 - x * 60).toFixed(0) + '%')
      })
    })
    zona.addEventListener('pointerout', function (ev) {
      var m = ev.target.closest ? ev.target.closest(sel) : null
      if (!m || (ev.relatedTarget && m.contains(ev.relatedTarget))) return
      ;['--rx', '--ry'].forEach(function (p) { m.style.setProperty(p, '0deg') })
    })
  }
  var heroe = d.querySelector('.heroe')
  if (heroe) inclina(heroe, '.marco3d', 12)
  var rej = d.querySelector('.rejilla')
  if (rej) inclina(rej, '.marco', 10)

  // Botones imán: tiran como mucho 6 px hacia el puntero.
  todos('.iman').forEach(function (b) {
    b.addEventListener('pointermove', function (ev) {
      var r = b.getBoundingClientRect(), x = ev.clientX - r.left - r.width / 2, y = ev.clientY - r.top - r.height / 2
      b.style.transform = 'translate(' + Math.max(-6, Math.min(6, x * 0.15)).toFixed(1) + 'px,' + Math.max(-6, Math.min(6, y * 0.3)).toFixed(1) + 'px)'
    })
    b.addEventListener('pointerleave', function () { b.style.transform = '' })
  })

  // Scroll suave en escritorio (Lenis 1.3.28, MIT, en assets/). Nunca en táctil ni con «reducir movimiento».
  if (window.innerWidth >= 900) {
    var s = d.createElement('script')
    s.src = 'assets/lenis.min.js'
    s.onload = function () { if (window.Lenis) window.lenis = new window.Lenis({ autoRaf: true, anchors: true }) }
    d.head.appendChild(s)
  }
})()

// «¿No está tu carrera?» (26/11/2026): el visitante deja carrera, nombre y tiempo y su correo; se abre SU programa de
// correo con el mensaje listo para antonio@mattehaven.com (como el formulario de organizadores). Sin servidor ni
// terceros. window.abrirCorreo se puede sustituir en las pruebas para no abrir nada.
;(function(){var f=document.getElementById('otra-form');if(!f)return;var est=f.querySelector('.otra-estado');
window.abrirCorreo=window.abrirCorreo||function(u){location.href=u};
f.addEventListener('submit',function(ev){ev.preventDefault();
  var c=f.carrera.value.trim(),q=f.quien.value.trim(),m=f.correo.value.trim(),mal=!c||!m||!f.correo.checkValidity();
  f.carrera.setAttribute('aria-invalid',!c);f.correo.setAttribute('aria-invalid',!m||!f.correo.checkValidity());
  if(mal){est.textContent=f.dataset.falta;(c?f.correo:f.carrera).focus();return}
  var NL=String.fromCharCode(13,10),cuerpo=[f.dataset.hola,'',c,q,'',m].filter(function(x,i){return x||i===1||i===4}).join(NL);
  window.abrirCorreo('mailto:'+f.dataset.correo+'?subject='+encodeURIComponent(f.dataset.asunto+c)+'&body='+encodeURIComponent(cuerpo));
  est.textContent=f.dataset.ok+f.dataset.correo+'.'})})();
