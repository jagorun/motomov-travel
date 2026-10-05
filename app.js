const money = new Intl.NumberFormat("ru-RU");
const colors = ["#2c6b3c", "#8a5a2b", "#3d6f8a", "#6b4c7a", "#8a3d3d", "#4f6b3c", "#8a6a2b", "#2b6b6b", "#3a5a8a", "#6b5a2b", "#2b5a4a", "#7a4a62", "#4a6b2b"];

/** Current canon only. History leftovers (Crystal, Limak, Concorde, …) never render. */
const CANON = [
  "Akra Antalya Hotel 5*",
  "Arum Barut Collection 5*",
  "Barut Hemera 5*",
  "Dobedan Exclusive Hotel & Spa 5*",
  "Kirman Belazur Resort & Spa 5*",
  "Nirvana Dolce Vita Hotel 5*",
  "Voyage Sorgun 5*",
  "Sidemarin Kirman Premium 5*",
  "Bellis Deluxe Hotel 5*",
  "TUI Blue Sherwood Belek 5* (only adults 16+)",
  "Papillon Ayscha Hotel 5*",
  "Papillon Belvil Hotel 5*",
  "Papillon Zeugma Hotel 5*"
];
const CANON_SET = new Set(CANON);

/** Порядок «Мой топ» в разделе Цены. Меняйте этот массив. */
const MY_TOP = [
  "Kirman Belazur Resort & Spa 5*",
  "Bellis Deluxe Hotel 5*",
  "TUI Blue Sherwood Belek 5* (only adults 16+)",
  "Papillon Ayscha Hotel 5*"
];
const MY_TOP_RANK = new Map(MY_TOP.map((name, i) => [name, i + 1]));

const WX_PLACES = {
  "Анталия": { lat: 36.8969, lon: 30.7133 },
  "Кемер": { lat: 36.5978, lon: 30.5606 }
};

let barChart = null;
let lineChart = null;
let modalChart = null;
let wxChart = null;
let dynPack = null;
let tourCaption = "AI · 8 ночей · вылет 31.10.2026";
let priceHotelsCache = [];
let priceSort = "top"; // top | price | name

function rub(n) {
  if (n == null || Number.isNaN(Number(n))) return "нет цены";
  return money.format(n) + " ₽";
}

function shortName(n) {
  return String(n || "").replace(" 5*", "");
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "\u0026amp;")
    .replace(/</g, "\u003c")
    .replace(/>/g, "\u003e")
    .replace(/"/g, "\u0026quot;");
}

/** Stable id for reviews / deep links. ASCII slug from hotel name. */
function hotelSlug(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\s*\(only adults[^)]*\)/g, "")
    .replace(/\s*5\*/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "hotel";
}

function reviewId(name) {
  return "review-" + hotelSlug(name);
}

async function getJson(path) {
  const res = await fetch(path + "?ts=" + Date.now());
  if (!res.ok) return null;
  return res.json();
}

function signedDelta(cur, prev) {
  if (cur == null || prev == null) return null;
  return cur - prev;
}

function deltaHtml(d) {
  if (d == null) return "<span class='delta-na'>первая точка</span>";
  if (d === 0) return "<span class='delta-flat'>без изменений</span>";
  const up = d > 0;
  const cls = up ? "delta-up" : "delta-down";
  const sign = up ? "+" : "−";
  return "<span class='" + cls + "'>" + sign + money.format(Math.abs(d)) + " ₽</span>";
}

function sparkline(series, color) {
  const vals = series.filter(v => v != null);
  if (vals.length < 2) {
    return "<svg class='spark' viewBox='0 0 64 24' aria-hidden='true'><circle cx='56' cy='12' r='3' fill='" + color + "'/></svg>";
  }
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = Math.max(1, max - min);
  const w = 64, h = 24, pad = 2;
  const pts = series.map((v, i) => {
    if (v == null) return null;
    const x = pad + (i * (w - pad * 2)) / Math.max(1, series.length - 1);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return x.toFixed(1) + "," + y.toFixed(1);
  }).filter(Boolean).join(" ");
  return "<svg class='spark' viewBox='0 0 " + w + " " + h + "' aria-hidden='true'><polyline fill='none' stroke='" + color + "' stroke-width='2' points='" + pts + "'/></svg>";
}

function moscowYmd(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(d);
}

function prevYmd(ymd) {
  const parts = String(ymd || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some(n => !n)) return "";
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return dt.getUTCFullYear() + "-" + mm + "-" + dd;
}

function slotKind(slot) {
  const s = String(slot || "").toLowerCase();
  if (s === "вечер" || s === "vecher") return "vecher";
  if (s === "утро" || s === "utro") return "utro";
  return "other";
}

function pointLabel(p) {
  if (!p || !p.at) return "";
  const d = new Date(p.at);
  const day = d.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit" });
  const kind = slotKind(p.slot);
  const slot = kind === "vecher" ? "вечер" : kind === "utro" ? "утро" : "";
  return day + (slot ? " " + slot : "");
}

function lastOf(list) {
  return list.length ? list[list.length - 1] : null;
}

