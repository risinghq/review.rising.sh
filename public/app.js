const main = document.getElementById("main");
const who = document.getElementById("who");

const el = (tag, props = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
};

async function call(path, options) {
  const response = await fetch(path, options);
  return { ok: response.ok, body: await response.json().catch(() => ({})) };
}

// Word-level difference of the two machine readings, so a reviewer reads only what differs.
function wordDiff(a, b) {
  const x = a.split(/(\s+)/), y = b.split(/(\s+)/);
  const t = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      t[i][j] = x[i] === y[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const left = el("div"), right = el("div");
  let i = 0, j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      left.append(x[i]); right.append(y[j]); i++; j++;
    } else if (j >= y.length || (i < x.length && t[i + 1][j] >= t[i][j + 1])) {
      left.append(el("del", {}, x[i++]));
    } else {
      right.append(el("ins", {}, y[j++]));
    }
  }
  return [left, right];
}

function render(text, target) {
  target.replaceChildren();
  for (const part of text.split(/(\$\$[\s\S]+?\$\$|\$[^$]+\$)/)) {
    if (part.startsWith("$") && part.length > 2 && window.katex) {
      const span = el("span");
      try {
        window.katex.render(part.replace(/^\$\$?|\$\$?$/g, ""), span, {
          displayMode: part.startsWith("$$"),
          throwOnError: true,
        });
      } catch {
        span.textContent = part;
        span.title = "LaTeX no válido";
      }
      target.append(span);
    } else target.append(part);
  }
}

async function load() {
  const user = (await call("/api/me")).body.user;
  who.replaceChildren(user ? el("span", {}, user.name, " ",
    el("button", { onclick: async () => { await fetch("/auth/logout", { method: "POST" }); location.reload(); } }, "Salir")) : "");
  if (!user) return showSignIn();
  const chunk = (await call("/api/next")).body.chunk;
  chunk ? showChunk(chunk) : main.replaceChildren(el("p", {}, "No hay más fragmentos por revisar. Gracias."));
}

function showSignIn() {
  main.replaceChildren(
    el("p", {}, "Compara el escaneo de unos apuntes manuscritos con su transcripción automática y corrige lo que esté mal. No necesitas saber de git."),
    el("p", {}, el("a", { className: "btn", href: "/auth/google" }, "Entrar con Google"), " ",
      el("a", { className: "btn", href: "/auth/github" }, "Entrar con GitHub")),
  );
}

const WHY = { disputed: "las dos lecturas difieren", blurry: "escaneo borroso", machine: "muestra de control" };

function showChunk(chunk) {
  const editor = el("textarea", { value: chunk.text, spellcheck: false });
  const preview = el("div", { className: "preview" });
  const message = el("p", { className: "note" });
  const choices = el("div", { className: "choices" });
  let choice = "a";
  const draw = () => render(editor.value, preview);
  const pick = (which, text) => { editor.value = text; draw(); choice = which; };
  editor.oninput = () => { choice = "edit"; draw(); };

  let diff = "";
  if (chunk.alt) {
    const [left, right] = wordDiff(chunk.text, chunk.alt);
    diff = el("div", { className: "pair" },
      el("div", {}, el("b", {}, "Lectura A"), left), el("div", {}, el("b", {}, "Lectura B"), right));
    choices.append(el("button", { onclick: () => pick("a", chunk.text) }, "Usar A"),
      el("button", { onclick: () => pick("b", chunk.alt) }, "Usar B"));
  }
  const send = el("button", { className: "primary", onclick: async () => {
    send.disabled = true;
    const result = await call("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunk: chunk.id, text: editor.value, choice }),
    });
    if (result.ok) return load();
    message.textContent = result.body.error ?? "No se pudo guardar.";
    send.disabled = false;
  } }, "Enviar y seguir");

  main.replaceChildren(
    el("p", { className: "note" }, `Página ${chunk.page} · ${WHY[chunk.status]}`),
    el("div", { className: "pair" },
      el("div", { className: "scan" }, el("img", { src: `/scan/${chunk.id}`, alt: "Escaneo del fragmento" })),
      el("div", {}, editor, el("p", { className: "note" }, "Vista previa"), preview, choices, send, " ",
        el("button", { onclick: load }, "Otro"), message)),
    diff,
  );
  draw();
}

load();
