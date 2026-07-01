/* =========================================================================
   Welcome Splash — Sistem Informasi Klinik Imanuel
   Animasi pembuka 3D glossy (glass effect) yang otomatis berlanjut ke
   halaman index. Mulus, tanpa jeda, tanpa tombol "masuk".

   CARA PAKAI (cukup 1 baris di dalam <head> index.html):
       <script src="welcome-splash.js"></script>

   File yang dibutuhkan di root repo:
       - welcome.mp4               (video animasi)
       - logo klinik imanuel.png   (sudah ada — dipakai untuk mode hemat gerak)
   ========================================================================= */
(function () {
  "use strict";

  /* ====== PENGATURAN — silakan ubah bila perlu ========================== */
  var CONFIG = {
    videoSrc:       "welcome.mp4",              // lokasi video (root repo)
    posterSrc:      "logo klinik imanuel.png",  // logo statis (fallback)
    oncePerSession: false,   // true: tampil sekali per sesi browser · false: setiap kali dibuka
    showSkip:       true,    // tampilkan tombol "Lewati" yang halus (set false untuk sembunyikan)
    skipAppearMs:   1800,    // kapan tombol "Lewati" mulai muncul (ms)
    fadeOutMs:      750,     // durasi transisi keluar menuju index (ms)
    maxWaitMs:      9000,    // pengaman: bila video gagal/lambat, tetap lanjut setelah ms ini
    title:          "KLINIK IMANUEL",
    vision:         "Mewujudnyatakan Kristus dalam pelayanan kesehatan"
  };
  /* ===================================================================== */

  var PREVIEW = !!window.WSP_PREVIEW;   // mode preview (tidak dipakai di produksi)

  if (window.__wspLoaded) return;
  window.__wspLoaded = true;

  // Sekali per sesi (opsional)
  if (!PREVIEW && CONFIG.oncePerSession) {
    try { if (sessionStorage.getItem("wsp_seen") === "1") return; } catch (e) {}
  }

  var reduce = false;
  try {
    reduce = window.matchMedia &&
             window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) {}

  var root = document.documentElement;

  /* ---- Penutup instan (anti-kedip): dicat lewat html::before sebelum
          <body> selesai dimuat, sehingga halaman index tak sempat "berkedip". */
  root.classList.add("wsp-lock");

  /* ---- Sisipkan style ---- */
  var css = [
    "html.wsp-lock{overflow:hidden !important}",
    "html.wsp-lock::before{content:'';position:fixed;inset:0;z-index:2147483646;",
      "background:radial-gradient(circle at 50% 44%,#163a63 0%,#0e2846 46%,#081a30 100%)}",

    "#wsp-overlay{position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;",
      "align-items:center;justify-content:center;gap:clamp(18px,3.4vh,34px);overflow:hidden;",
      "background:radial-gradient(circle at 50% 44%,#163a63 0%,#0e2846 46%,#081a30 100%);",
      "font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;color:#eaf2ff;",
      "-webkit-tap-highlight-color:transparent;opacity:1;",
      "transition:opacity var(--wsp-fade,750ms) ease,filter var(--wsp-fade,750ms) ease,transform var(--wsp-fade,750ms) ease}",
    "#wsp-overlay.wsp-out{opacity:0;filter:blur(6px);transform:scale(1.03);pointer-events:none}",

    // cahaya latar (ambient glow) di belakang panggung video
    "#wsp-overlay::after{content:'';position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);",
      "width:min(74vmin,560px);height:min(74vmin,560px);pointer-events:none;z-index:0;filter:blur(22px);",
      "background:radial-gradient(circle,rgba(96,156,236,.34) 0%,rgba(64,124,214,.12) 40%,transparent 70%)}",

    ".wsp-stage{position:relative;z-index:1}",
    ".wsp-video-wrap{position:relative;width:min(78vmin,460px);aspect-ratio:1/1;background:#04101f;",
      "border-radius:clamp(22px,4vmin,34px);overflow:hidden;opacity:0;transform:translateY(10px) scale(.985);",
      "transition:opacity .7s ease,transform .9s cubic-bezier(.2,.7,.2,1);",
      "box-shadow:0 30px 80px -20px rgba(8,26,60,.78),0 0 0 1px rgba(255,255,255,.06),inset 0 1px 0 rgba(255,255,255,.18)}",
    "#wsp-overlay.wsp-playing .wsp-video-wrap{opacity:1;transform:none}",
    ".wsp-video-wrap video{width:100%;height:100%;object-fit:cover;display:block}",
    // pinggiran kaca (rim highlight) + bayangan lembut di bawah
    ".wsp-video-wrap::before{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:3;",
      "border:1px solid rgba(255,255,255,.10);",
      "box-shadow:inset 0 1px 1px rgba(255,255,255,.30),inset 0 -18px 40px -22px rgba(0,0,0,.6)}",

    // kilau kaca (glass shine) sekali sapuan
    ".wsp-shine{position:absolute;top:-30%;left:-60%;width:45%;height:160%;z-index:4;pointer-events:none;",
      "transform:translateX(0) rotate(8deg);",
      "background:linear-gradient(105deg,transparent 0%,rgba(255,255,255,0) 32%,rgba(255,255,255,.34) 50%,rgba(255,255,255,0) 68%,transparent 100%)}",
    "#wsp-overlay.wsp-playing .wsp-shine{animation:wsp-sweep 2.6s cubic-bezier(.4,0,.2,1) .55s 1 both}",
    "@keyframes wsp-sweep{from{transform:translateX(0) rotate(8deg)}to{transform:translateX(420%) rotate(8deg)}}",

    // panel kaca (frosted) untuk judul + visi
    ".wsp-caption{position:relative;z-index:1;text-align:center;max-width:min(88vw,520px);",
      "padding:clamp(14px,2.2vh,20px) clamp(22px,4vw,34px);border-radius:18px;",
      "background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.10);",
      "-webkit-backdrop-filter:blur(14px) saturate(120%);backdrop-filter:blur(14px) saturate(120%);",
      "box-shadow:inset 0 1px 0 rgba(255,255,255,.14),0 20px 50px -30px rgba(0,0,0,.6);",
      "opacity:0;transform:translateY(14px);",
      "transition:opacity .8s ease .25s,transform .8s cubic-bezier(.2,.7,.2,1) .25s}",
    "#wsp-overlay.wsp-playing .wsp-caption,#wsp-overlay.wsp-reduced .wsp-caption{opacity:1;transform:none}",
    ".wsp-title{margin:0;font-weight:600;font-size:clamp(19px,4.6vw,30px);letter-spacing:.30em;",
      "padding-left:.30em;color:#f4f8ff;text-shadow:0 2px 20px rgba(120,170,240,.35)}",
    ".wsp-rule{width:52px;height:3px;margin:12px auto 11px;border-radius:3px;",
      "background:linear-gradient(90deg,#e11507 0%,#1fa80a 100%);box-shadow:0 0 14px rgba(225,21,7,.32)}",
    ".wsp-vision{margin:0;font-weight:300;font-style:italic;line-height:1.5;letter-spacing:.01em;",
      "font-size:clamp(12.5px,3vw,15.5px);color:#c8d8f0}",

    // progres tipis (sinkron dengan video)
    ".wsp-progress{position:relative;z-index:1;width:min(60vmin,240px);height:3px;border-radius:3px;",
      "background:rgba(255,255,255,.12);overflow:hidden}",
    ".wsp-fill{position:absolute;inset:0;transform-origin:left center;transform:scaleX(0);border-radius:3px;",
      "background:linear-gradient(90deg,rgba(180,215,255,.9),#eaf3ff);box-shadow:0 0 12px rgba(150,200,255,.6);",
      "transition:transform .12s linear}",

    // tombol Lewati (halus)
    ".wsp-skip{position:absolute;bottom:clamp(18px,4vh,34px);right:clamp(18px,4vw,30px);z-index:5;",
      "font:500 12.5px/1 'Inter',sans-serif;letter-spacing:.02em;color:#bcd0ee;cursor:pointer;",
      "background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);",
      "-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);padding:8px 14px;border-radius:999px;",
      "opacity:0;transition:opacity .5s ease,background .2s,color .2s}",
    ".wsp-skip:hover{background:rgba(255,255,255,.12);color:#eaf3ff}",
    "#wsp-overlay.wsp-show-skip .wsp-skip{opacity:.85}",

    // petunjuk ketuk (bila autoplay diblokir)
    ".wsp-tap-hint{position:absolute;bottom:clamp(64px,12vh,96px);left:0;right:0;z-index:5;text-align:center;",
      "font:500 13px 'Inter',sans-serif;color:#cfe0f8;opacity:0;transition:opacity .4s}",
    "#wsp-overlay.wsp-tap .wsp-tap-hint{opacity:.9;animation:wsp-pulse 1.6s ease-in-out infinite}",
    "@keyframes wsp-pulse{0%,100%{opacity:.5}50%{opacity:1}}",

    // mode hemat gerak (prefers-reduced-motion) / fallback: logo statis
    ".wsp-poster{display:none}",
    "#wsp-overlay.wsp-reduced video,#wsp-overlay.wsp-reduced .wsp-shine{display:none}",
    "#wsp-overlay.wsp-reduced .wsp-progress{display:none}",
    "#wsp-overlay.wsp-reduced .wsp-video-wrap{opacity:1;transform:none;background:transparent;",
      "box-shadow:none;border:none}",
    "#wsp-overlay.wsp-reduced .wsp-video-wrap::before{display:none}",
    "#wsp-overlay.wsp-reduced .wsp-poster{display:block;width:74%;height:74%;margin:13% auto;",
      "object-fit:contain;filter:drop-shadow(0 14px 34px rgba(0,0,0,.5))}",

    "@media (prefers-reduced-motion:reduce){.wsp-shine{display:none !important}}",
    "@media (max-width:520px){.wsp-video-wrap{width:min(84vmin,360px)}}"
  ].join("");

  var styleEl = document.createElement("style");
  styleEl.id = "wsp-style";
  styleEl.textContent = css;
  (document.head || root).appendChild(styleEl);

  /* ---- Bangun overlay ---- */
  function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  var overlay = document.createElement("div");
  overlay.id = "wsp-overlay";
  overlay.setAttribute("role", "img");
  overlay.setAttribute("aria-label", "Animasi pembuka " + CONFIG.title);
  overlay.style.setProperty("--wsp-fade", CONFIG.fadeOutMs + "ms");
  overlay.innerHTML =
    '<div class="wsp-stage"><div class="wsp-video-wrap">' +
      '<video id="wsp-video" playsinline muted preload="auto" src="' + esc(CONFIG.videoSrc) + '"></video>' +
      '<img class="wsp-poster" src="' + esc(CONFIG.posterSrc) + '" alt="">' +
      '<span class="wsp-shine"></span>' +
    '</div></div>' +
    '<div class="wsp-caption">' +
      '<h1 class="wsp-title">' + esc(CONFIG.title) + '</h1>' +
      '<div class="wsp-rule"></div>' +
      '<p class="wsp-vision">' + esc(CONFIG.vision) + '</p>' +
    '</div>' +
    '<div class="wsp-progress"><span class="wsp-fill" id="wsp-fill"></span></div>' +
    '<div class="wsp-tap-hint">Ketuk untuk memulai</div>' +
    (CONFIG.showSkip ? '<button class="wsp-skip" type="button" aria-label="Lewati animasi pembuka">Lewati &rsaquo;</button>' : '');

  var dismissed = false;
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    try { sessionStorage.setItem("wsp_seen", "1"); } catch (e) {}
    // buka penutup instan supaya index tampak menembus saat overlay memudar (crossfade mulus)
    root.classList.remove("wsp-lock");
    overlay.classList.add("wsp-out");
    var t = setTimeout(cleanup, CONFIG.fadeOutMs + 80);
    overlay.addEventListener("transitionend", function () { clearTimeout(t); cleanup(); }, { once: true });
  }
  function cleanup() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    root.classList.remove("wsp-lock");
  }

  /* ---- Pasang ke <body> secepatnya (mulai video lebih awal) ---- */
  function mount() {
    document.body.appendChild(overlay);
    wire();
  }
  (function waitBody() {
    if (document.body) mount();
    else if (window.requestAnimationFrame) requestAnimationFrame(waitBody);
    else document.addEventListener("DOMContentLoaded", mount, { once: true });
  })();

  function wire() {
    var video = overlay.querySelector("#wsp-video");
    var fill  = overlay.querySelector("#wsp-fill");
    var skip  = overlay.querySelector(".wsp-skip");

    if (skip) skip.addEventListener("click", dismiss);

    // Mode hemat gerak: logo statis, tahan sebentar, lalu keluar (tanpa video)
    if (reduce) {
      overlay.classList.add("wsp-reduced");
      if (!PREVIEW) setTimeout(dismiss, 1600);
      if (PREVIEW) exposePreview(video);
      return;
    }

    video.muted = true; video.setAttribute("muted", "");
    video.setAttribute("autoplay", "");

    // progres mengikuti waktu video
    video.addEventListener("timeupdate", function () {
      if (video.duration) {
        fill.style.transform = "scaleX(" + Math.min(1, video.currentTime / video.duration) + ")";
      }
    });

    // fade-in video begitu frame siap
    function showVideo() { overlay.classList.add("wsp-playing"); }
    if (video.readyState >= 2) showVideo();
    else video.addEventListener("loadeddata", showVideo, { once: true });

    // selesai → lanjut ke index
    if (!PREVIEW) {
      video.addEventListener("ended", dismiss);

      // video gagal dimuat → langsung tampilkan index (jangan sampai macet)
      video.addEventListener("error", function () {
        overlay.classList.add("wsp-reduced");
        setTimeout(dismiss, 700);
      });

      // pengaman: bila 'ended' tak pernah terpicu
      setTimeout(dismiss, CONFIG.maxWaitMs);

      // tombol Lewati muncul perlahan
      if (CONFIG.showSkip) setTimeout(function () { overlay.classList.add("wsp-show-skip"); }, CONFIG.skipAppearMs);
    }

    // coba putar otomatis; bila diblokir → izinkan ketuk
    var p = video.play();
    if (p && p.catch) {
      p.catch(function () {
        overlay.classList.add("wsp-tap");
        overlay.addEventListener("click", function () {
          overlay.classList.remove("wsp-tap");
          video.play();
        }, { once: true });
      });
    }

    if (PREVIEW) exposePreview(video);
  }

  // Hook preview (inert di produksi): biar bisa di-seek & di-screenshot dari luar
  function exposePreview(video) {
    window.__wsp = {
      overlay: overlay, video: video,
      play: function () { overlay.classList.add("wsp-playing"); },
      reduced: function () { overlay.classList.add("wsp-reduced"); },
      seek: function (t) {
        return new Promise(function (res) {
          function done() { video.removeEventListener("seeked", done); res(); }
          video.addEventListener("seeked", done);
          try { video.pause(); } catch (e) {}
          video.currentTime = t;
          var d = video.duration || 5.875;
          if (video.querySelector) {}
          var fill = overlay.querySelector("#wsp-fill");
          if (fill) fill.style.transform = "scaleX(" + Math.min(1, t / d) + ")";
        });
      }
    };
  }
})();