/** Yesterday = previous Moscow calendar day. Prefer vecher, else utro. No other slots, no invented prices. */
function pickYesterday(points, ymd) {
  const day = points.filter(p => moscowYmd(p.at) === ymd);
  const vecher = day.filter(p => slotKind(p.slot) === "vecher");
  if (vecher.length) return lastOf(vecher);
  const utro = day.filter(p => slotKind(p.slot) === "utro");
  return lastOf(utro);
}

function pickThisMorning(points, ymd, currentAt) {
  const utro = points.filter(p => moscowYmd(p.at) === ymd && slotKind(p.slot) === "utro" && String(p.at) <= String(currentAt));
  return lastOf(utro);
}

function priceAt(point, name) {
  if (!point || !point.hotels || point.hotels[name] == null) return null;
  return point.hotels[name];
}

/** Build per-hotel series from history points + current prices. Canon names only. */
function buildSeries(history, currentHotels, meta) {
  const points = ((history && history.points) || [])
    .filter(p => p && p.at)
    .slice()
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));

  const currentMap = {};
  (currentHotels || []).forEach(h => {
    if (h && CANON_SET.has(h.name) && h.price != null) currentMap[h.name] = h.price;
  });

  const names = CANON.filter(name => currentMap[name] != null || points.some(p => p.hotels && p.hotels[name] != null));

  const currentAt = (meta && meta.updatedAt) || (points.length ? points[points.length - 1].at : "");
  const currentDay = moscowYmd(currentAt);
  const yDay = prevYmd(currentDay);
  const evening = slotKind(meta && meta.slot) === "vecher";
  const yesterdayPoint = yDay ? pickYesterday(points, yDay) : null;
  const morningPoint = evening && currentDay ? pickThisMorning(points, currentDay, currentAt) : null;

  const labels = points.map(p => {
    const d = new Date(p.at);
    const t = d.toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" });
    const day = d.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit" });
    return day + " " + t + (p.slot ? " · " + p.slot : "");
  });

  const byHotel = {};
  names.forEach(name => {
    const series = points.map(p => (p.hotels && p.hotels[name] != null) ? p.hotels[name] : null);
    const cur = currentMap[name] != null ? currentMap[name] : null;
    const prev = priceAt(yesterdayPoint, name);
    const morning = priceAt(morningPoint, name);
    byHotel[name] = {
      series,
      cur,
      prev,
      delta: signedDelta(cur, prev),
      morning,
      deltaMorning: signedDelta(cur, morning)
    };
  });

  return { points, labels, names, byHotel, evening, yesterdayPoint, morningPoint, currentDay, yDay };
}

function deltaLine(label, value, delta) {
  const was = value != null ? rub(value) : "—";
  const change = value == null ? "<span class='delta-na'>нет точки</span>" : deltaHtml(delta);
  return "<div class='delta-line'><span>" + label + ": " + was + "</span>" + change + "</div>";
}

function renderDeltas(pack) {
  const host = document.getElementById("deltas");
  const rows = pack.names
    .map(name => ({ name, ...pack.byHotel[name] }))
    .filter(r => r.cur != null)
    .sort((a, b) => a.cur - b.cur);

  if (!rows.length) {
    host.innerHTML = "<p class='empty'>Пока нет цен для сравнения.</p>";
    return;
  }

  const yWhen = pack.yesterdayPoint ? pointLabel(pack.yesterdayPoint) : "";
  const mWhen = pack.morningPoint ? pointLabel(pack.morningPoint) : "";

  host.innerHTML = rows.map((r, i) => {
    const color = colors[i % colors.length];
    let lines = deltaLine("было вчера" + (yWhen ? " (" + yWhen + ")" : ""), r.prev, r.delta);
    if (pack.evening) {
      lines += deltaLine("было утром" + (mWhen ? " (" + mWhen + ")" : ""), r.morning, r.deltaMorning);
    }
    return (
      "<article class='delta-card' tabindex='0' role='button' data-hotel='" + esc(r.name) + "' aria-label='График " + esc(shortName(r.name)) + "'>" +
        "<div class='delta-top'>" +
          "<h3>" + esc(shortName(r.name)) + "</h3>" +
          sparkline(r.series, color) +
        "</div>" +
        "<div class='delta-price'>" + rub(r.cur) + "</div>" +
        "<div class='delta-lines'>" + lines + "</div>" +
      "</article>"
    );
  }).join("");
}

