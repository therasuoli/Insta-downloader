"use strict";

const form = document.getElementById("form");
const input = document.getElementById("url");
const pasteBtn = document.getElementById("paste");
const submitBtn = document.getElementById("submit");
const errorEl = document.getElementById("error");
const loadingEl = document.getElementById("loading");
const resultsEl = document.getElementById("results");

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = !msg;
}

pasteBtn.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) input.value = text.trim();
    input.focus();
  } catch {
    showError("Clipboard access was blocked — paste the link manually.");
  }
});

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of [].concat(children)) {
    node.append(c instanceof Node ? c : document.createTextNode(c));
  }
  return node;
}

function renderItem(item, index) {
  const card = el("article", { className: "item" });

  if (item.thumbnail) {
    card.append(
      el("img", {
        className: "thumb",
        src: item.thumbnail,
        alt: item.title || "Post preview",
        loading: "lazy",
        referrerPolicy: "no-referrer",
      })
    );
  }

  const meta = el("div", { className: "meta" });
  if (item.uploader) meta.append(el("div", { className: "who" }, "@" + item.uploader));
  if (item.title) meta.append(el("div", { className: "title" }, item.title));
  card.append(meta);

  const actions = el("div", { className: "actions" });
  item.options.forEach((opt, i) => {
    const params = new URLSearchParams({
      url: opt.url,
      ext: opt.ext,
      name: `instagram_${item.id || index + 1}_${opt.label}`,
    });
    const label = item.type === "video" ? `Download ${opt.label}` : "Download photo";
    actions.append(
      el("a", { className: "btn" + (i ? " alt" : ""), href: `/api/download?${params}` }, label)
    );
  });
  card.append(actions);
  return card;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("");
  resultsEl.replaceChildren();
  submitBtn.disabled = true;
  loadingEl.hidden = false;

  try {
    const res = await fetch("/api/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: input.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    data.items.forEach((item, i) => resultsEl.append(renderItem(item, i)));
  } catch (err) {
    showError(err.message);
  } finally {
    submitBtn.disabled = false;
    loadingEl.hidden = true;
  }
});
