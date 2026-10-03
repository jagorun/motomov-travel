const money = new Intl.NumberFormat("ru-RU");
const colors = ["#2c6b3c", "#8a5a2b", "#3d6f8a", "#6b4c7a", "#8a3d3d", "#4f6b3c", "#8a6a2b", "#2b6b6b"];

let barChart = null;
let lineChart = null;

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

/** Build per-hotel series from history points + current prices. */
function buildSeries(history, currentHotels) {
  const points = ((history && history.points) || []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const currentMap = {};
  (currentHotels || []).forEach(h => {
    if (h && h.name && h.price != null) currentMap[h.name] = h.price;
  });

  const names = [];
  points.forEach(p => Object.keys(p.hotels || {}).forEach(n => { if (!names.includes(n)) names.push(n); }));
  Object.keys(currentMap).forEach(n => { if (!names.includes(n)) names.push(n); });

  // Charts follow the current prices list. Old history keys for removed hotels stay in history.json.
  const allowed = {};
  (currentHotels || []).forEach(h => { if (h && h.name) allowed[h.name] = true; });
  if (Object.keys(allowed).length) {
    for (let i = names.length - 1; i >= 0; i--) {
      if (!allowed[names[i]]) names.splice(i, 1);
    }
  }

  // Series aligned to history snapshots only (no fake points).
  const labels = points.map(p => {
    const d = new Date(p.at);
    const t = d.toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" });
    const day = d.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit" });
    return day + " " + t + (p.slot ? " · " + p.slot : "");
  });

  const byHotel = {};
  names.forEach(name => {
    const series = points.map(p => (p.hotels && p.hotels[name] != null) ? p.hotels[name] : null);
    const cur = currentMap[name] != null ? currentMap[name] : (series.filter(v => v != null).slice(-1)[0] ?? null);
    // Previous = last non-null in history that is not the same as the final history value if current differs,
    // else the second-to-last non-null in the series.
    const nonNull = [];
    series.forEach((v, i) => { if (v != null) nonNull.push({ i, v }); });
    let prev = null;
    if (nonNull.length >= 2) {
      // If last history equals current, take second-to-last; else last history is "previous" vs current.
      const last = nonNull[nonNull.length - 1];
      if (cur != null && last.v !== cur) prev = last.v;
      else prev = nonNull[nonNull.length - 2].v;
    } else if (nonNull.length === 1 && cur != null && nonNull[0].v !== cur) {
      prev = nonNull[0].v;
    }
    byHotel[name] = { series, cur, prev, delta: signedDelta(cur, prev) };
  });

  return { points, labels, names, byHotel, currentMap };
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

  host.innerHTML = rows.map((r, i) => {
    const color = colors[i % colors.length];
    return (
      "<article class='delta-card'>" +
        "<div class='delta-top'>" +
          "<h3>" + esc(shortName(r.name)) + "</h3>" +
          sparkline(r.series, color) +
        "</div>" +
        "<div class='delta-price'>" + rub(r.cur) + "</div>" +
        "<div class='delta-meta'>" +
          "<span>было: " + (r.prev != null ? rub(r.prev) : "—") + "</span>" +
          deltaHtml(r.delta) +
        "</div>" +
      "</article>"
    );
  }).join("");
}

function renderBarCompare(pack) {
  const canvas = document.getElementById("bar-compare");
  const note = document.getElementById("chart-note");
  const rows = pack.names
    .map(name => ({ name, ...pack.byHotel[name] }))
    .filter(r => r.cur != null)
    .sort((a, b) => a.cur - b.cur);

  if (!rows.length || typeof Chart === "undefined") {
    // Fallback: simple HTML bars if Chart.js not loaded
    const host = document.getElementById("lines");
    if (!rows.length) {
      canvas.parentElement.innerHTML = "<p class='empty'>Нет данных для столбцов.</p>";
      return;
    }
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
          label: "Прошлый снимок",
          data: rows.map(r => r.prev),
          backgroundColor: "rgba(138,90,43,.45)",
          borderRadius: 6
        }
      ]
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
    // Lightweight SVG fallback (same as before, but by points not by days)
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
  const all = pack.points.flatMap(p => Object.values(p.hotels || {}));
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

function renderDynamics(history, currentHotels, query) {
  const cap = document.getElementById("dyn-caption");
  const nights = (query && query.nights) || 8;
  let flight = "31.10.2026";
  if (query && query.date) {
    const m = String(query.date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) flight = m[3] + "." + m[2] + "." + m[1];
  }
  cap.textContent = "За тур · " + nights + " ночей · вылет " + flight;

  const pack = buildSeries(history, currentHotels);
  renderDeltas(pack);
  renderBarCompare(pack);
  renderLineHistory(pack);
}

function reviews(data, allowedNames) {
  const host = document.getElementById("reviews");
  if (!data || !data.hotels) {
    host.innerHTML = "<h2>Отзывы</h2><p class='empty'>Сводки отзывов ещё нет.</p>";
    return;
  }
  const allow = allowedNames && allowedNames.length ? new Set(allowedNames) : null;
  const hotels = allow ? data.hotels.filter(h => allow.has(h.name)) : data.hotels;
  host.innerHTML = "<h2>Отзывы</h2><p class='muted'>" + esc(data.source || "") + "</p>" + hotels.map(h => {
    const bits = (h.reviews || []).map(r => "<blockquote><b>" + esc(r.score) + "</b> · " + esc(r.when) + "<p>" + esc(r.text) + "</p></blockquote>").join("");
    const rating = h.rating === "н/д" || h.rating == null
      ? "<div class='rating'>н/д <span>· отзывы ниже</span></div>"
      : "<div class='rating'>" + esc(h.rating) + " <span>/ 5 · " + money.format(h.count) + " отзывов</span></div>";
    return "<article class='review'><h3>" + esc(h.name) + "</h3>" + rating + bits + "<p class='meta'><a href='" + esc(h.url) + "'>Карточка Google</a></p></article>";
  }).join("");
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
  const listHotels = (data.hotels || []).slice().sort((a, b) => {
    if (a.price == null) return 1;
    if (b.price == null) return -1;
    return a.price - b.price;
  });
  const list = document.getElementById("list");
  if (!listHotels.length) return;
  list.innerHTML = "<h2>Отели по цене</h2>" + listHotels.map((h, i) => {
    const offers = (h.offers || []).slice(0, 4).map(o => "<div class='kv'><span>" + esc(o.room) + "</span><b>" + rub(o.price) + "</b></div>").join("");
    const reason = h.price == null && h.reason ? "<p class='muted'>" + esc(h.reason) + "</p>" : "";
    return "<article class='hotel'><div><div class='rank'>" + (i + 1) + "</div><h3>" + esc(h.name) + "</h3><div class='tags'>" +
      (h.room ? "<span class='tag'>" + esc(h.room) + "</span>" : "") +
      (h.meal ? "<span class='tag'>" + esc(h.meal) + "</span>" : "") +
      (h.resort ? "<span class='tag'>" + esc(h.resort) + "</span>" : "") +
      "</div>" + reason + offers + "</div><div class='price'>" + rub(h.price) + "</div></article>";
  }).join("");
  return listHotels;
}

document.getElementById("tabs").addEventListener("click", ev => {
  const btn = ev.target.closest("button");
  if (!btn) return;
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("active", b === btn));
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id === "panel-" + btn.dataset.tab));
});

function boot() {
  Promise.all([getJson("data/prices.json"), getJson("data/history.json"), getJson("data/reviews.json")]).then(([data, history, rev]) => {
    if (!data || !data.updatedAt) return;
    const list = hotels(data) || [];
    renderDynamics(history, list, data.query);
    reviews(rev, (data.hotels || []).map(h => h.name));
  }).catch(() => {});
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    // Chart.js is defer — wait a tick if needed
    if (typeof Chart !== "undefined") boot();
    else setTimeout(boot, 50);
  });
} else {
  if (typeof Chart !== "undefined") boot();
  else setTimeout(boot, 50);
}