function openHotelModal(name) {
  if (!dynPack || !name) return;
  const info = dynPack.byHotel[name];
  if (!info) return;

  const modal = document.getElementById("hotel-modal");
  const title = document.getElementById("modal-title");
  const priceEl = document.getElementById("modal-price");
  const meta = document.getElementById("modal-meta");
  const kicker = document.getElementById("modal-kicker");
  const empty = document.getElementById("modal-empty");
  const canvas = document.getElementById("modal-chart");

  kicker.textContent = tourCaption;
  title.textContent = shortName(name);
  priceEl.textContent = rub(info.cur);
  const pts = (info.series || []).filter(v => v != null).length;
  meta.textContent = pts
    ? ("Точек в history: " + pts + " · только реальные съёмки, без выдуманных цен.")
    : "В history.json по этому отелю пока нет точек.";

  const pairs = dynPack.points
    .map((p, i) => ({ label: dynPack.labels[i], value: info.series[i], at: p.at }))
    .filter(p => p.value != null);

  if (modalChart) {
    modalChart.destroy();
    modalChart = null;
  }

  if (!pairs.length || typeof Chart === "undefined") {
    empty.hidden = false;
    canvas.style.display = "none";
  } else {
    empty.hidden = true;
    canvas.style.display = "block";
    const color = colors[Math.max(0, dynPack.names.indexOf(name)) % colors.length];
    modalChart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels: pairs.map(p => p.label),
        datasets: [{
          label: shortName(name),
          data: pairs.map(p => p.value),
          borderColor: color,
          backgroundColor: color + "33",
          fill: true,
          tension: 0.25,
          pointRadius: 5,
          pointHoverRadius: 7,
          borderWidth: 2.5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => (ctx.parsed.y == null ? "—" : money.format(ctx.parsed.y) + " ₽")
            }
          }
        },
        scales: {
          x: {
            ticks: { font: { size: 10 }, color: "#5c645c", maxRotation: 40 },
            grid: { display: false },
            title: { display: true, text: "Дата / съёмка", color: "#5c645c", font: { size: 11 } }
          },
          y: {
            ticks: { callback: v => money.format(v), font: { size: 11 }, color: "#5c645c" },
            grid: { color: "rgba(44,107,60,.08)" },
            title: { display: true, text: "Цена, ₽", color: "#5c645c", font: { size: 11 } }
          }
        }
      }
    });
  }

  modal.hidden = false;
  document.body.classList.add("modal-open");
  const closeBtn = modal.querySelector(".modal-close");
  if (closeBtn) closeBtn.focus();
}

function closeHotelModal() {
  const modal = document.getElementById("hotel-modal");
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.body.classList.remove("modal-open");
  if (modalChart) {
    modalChart.destroy();
    modalChart = null;
  }
}

function renderBarCompare(pack) {
  const canvas = document.getElementById("bar-compare");
  const rows = pack.names
    .map(name => ({ name, ...pack.byHotel[name] }))
    .filter(r => r.cur != null)
    .sort((a, b) => a.cur - b.cur);

  if (!rows.length || typeof Chart === "undefined") {
    return;
  }

  if (barChart) barChart.destroy();
  barChart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: rows.map(r => shortName(r.name)),
      datasets: [
        {
          label: "Сейчас",
          data: rows.map(r => r.cur),
          backgroundColor: "rgba(44,107,60,.75)",
          borderRadius: 6
        },
        {
          label: "Было вчера",
          data: rows.map(r => r.prev),
          backgroundColor: "rgba(138,90,43,.45)",
          borderRadius: 6
        }
      ].concat(pack.evening ? [{
        label: "Было утром",
        data: rows.map(r => r.morning),
        backgroundColor: "rgba(61,111,138,.45)",
        borderRadius: 6
      }] : [])
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: ctx => (ctx.dataset.label || "") + ": " + (ctx.parsed.y == null ? "—" : money.format(ctx.parsed.y) + " ₽")
          }
        }
      },
      scales: {
        x: { ticks: { maxRotation: 45, minRotation: 0, font: { size: 11 }, color: "#5c645c" }, grid: { display: false } },
        y: {
          ticks: {
            callback: v => money.format(v),
            font: { size: 11 },
            color: "#5c645c"
          },
          grid: { color: "rgba(44,107,60,.08)" }
        }
      }
    }
  });
}

function renderLineHistory(pack) {
  const canvas = document.getElementById("line-history");
  const fallback = document.getElementById("lines");
  const note = document.getElementById("chart-note");

  if (!pack.points.length) {
    note.textContent = "В history.json пока нет точек.";
    fallback.innerHTML = "<p class='empty'>История пуста.</p>";
    return;
  }

  if (pack.points.length < 2) {
    note.textContent = "Пока одна съёмка в history.json — линия появится со второй точки. Ниже — дельты по текущим ценам, когда появится сравнение.";
  } else {
    note.textContent = "Каждая точка — реальная съёмка из history.json. Без выдуманных значений. Ось — ₽ за двоих, пакет с перелётом.";
  }

  if (typeof Chart === "undefined") {
    fallback.innerHTML = svgLines(pack);
    return;
  }

  fallback.innerHTML = "";
  if (lineChart) lineChart.destroy();

  const datasets = pack.names.map((name, i) => ({
    label: shortName(name),
    data: pack.byHotel[name].series,
    borderColor: colors[i % colors.length],
    backgroundColor: colors[i % colors.length],
    spanGaps: true,
    tension: 0.25,
    pointRadius: 4,
    pointHoverRadius: 6,
    borderWidth: 2,
    hidden: pack.byHotel[name].series.filter(v => v != null).length === 0
  })).filter(ds => !ds.hidden);

  lineChart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: { labels: pack.labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: ctx => (ctx.dataset.label || "") + ": " + (ctx.parsed.y == null ? "—" : money.format(ctx.parsed.y) + " ₽")
          }
        }
      },
      scales: {
        x: { ticks: { font: { size: 10 }, color: "#5c645c", maxRotation: 40 }, grid: { display: false } },
        y: {
          ticks: { callback: v => money.format(v), font: { size: 11 }, color: "#5c645c" },
          grid: { color: "rgba(44,107,60,.08)" }
        }
      }
    }
  });
}

