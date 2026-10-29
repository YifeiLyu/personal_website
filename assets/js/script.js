'use strict';

(function () {

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  var hasIO = "IntersectionObserver" in window;


  // ---------- reveal on scroll ----------
  var rvs = document.querySelectorAll(".rv, .wtile");
  if (hasIO && !reduce.matches) {
    var ro = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add(e.target.classList.contains("wtile") ? "seen" : "in");
        ro.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    rvs.forEach(function (el) { ro.observe(el); });
  } else {
    rvs.forEach(function (el) { el.classList.add("in", "seen"); });
  }


  // ---------- explore menu ----------
  var exBtn = document.getElementById("exploreBtn");
  var exMenu = document.getElementById("exploreMenu");
  var exSet = function (open) {
    exMenu.hidden = !open;
    exBtn.setAttribute("aria-expanded", String(open));
  };
  exBtn.addEventListener("click", function () { exSet(exMenu.hidden); });
  exMenu.addEventListener("click", function (e) { if (e.target.closest("a")) exSet(false); });
  document.addEventListener("click", function (e) {
    if (!exMenu.hidden && !e.target.closest(".explore")) exSet(false);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !exMenu.hidden) { exSet(false); exBtn.focus(); }
  });


  // ---------- carousel helpers ----------
  var step = function (track) {
    var kids = track.children;
    if (kids.length < 2) return track.clientWidth;
    return kids[1].offsetLeft - kids[0].offsetLeft;
  };
  var scrollToX = function (track, x) {
    track.scrollTo({ left: x, behavior: reduce.matches ? "auto" : "smooth" });
  };


  // ---------- highlights: auto-advancing carousel ----------
  var hlTrack = document.getElementById("hlTrack");
  var hlPager = document.getElementById("hlPager");
  var hlPlay = document.getElementById("hlPlay");
  var hlIcon = document.getElementById("hlPlayIcon");
  var cards = hlTrack.children;
  var DWELL = 5000;
  var PAUSE_D = "M4 2.5h3.4v13H4zM10.6 2.5H14v13h-3.4z";
  var PLAY_D = "M5 2.5v13l11-6.5z";
  var idx = 0, playing = !reduce.matches, inView = false, t0 = 0, elapsed = 0, raf = 0, auto = false, autoTimer = 0;
  var dots = [];

  for (var i = 0; i < cards.length; i++) {
    var d = document.createElement("button");
    d.type = "button";
    d.className = "dot";
    d.setAttribute("aria-label", "Show highlight " + (i + 1) + " of " + cards.length);
    d.appendChild(document.createElement("i"));
    d.addEventListener("click", (function (n) { return function () { hlGo(n); }; })(i));
    hlPager.appendChild(d);
    dots.push(d);
  }

  var hlMark = function () {
    dots.forEach(function (d, n) {
      d.classList.toggle("on", n === idx);
      d.setAttribute("aria-current", n === idx ? "true" : "false");
      d.firstChild.style.setProperty("--p", n === idx ? String(Math.min(elapsed / DWELL, 1)) : "0");
    });
  };

  var hlGo = function (n) {
    idx = (n + cards.length) % cards.length;
    elapsed = 0;
    t0 = performance.now();
    // ignore the scroll events this programmatic scroll fires, so passing cards don't reset the index
    auto = true;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(function () { auto = false; }, 900);
    scrollToX(hlTrack, idx * step(hlTrack));
    hlMark();
  };

  var tick = function (now) {
    raf = 0;
    if (!(playing && inView && !document.hidden)) return;
    elapsed += now - t0;
    t0 = now;
    if (elapsed >= DWELL) hlGo(idx + 1);
    hlMark();
    raf = requestAnimationFrame(tick);
  };
  var hlSync = function () {
    if (playing && inView && !document.hidden && !raf) {
      t0 = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };

  hlTrack.addEventListener("scroll", function () {
    if (auto) return;
    var n = Math.round(hlTrack.scrollLeft / step(hlTrack));
    if (n !== idx) { idx = n; elapsed = 0; hlMark(); }
  }, { passive: true });

  hlPlay.addEventListener("click", function () {
    playing = !playing;
    hlIcon.setAttribute("d", playing ? PAUSE_D : PLAY_D);
    hlPlay.setAttribute("aria-label", playing ? "Pause highlights" : "Play highlights");
    hlSync();
  });
  if (!playing) {
    hlIcon.setAttribute("d", PLAY_D);
    hlPlay.setAttribute("aria-label", "Play highlights");
  }
  document.addEventListener("visibilitychange", hlSync);
  if (hasIO) {
    new IntersectionObserver(function (es) { inView = es[0].isIntersecting; hlSync(); }, { threshold: 0.5 }).observe(hlTrack);
  } else {
    inView = true;
  }
  hlMark();
  hlSync();


  // ---------- arrow-driven tracks ----------
  document.querySelectorAll(".arrows[data-for]").forEach(function (bar) {
    var track = document.getElementById(bar.getAttribute("data-for"));
    var prev = bar.querySelector('[data-dir="-1"]');
    var next = bar.querySelector('[data-dir="1"]');
    var sync = function () {
      var max = track.scrollWidth - track.clientWidth;
      prev.disabled = track.scrollLeft <= 2;
      next.disabled = track.scrollLeft >= max - 2;
      bar.hidden = max <= 2;
    };
    bar.addEventListener("click", function (e) {
      var b = e.target.closest(".arrow");
      if (!b) return;
      scrollToX(track, track.scrollLeft + Number(b.getAttribute("data-dir")) * step(track));
    });
    track.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    sync();
  });


  // ---------- robot filter ----------
  var fBtns = document.querySelectorAll(".fseg [data-f]");
  var rCards = document.querySelectorAll("#rGrid .rcard");
  var rCount = document.getElementById("rCount");
  var NAMES = { all: "robots", legged: "legged robots", wheeled: "wheeled robots", arm: "robot arms" };
  fBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var f = btn.getAttribute("data-f"), shown = 0;
      fBtns.forEach(function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
      rCards.forEach(function (c) {
        var on = f === "all" || c.getAttribute("data-cat") === f;
        c.hidden = !on;
        if (on) shown++;
      });
      rCount.textContent = "Showing " + shown + " " + NAMES[f] + ".";
    });
  });


  // ---------- 3D viewer: chips here, the three.js module only once the section nears the viewport ----------
  var VIEWER_URL = new URL("robot-viewer.js", document.currentScript.src).href;
  var viewer = document.getElementById("viewer");
  var chips = document.querySelectorAll("#vwChips .chip");
  var vwDesc = document.getElementById("vwDesc");
  var vwStatus = document.getElementById("vwStatus");
  var viewerLoading = false;

  var loadViewer = function () {
    if (viewerLoading) return;
    viewerLoading = true;
    import(VIEWER_URL).catch(function (err) {
      vwStatus.textContent = "The 3D viewer needs WebGL and a modern browser.";
      console.error(err);
    });
  };
  var pickRobot = function (id) {
    chips.forEach(function (c) {
      var on = c.getAttribute("data-robot") === id;
      c.toggleAttribute("data-open", on);
      c.querySelector("button").setAttribute("aria-pressed", String(on));
      if (on) vwDesc.innerHTML = c.querySelector("p").innerHTML;
    });
    if (window.robotViewer) window.robotViewer.show(id);
    else { window.robotViewerPending = id; loadViewer(); }
  };
  chips.forEach(function (c) {
    c.querySelector("button").addEventListener("click", function () { pickRobot(c.getAttribute("data-robot")); });
  });
  vwDesc.innerHTML = document.querySelector("#vwChips .chip[data-open] p").innerHTML;
  document.querySelectorAll(".v3d[data-view], .v3d-more[data-view]").forEach(function (a) {
    a.addEventListener("click", function () { pickRobot(a.getAttribute("data-view")); });
  });
  if (hasIO) {
    var vo = new IntersectionObserver(function (es) {
      if (es[0].isIntersecting) { loadViewer(); vo.disconnect(); }
    }, { rootMargin: "600px 0px" });
    vo.observe(viewer);
  } else {
    loadViewer();
  }


  // ---------- video facades: a thumbnail link until clicked, then YouTube's player in its place ----------
  document.querySelectorAll(".yt[data-yt]").forEach(function (a) {
    a.addEventListener("click", function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
      e.preventDefault();
      var box = document.createElement("div");
      box.className = a.className.replace(/\byt\b/, "");
      var f = document.createElement("iframe");
      f.src = "https://www.youtube-nocookie.com/embed/" + a.getAttribute("data-yt") + "?autoplay=1&rel=0&playsinline=1";
      f.title = a.getAttribute("aria-label").replace(/^Play video: /, "Video: ");
      f.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      f.referrerPolicy = "strict-origin-when-cross-origin";
      f.allowFullscreen = true;
      box.appendChild(f);
      a.replaceWith(box);
      f.focus();
    });
  });


  // ---------- copy email ----------
  var copyBtn = document.getElementById("copyEmail");
  copyBtn.addEventListener("click", function () {
    var label = copyBtn.textContent;
    var done = function (msg) {
      copyBtn.textContent = msg;
      setTimeout(function () { copyBtn.textContent = label; }, 1600);
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(copyBtn.getAttribute("data-copy")).then(function () { done("Copied"); }, function () { done("Copy failed"); });
    } else {
      done("Copy failed");
    }
  });

})();
