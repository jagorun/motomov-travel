const money = new Intl.NumberFormat("ru-RU");
const colors = ["#2c6b3c", "#8a5a2b", "#3d6f8a", "#6b4c7a", "#8a3d3d", "#4f6b3c", "#8a6a2b"];

function rub(n) {
  if (n == null || Number.isNaN(Number(n))) return "нет цены";
  return money.format(n) + " ₽";
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

function bars(hotels) {
  const host = document.getElementById("bars");
  const rows = hotels.filter(h => h.price != null);
  if (!rows.length) {
    host.innerHTML = "<p class='empty'>Цен для диаграммы нет.</p>";
    return;
  }
  const max = Math.max(...rows.map(h => h.price));
  host.innerHTML = rows.map((h, i) => {
    const pct = Math.round(h.price / max * 100);
    return "<div class='bar-row'><div class='bar-label'><span>" + esc(h.name.replace(" 5*", "")) + "</span><b>" + rub(h.price) + "</b></div><div class='bar-track'><div class='bar-fill' style='width:" + pct + "%;background:" + colors[i % colors.length] + "'></div></div></div>";
  }).join("");
}

function lines(history) {
  const host = document.getElementById("lines");
  const note = document.getElementById("chart-note");
  const points = (history && history.points) || [];
  const names = [];
  points.forEach(p => Object.keys(p.hotels || {}).forEach(n => { if (!names.includes(n)) names.push(n); }));
  const days = [...new Set(points.map(p => String(p.at).slice(0, 10)))];
  if (days.length < 2) {
    note.textContent = "История с 1 октября 2026. Съёмка одна, поэтому линия по дням ещё не из чего строить. Ниже — сами цифры первого дня. Утро и вечер будут дописывать точки.";
    host.innerHTML = points.map(p => {
      const when = new Date(p.at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
      const items = Object.entries(p.hotels || {}).map(([n, v]) => "<div class='kv'><span>" + esc(n.replace(" 5*", "")) + "</span><b>" + rub(v) + "</b></div>").join("");
      return "<p class='meta'>" + esc(when) + " · " + esc(p.slot) + "</p>" + items;
    }).join("");
    return;
  }
  note.textContent = "Минимальная цена по дням съёмки. Ось в рублях за двоих.";
  const w = 640, h = 280, pad = 36;
  const all = points.flatMap(p => Object.values(p.hotels || {}));
  const min = Math.min(...all), max = Math.max(...all);
  const span = Math.max(1, max - min);
  const x = i => pad + (i * (w - pad * 2)) / Math.max(1, points.length - 1);
  const y = v => h - pad - ((v - min) / span) * (h - pad * 2);
  let svg = "<svg viewBox='0 0 " + w + " " + h + "' class='chart' role='img'>";
  svg += "<line x1='" + pad + "' y1='" + (h - pad) + "' x2='" + (w - 12) + "' y2='" + (h - pad) + "' stroke='#c9c3b4'/>";
  names.forEach((name, ni) => {
    const d = points.map((p, i) => {
      const v = p.hotels && p.hotels[name];
      return v == null ? null : x(i) + "," + y(v);
    }).filter(Boolean).join(" ");
    if (!d) return;
    svg += "<polyline fill='none' stroke='" + colors[ni % colors.length] + "' stroke-width='2.5' points='" + d + "'/>";
  });
  points.forEach((p, i) => {
    const label = new Date(p.at).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
    svg += "<text x='" + x(i) + "' y='" + (h - 12) + "' text-anchor='middle' font-size='12' fill='#5c645c'>" + label + "</text>";
  });
  svg += "</svg>";
  svg += "<div class='legend'>" + names.map((n, i) => "<span><i style='background:" + colors[i % colors.length] + "'></i>" + esc(n.replace(" 5*", "")) + "</span>").join("") + "</div>";
  host.innerHTML = svg;
}

function reviews(data) {
  const host = document.getElementById("reviews");
  if (!data || !data.hotels) {
    host.innerHTML = "<h2>Отзывы Google</h2><p class='empty'>Сводки отзывов ещё нет.</p>";
    return;
  }
  host.innerHTML = "<h2>Отзывы Google</h2><p class='muted'>" + esc(data.source || "") + "</p>" + data.hotels.map(h => {
    const bits = (h.reviews || []).map(r => "<blockquote><b>" + esc(r.score) + "</b> · " + esc(r.when) + "<p>" + esc(r.text) + "</p></blockquote>").join("");
    return "<article class='review'><h3>" + esc(h.name) + "</h3><div class='rating'>" + esc(h.rating) + " <span>/ 5 · " + money.format(h.count) + " отзывов</span></div>" + bits + "<p class='meta'><a href='" + esc(h.url) + "'>Карточка Google</a></p></article>";
  }).join("");
}

function weather(data) {
  const host = document.getElementById("weather-full");
  const side = document.getElementById("wx");
  const rows = (data && data.weather) || [];
  if (!rows.length) return;
  const html = rows.map(w => "<div class='wx-item'><div class='kv'><span>" + esc(w.place) + "</span><b>" + esc(w.temp) + "</b></div><p class='muted'>" + esc(w.text) + "</p></div>").join("");
  side.innerHTML = "<h2>Погода коротко</h2>" + html;
  host.innerHTML = "<h2>Сейчас и на дату заезда</h2><p class='muted'>Сейчас — Open-Meteo на 1 октября. На 31 октября оперативный прогноз ещё не вышел: это оценка, не обещание.</p>" + html;
}

function hotels(data) {
  const updated = document.getElementById("updated");
  const when = new Date(data.updatedAt);
  const slot = data.slot === "vecher" ? "вечер" : (data.slot === "screenshot" ? "скрин Библио-Глобус" : "утро");
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

Promise.all([getJson("data/prices.json"), getJson("data/history.json"), getJson("data/reviews.json")]).then(([data, history, rev]) => {
  if (!data || !data.updatedAt) return;
  const list = hotels(data) || [];
  bars(list);
  lines(history);
  reviews(rev);
}).catch(() => {});