function svgLines(pack) {
  const w = 640, h = 280, pad = 36;
  const all = pack.points.flatMap(p => pack.names.map(n => p.hotels && p.hotels[n]).filter(v => v != null));
  if (!all.length) return "<p class='empty'>Нет чисел.</p>";
  const min = Math.min(...all), max = Math.max(...all);
  const span = Math.max(1, max - min);
  const x = i => pad + (i * (w - pad * 2)) / Math.max(1, pack.points.length - 1);
  const y = v => h - pad - ((v - min) / span) * (h - pad * 2);
  let svg = "<svg viewBox='0 0 " + w + " " + h + "' class='chart' role='img'>";
  svg += "<line x1='" + pad + "' y1='" + (h - pad) + "' x2='" + (w - 12) + "' y2='" + (h - pad) + "' stroke='#c9c3b4'/>";
  pack.names.forEach((name, ni) => {
    const d = pack.points.map((p, i) => {
      const v = p.hotels && p.hotels[name];
      return v == null ? null : x(i) + "," + y(v);
    }).filter(Boolean).join(" ");
    if (!d) return;
    svg += "<polyline fill='none' stroke='" + colors[ni % colors.length] + "' stroke-width='2.5' points='" + d + "'/>";
  });
  pack.points.forEach((p, i) => {
    const label = new Date(p.at).toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" });
    svg += "<text x='" + x(i) + "' y='" + (h - 12) + "' text-anchor='middle' font-size='11' fill='#5c645c'>" + label + "</text>";
  });
  svg += "</svg>";
  svg += "<div class='legend'>" + pack.names.map((n, i) => "<span><i style='background:" + colors[i % colors.length] + "'></i>" + esc(shortName(n)) + "</span>").join("") + "</div>";
  return svg;
}

function renderDynamics(history, currentHotels, query, meta) {
  const cap = document.getElementById("dyn-caption");
  const nights = (query && query.nights) || 8;
  let flight = "31.10.2026";
  if (query && query.date) {
    const m = String(query.date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) flight = m[3] + "." + m[2] + "." + m[1];
  }
  tourCaption = "AI · " + nights + " ночей · вылет " + flight;
  cap.textContent = "За тур · " + nights + " ночей · вылет " + flight;

  const pack = buildSeries(history, currentHotels, meta);
  dynPack = pack;
  const basis = document.getElementById("delta-basis");
  if (basis) {
    const y = pack.yesterdayPoint ? ("было вчера — " + pointLabel(pack.yesterdayPoint)) : "за вчера нет выпуска утро/вечер";
    const extra = pack.evening
      ? (pack.morningPoint ? " · было утром — " + pointLabel(pack.morningPoint) : " · утренней точки сегодня нет")
      : "";
    basis.textContent = "Сравнение с прошлыми сутками: " + y + extra + ". Не с этой же съёмкой. Только реальные точки history.json.";
  }
  renderDeltas(pack);
  renderBarCompare(pack);
  renderLineHistory(pack);
}

function switchTab(tab) {
  const btn = document.querySelector('#tabs button[data-tab="' + tab + '"]');
  if (!btn) return;
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("active", b === btn));
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id === "panel-" + tab));
}

const REVIEW_FRESH_DAYS = 60;
let reviewView = "fresh"; // fresh | archive

function archiveId(name) {
  return "archive-" + reviewId(name);
}

