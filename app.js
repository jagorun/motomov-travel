const money = new Intl.NumberFormat("ru-RU");

function rub(n) {
  if (n == null || Number.isNaN(Number(n))) return "нет цены";
  return money.format(n) + " ₽";
}

async function load() {
  const res = await fetch("data/prices.json?ts=" + Date.now());
  const data = await res.json();
  const updated = document.getElementById("updated");
  if (!data.updatedAt) return;

  const when = new Date(data.updatedAt);
  const slot = data.slot === "vecher" ? "вечер" : "утро";
  updated.textContent = "Снято " + when.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) + " · " + slot + ". Цена за двоих, пакет с перелётом.";

  const fx = document.getElementById("fx");
  if (data.usd) {
    fx.innerHTML = "<h2>Курс</h2><div class=\"kv\"><span>USD ЦБ</span><b>" + data.usd.value + " ₽</b></div><p class=\"meta\">" + (data.usd.date || "") + "</p>";
  }

  const wx = document.getElementById("wx");
  if (Array.isArray(data.weather) && data.weather.length) {
    wx.innerHTML = "<h2>Погода</h2>" + data.weather.map(w =>
      "<div class=\"kv\"><span>" + w.place + "</span><b>" + w.temp + "</b></div><p class=\"muted\">" + (w.text || "") + "</p>"
    ).join("");
  }

  const hotels = (data.hotels || []).slice().sort((a, b) => {
    if (a.price == null) return 1;
    if (b.price == null) return -1;
    return a.price - b.price;
  });
  const list = document.getElementById("list");
  const empty = document.getElementById("empty");
  if (!hotels.length) return;
  if (empty) empty.remove();
  list.innerHTML = "<h2>Отели по цене</h2>" + hotels.map((h, i) => {
    const news = (h.news || []).slice(0, 2).map(n =>
      "<div class=\"news\">" + (n.url ? "<a href=\"" + n.url + "\">" + n.title + "</a>" : n.title) + "</div>"
    ).join("");
    return "<article class=\"hotel\"><div><div class=\"rank\">" + (i + 1) + "</div><h3>" + h.name + "</h3><div class=\"tags\">" +
      (h.room ? "<span class=\"tag\">" + h.room + "</span>" : "") +
      (h.meal ? "<span class=\"tag\">" + h.meal + "</span>" : "") +
      (h.resort ? "<span class=\"tag\">" + h.resort + "</span>" : "") +
      "</div>" + news + "</div><div class=\"price\">" + rub(h.price) + "</div></article>";
  }).join("");
}

load().catch(() => {});