function parseReviewDate(when, refDate) {
  const s = String(when || "").trim();
  if (!s) return null;
  const low = s.toLowerCase();
  const ref = refDate || new Date();

  function fromParts(y, m, d) {
    const dt = new Date(y, m - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  function parseRefIn(str) {
    let m = String(str).match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (m) return fromParts(+m[3], +m[2], +m[1]);
    m = String(str).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return fromParts(+m[1], +m[2], +m[3]);
    return null;
  }
  const months = {
    январ: 1, феврал: 2, март: 3, апрел: 4, май: 5, мая: 5, июн: 6, июл: 7,
    август: 8, сент: 9, сентябр: 9, октябр: 10, ноябр: 11, декабр: 12,
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
    sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
    dec: 12, december: 12
  };
  function monthNum(tok) {
    const t = String(tok || "").toLowerCase();
    for (const k of Object.keys(months)) {
      if (t.startsWith(k)) return months[k];
    }
    return null;
  }

  let m = low.match(/около\s+(\d+)\s*мес\.?\s*до\s*(\d{2}\.\d{2}\.\d{4})/);
  if (m) {
    const base = parseRefIn(m[2]);
    if (base) {
      const d = new Date(base);
      d.setMonth(d.getMonth() - Number(m[1]));
      return d;
    }
  }
  m = low.match(/~?\s*(\d+)\s*нед/);
  if (m) {
    const base = parseRefIn(s) || new Date(ref);
    const d = new Date(base);
    d.setDate(d.getDate() - 7 * Number(m[1]));
    return d;
  }
  m = low.match(/(\d+)\s*недел/);
  if (m && low.includes("назад")) {
    const base = parseRefIn(s) || new Date(ref);
    const d = new Date(base);
    d.setDate(d.getDate() - 7 * Number(m[1]));
    return d;
  }
  if (low.includes("месяц") && low.includes("назад")) {
    const base = parseRefIn(s) || new Date(ref);
    const d = new Date(base);
    d.setMonth(d.getMonth() - 1);
    return d;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return fromParts(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return fromParts(+m[3], +m[2], +m[1]);
  m = s.match(/(\d{1,2})\.(\d{2})[.–-](\d{1,2})\.(\d{2})\.(\d{4})/);
  if (m) return fromParts(+m[5], +m[4], +m[3]);
  m = s.match(/(\d{1,2})[.–-](\d{1,2})\.(\d{2})\.(\d{4})/);
  if (m) return fromParts(+m[4], +m[3], +m[2]);
  m = s.match(/stay\s+([A-Za-z]+)\s+(\d{4})/i);
  if (m) {
    const mo = monthNum(m[1]);
    if (mo) return fromParts(+m[2], mo, 15);
  }
  m = s.match(/\b([A-Za-z]{3,9})\s+(\d{4})\b/);
  if (m) {
    const mo = monthNum(m[1]);
    if (mo) return fromParts(+m[2], mo, 15);
  }
  m = low.match(/(январ\w*|феврал\w*|март\w*|апрел\w*|ма[йя]|июн\w*|июл\w*|август\w*|сент\w*|октябр\w*|ноябр\w*|декабр\w*)\s*(\d{4})/);
  if (m) {
    const mo = monthNum(m[1]);
    if (mo) {
      const day = low.includes("конец") ? 25 : 15;
      return fromParts(+m[2], mo, day);
    }
  }
  if (low.includes("снимок")) {
    const base = parseRefIn(s);
    if (base) return base;
  }
  return parseRefIn(s);
}

function splitHotelReviews(h, refDate, freshDays) {
  const days = freshDays || REVIEW_FRESH_DAYS;
  const cutoff = new Date(refDate);
  cutoff.setDate(cutoff.getDate() - days);
  const hasArchiveField = Array.isArray(h.archive);
  if (hasArchiveField) {
    return {
      fresh: (h.reviews || []).slice(),
      archive: (h.archive || []).slice()
    };
  }
  const all = (h.reviews || []).slice();
  const fresh = [], archive = [];
  all.forEach(r => {
    const d = parseReviewDate(r.when, refDate);
    if (d && d >= cutoff) fresh.push({ d, r });
    else if (d) archive.push({ d, r });
    else {
      const w = String(r.when || "").toLowerCase();
      if (/сент|окт|август|\baug\b|\bsep\b|\boct\b|2026-0[89]|2026-10|\.0[89]\.2026|\.10\.2026/.test(w)) {
        fresh.push({ d: refDate, r });
      } else {
        archive.push({ d: new Date(0), r });
      }
    }
  });
  fresh.sort((a, b) => b.d - a.d);
  archive.sort((a, b) => b.d - a.d);
  return { fresh: fresh.map(x => x.r), archive: archive.map(x => x.r) };
}

function reviewBlocks(list) {
  if (!list.length) return "<p class='muted'>Пока нет отзывов в этой вкладке.</p>";
  return list.map(r =>
    "<blockquote><b>" + esc(r.score) + "</b> · " + esc(r.when) + "<p>" + esc(r.text) + "</p></blockquote>"
  ).join("");
}

function ratingHtml(h) {
  if (h.rating === "н/д" || h.rating == null) {
    return "<div class='rating'>н/д <span>· отзывы ниже</span></div>";
  }
  return "<div class='rating'>" + esc(h.rating) + " <span>/ 5 · " + money.format(h.count) + " отзывов</span></div>";
}

function setReviewView(view) {
  reviewView = view === "archive" ? "archive" : "fresh";
  const freshPane = document.getElementById("reviews-fresh");
  const archPane = document.getElementById("reviews-archive");
  if (freshPane) freshPane.hidden = reviewView !== "fresh";
  if (archPane) archPane.hidden = reviewView !== "archive";
  document.querySelectorAll("#review-tabs button").forEach(b => {
    b.classList.toggle("active", b.dataset.revtab === reviewView);
  });
}

function highlightEl(el) {
  if (!el) return;
  el.classList.add("highlight");
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  setTimeout(() => el.classList.remove("highlight"), 2200);
}

function goToReview(name) {
  switchTab("reviews");
  setReviewView("fresh");
  requestAnimationFrame(() => highlightEl(document.getElementById(reviewId(name))));
}

function goToArchiveReview(name) {
  switchTab("reviews");
  setReviewView("archive");
  requestAnimationFrame(() => highlightEl(document.getElementById(archiveId(name))));
}

function reviews(data) {
  const host = document.getElementById("reviews");
  if (!data || !data.hotels) {
    host.innerHTML = "<h2>Отзывы</h2><p class='empty'>Сводки отзывов ещё нет.</p>";
    return;
  }
  const refDate = data.updatedAt ? new Date(data.updatedAt) : new Date();
  const freshDays = data.freshDays || REVIEW_FRESH_DAYS;
  const byName = {};
  data.hotels.forEach(h => { if (h && CANON_SET.has(h.name)) byName[h.name] = h; });
  const hotels = CANON.map(name => byName[name]).filter(Boolean).map(h => {
    const split = splitHotelReviews(h, refDate, freshDays);
    return { h, fresh: split.fresh, archive: split.archive };
  });

  let freshCount = 0, archCount = 0;
  hotels.forEach(x => { freshCount += x.fresh.length; archCount += x.archive.length; });

  const freshHtml = hotels.map(({ h, fresh, archive }) => {
    const archLink = archive.length
      ? "<a href='#" + esc(archiveId(h.name)) + "' data-archive-hotel='" + esc(h.name) + "'>Архив (" + archive.length + ")</a>"
      : "<span class='muted'>Архив пуст</span>";
    return (
      "<article class='review' id='" + esc(reviewId(h.name)) + "' data-hotel='" + esc(h.name) + "'>" +
        "<h3>" + esc(h.name) + "</h3>" +
        ratingHtml(h) +
        reviewBlocks(fresh) +
        "<p class='meta'><a href='" + esc(h.url) + "' target='_blank' rel='noopener'>Карточка Google</a> · " + archLink + "</p>" +
      "</article>"
    );
  }).join("");

  const archHtml = hotels.map(({ h, archive }) => {
    if (!archive.length) return "";
    return (
      "<article class='review' id='" + esc(archiveId(h.name)) + "' data-hotel='" + esc(h.name) + "'>" +
        "<h3>" + esc(h.name) + "</h3>" +
        "<p class='muted'>Старше " + freshDays + " дней · " + archive.length + " шт.</p>" +
        reviewBlocks(archive) +
        "<p class='meta'><a href='#" + esc(reviewId(h.name)) + "' data-fresh-hotel='" + esc(h.name) + "'>К свежим</a> · <a href='" + esc(h.url) + "' target='_blank' rel='noopener'>Карточка Google</a></p>" +
      "</article>"
    );
  }).join("") || "<p class='empty'>Архив пока пуст.</p>";

  host.innerHTML =
    "<h2>Отзывы</h2>" +
    "<p class='muted'>" + esc(data.source || "") + "</p>" +
    "<p class='muted'>Свежие — за последние " + freshDays + " дней (новые сверху). Старше — во вкладке «Архив отзывов». Старые не удаляем.</p>" +
    "<div class='sort-tabs' id='review-tabs' role='group' aria-label='Отзывы'>" +
      "<button type='button' data-revtab='fresh' class='active'>Свежие (" + freshCount + ")</button>" +
      "<button type='button' data-revtab='archive'>Архив отзывов (" + archCount + ")</button>" +
    "</div>" +
    "<div id='reviews-fresh'>" + freshHtml + "</div>" +
    "<div id='reviews-archive' hidden>" + archHtml + "</div>";

  setReviewView("fresh");
}

function weather(data) {
  const host = document.getElementById("weather-full");
  const side = document.getElementById("wx");
  const rows = (data && data.weather) || [];
  if (!rows.length) return;
  const html = rows.map(w => "<div class='wx-item'><div class='kv'><span>" + esc(w.place) + "</span><b>" + esc(w.temp) + "</b></div><p class='muted'>" + esc(w.text) + "</p></div>").join("");
  side.innerHTML = "<h2>Погода коротко</h2>" + html;
  host.innerHTML = "<h2>Сейчас и на дату заезда</h2><p class='muted'>Сейчас — Open-Meteo на дату съёмки. Если 31 октября вне горизонта прогноза, это написано в карточке и не смешано с фактом.</p>" + html;
}

async function fetchDailyTemps(place, coords) {
  const url = "https://api.open-meteo.com/v1/forecast"
    + "?latitude=" + coords.lat
    + "&longitude=" + coords.lon
    + "&daily=temperature_2m_max,temperature_2m_min"
    + "&past_days=14&forecast_days=1"
    + "&timezone=Europe%2FMoscow";
  const res = await fetch(url);
  if (!res.ok) throw new Error("wx " + place);
  const data = await res.json();
  return {
    place,
    dates: (data.daily && data.daily.time) || [],
    max: (data.daily && data.daily.temperature_2m_max) || [],
    min: (data.daily && data.daily.temperature_2m_min) || []
  };
}

function renderWeatherChart(archiveRows, history) {
  const canvas = document.getElementById("wx-history");
  const note = document.getElementById("wx-chart-note");
  if (!canvas || typeof Chart === "undefined") return;

  const labels = (archiveRows[0] && archiveRows[0].dates) || [];
  if (!labels.length) {
    if (note) note.textContent = "Не удалось загрузить архив Open-Meteo.";
    return;
  }

  const labelRu = labels.map(d => {
    const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? (m[3] + "." + m[2]) : d;
  });

  const datasets = [];
  const palette = {
    "Анталия": { max: "#2c6b3c", min: "rgba(44,107,60,.45)", snap: "#8a5a2b" },
    "Кемер": { max: "#3d6f8a", min: "rgba(61,111,138,.45)", snap: "#6b4c7a" }
  };

  archiveRows.forEach(row => {
    const c = palette[row.place] || { max: "#2c6b3c", min: "rgba(44,107,60,.4)", snap: "#8a5a2b" };
    datasets.push({
      label: row.place + " макс",
      data: row.max,
      borderColor: c.max,
      backgroundColor: c.max,
      tension: 0.25,
      pointRadius: 3,
      borderWidth: 2
    });
    datasets.push({
      label: row.place + " мин",
      data: row.min,
      borderColor: c.min,
      backgroundColor: c.min,
      tension: 0.25,
      pointRadius: 3,
      borderWidth: 2,
      borderDash: [4, 3]
    });
  });

  // Overlay our release snapshots onto matching calendar days (avg of snapshot tempC).
  const snapPoints = ((history && history.points) || []).filter(p => p && p.at && p.places);
  Object.keys(WX_PLACES).forEach(place => {
    const c = palette[place] || { snap: "#8a5a2b" };
    const byDay = {};
    snapPoints.forEach(p => {
      const day = moscowYmd(p.at);
      const info = p.places[place];
      if (!day || !info || info.tempC == null) return;
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(Number(info.tempC));
    });
    const series = labels.map(d => {
      const arr = byDay[d];
      if (!arr || !arr.length) return null;
      return arr.reduce((a, b) => a + b, 0) / arr.length;
    });
    if (series.some(v => v != null)) {
      datasets.push({
        label: place + " снимок",
        data: series,
        borderColor: c.snap,
        backgroundColor: c.snap,
        showLine: false,
        pointRadius: 6,
        pointStyle: "triangle",
        borderWidth: 0
      });
    }
  });

  if (note) {
    const nSnap = snapPoints.length;
    note.textContent = "Макс/мин по дням — Open-Meteo past_days. Треугольники — наши снимки утро/вечер из weather-history.json"
      + (nSnap ? (" (" + nSnap + " " + (nSnap === 1 ? "точка" : "точек") + ").") : ".");
  }

  if (wxChart) wxChart.destroy();
  wxChart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: { labels: labelRu, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: ctx => (ctx.dataset.label || "") + ": " + (ctx.parsed.y == null ? "—" : ctx.parsed.y.toFixed(1) + " °C")
          }
        }
      },
      scales: {
        x: {
          ticks: { font: { size: 10 }, color: "#5c645c", maxRotation: 40 },
          grid: { display: false },
          title: { display: true, text: "Дата", color: "#5c645c", font: { size: 11 } }
        },
        y: {
          ticks: { callback: v => v + "°", font: { size: 11 }, color: "#5c645c" },
          grid: { color: "rgba(44,107,60,.08)" },
          title: { display: true, text: "°C", color: "#5c645c", font: { size: 11 } }
        }
      }
    }
  });
}

async function loadWeatherHistoryChart() {
  const note = document.getElementById("wx-chart-note");
  try {
    const history = await getJson("data/weather-history.json");
    const archiveRows = await Promise.all(
      Object.entries(WX_PLACES).map(([place, coords]) => fetchDailyTemps(place, coords))
    );
    renderWeatherChart(archiveRows, history);
  } catch (err) {
    if (note) note.textContent = "График погоды недоступен (сеть или API). Блок «сейчас» выше без изменений.";
  }
}

function byPriceAsc(a, b) {
  if (a.price == null) return 1;
  if (b.price == null) return -1;
  return a.price - b.price;
}

function sortedHotels(list, mode) {
  const rows = (list || []).slice();
  if (mode === "name") {
    rows.sort((a, b) => shortName(a.name).localeCompare(shortName(b.name), "ru", { sensitivity: "base" }));
    return rows;
  }
  if (mode === "top") {
    const inTop = [];
    const rest = [];
    const seen = new Set();
    MY_TOP.forEach(name => {
      const hit = rows.find(h => h.name === name);
      if (hit) {
        inTop.push(hit);
        seen.add(name);
      }
    });
    rows.forEach(h => {
      if (!seen.has(h.name)) rest.push(h);
    });
    rest.sort(byPriceAsc);
    return inTop.concat(rest);
  }
  rows.sort(byPriceAsc);
  return rows;
}

function sortTitle(mode) {
  if (mode === "name") return "Отели по имени";
  if (mode === "top") return "Мой топ";
  return "Отели по цене";
}

function renderHotelList() {
  const list = document.getElementById("list");
  if (!priceHotelsCache.length) return;
  const listHotels = sortedHotels(priceHotelsCache, priceSort);
  const title = sortTitle(priceSort);
  const head =
    "<div class='list-head'>" +
      "<h2>" + title + "</h2>" +
      "<div class='sort-tabs' id='sort-tabs' role='group' aria-label='Сортировка'>" +
        "<button type='button' data-sort='top'" + (priceSort === "top" ? " class='active'" : "") + ">Мой топ</button>" +
        "<button type='button' data-sort='price'" + (priceSort === "price" ? " class='active'" : "") + ">По цене</button>" +
        "<button type='button' data-sort='name'" + (priceSort === "name" ? " class='active'" : "") + ">По имени</button>" +
      "</div>" +
    "</div>";

  list.innerHTML = head + listHotels.map((h, i) => {
    const offers = (h.offers || []).slice(0, 4).map(o => "<div class='kv'><span>" + esc(o.room) + "</span><b>" + rub(o.price) + "</b></div>").join("");
    const reason = h.price == null && h.reason ? "<p class='muted'>" + esc(h.reason) + "</p>" : "";
    const topRank = MY_TOP_RANK.get(h.name);
    const rankHtml = topRank
      ? "<div class='rank'><span class='top-badge' title='Мой топ #" + topRank + "'>" + topRank + "</span></div>"
      : "<div class='rank'>" + (i + 1) + "</div>";
    const series = (dynPack && dynPack.byHotel && dynPack.byHotel[h.name])
      ? dynPack.byHotel[h.name].series
      : [];
    const color = colors[Math.max(0, CANON.indexOf(h.name)) % colors.length];
    const spark = sparkline(series, color);
    return (
      "<article class='hotel" + (topRank ? " hotel-top" : "") + "' tabindex='0' role='link' data-hotel='" + esc(h.name) + "' aria-label='Отзывы: " + esc(shortName(h.name)) + "'>" +
        "<div>" +
          rankHtml +
          "<h3 class='hotel-link'>" + esc(h.name) + "</h3>" +
          "<div class='tags'>" +
            (h.room ? "<span class='tag'>" + esc(h.room) + "</span>" : "") +
            (h.meal ? "<span class='tag'>" + esc(h.meal) + "</span>" : "") +
            (h.resort ? "<span class='tag'>" + esc(h.resort) + "</span>" : "") +
          "</div>" + reason + offers +
        "</div>" +
        "<div class='price-side'>" + spark + "<div class='price'>" + rub(h.price) + "</div></div>" +
      "</article>"
    );
  }).join("");
}

function hotels(data) {
  const updated = document.getElementById("updated");
  const when = new Date(data.updatedAt);
  const slotMap = { vecher: "вечер", screenshot: "скрин Библио-Глобус", utro: "утро", check: "проверка списка" };
  const slot = slotMap[data.slot] || "выпуск";
  updated.textContent = "Снято " + when.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) + " · " + slot + ". Цена за двоих, пакет с перелётом.";
  const fx = document.getElementById("fx");
  if (data.usd) {
    fx.innerHTML = "<h2>Курс</h2><div class='kv'><span>USD ЦБ</span><b>" + data.usd.value + " ₽</b></div><p class='meta'>" + esc(data.usd.date || "") + "</p>" + (data.usd.note ? "<p class='muted'>" + esc(data.usd.note) + "</p>" : "");
  }
  weather(data);
  priceHotelsCache = (data.hotels || []).filter(h => h && CANON_SET.has(h.name));
  if (!priceHotelsCache.length) return [];
  renderHotelList();
  return priceHotelsCache;
}

document.getElementById("tabs").addEventListener("click", ev => {
  const btn = ev.target.closest("button");
  if (!btn) return;
  switchTab(btn.dataset.tab);
});

document.getElementById("list").addEventListener("click", ev => {
  const sortBtn = ev.target.closest("#sort-tabs button");
  if (sortBtn) {
    const mode = sortBtn.dataset.sort;
    if (mode && mode !== priceSort) {
      priceSort = mode;
      renderHotelList();
    }
    return;
  }
  const card = ev.target.closest(".hotel");
  if (!card) return;
  if (ev.target.closest("a")) return;
  goToReview(card.dataset.hotel);
});

document.getElementById("list").addEventListener("keydown", ev => {
  if (ev.key !== "Enter" && ev.key !== " ") return;
  const card = ev.target.closest(".hotel");
  if (!card) return;
  ev.preventDefault();
  goToReview(card.dataset.hotel);
});

document.getElementById("reviews").addEventListener("click", ev => {
  const tabBtn = ev.target.closest("#review-tabs button");
  if (tabBtn) {
    setReviewView(tabBtn.dataset.revtab);
    return;
  }
  const archLink = ev.target.closest("[data-archive-hotel]");
  if (archLink) {
    ev.preventDefault();
    goToArchiveReview(archLink.dataset.archiveHotel);
    return;
  }
  const freshLink = ev.target.closest("[data-fresh-hotel]");
  if (freshLink) {
    ev.preventDefault();
    goToReview(freshLink.dataset.freshHotel);
  }
});

document.getElementById("deltas").addEventListener("click", ev => {
  const card = ev.target.closest(".delta-card");
  if (!card) return;
  openHotelModal(card.dataset.hotel);
});

document.getElementById("deltas").addEventListener("keydown", ev => {
  if (ev.key !== "Enter" && ev.key !== " ") return;
  const card = ev.target.closest(".delta-card");
  if (!card) return;
  ev.preventDefault();
  openHotelModal(card.dataset.hotel);
});

document.getElementById("hotel-modal").addEventListener("click", ev => {
  if (ev.target.closest("[data-close]")) closeHotelModal();
});

document.addEventListener("keydown", ev => {
  if (ev.key === "Escape") closeHotelModal();
});

function boot() {
  Promise.all([
    getJson("data/prices.json"),
    getJson("data/history.json"),
    getJson("data/reviews.json")
  ]).then(([data, history, rev]) => {
    if (!data || !data.updatedAt) return;
    const list = hotels(data) || [];
    renderDynamics(history, list, data.query, { updatedAt: data.updatedAt, slot: data.slot });
    renderHotelList(); // спарклайны после dynPack
    reviews(rev);
    loadWeatherHistoryChart();
  }).catch(() => {});
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    if (typeof Chart !== "undefined") boot();
    else setTimeout(boot, 50);
  });
} else {
  if (typeof Chart !== "undefined") boot();
  else setTimeout(boot, 50);
}
