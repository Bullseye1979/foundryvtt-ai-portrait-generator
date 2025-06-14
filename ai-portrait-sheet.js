console.log("[AI Portrait Generator] Loaded");

Hooks.once("init", () => {
  game.settings.register("ai-portrait-generator", "apiKey", {
    name: "OpenAI API Key",
    hint: "API key for GPT and DALL·E.",
    scope: "world", config: true, type: String,
    default: "", restricted: true
  });

  game.settings.register("ai-portrait-generator", "gptPrompt", {
    name: "GPT Prompt Template",
    hint: "System prompt for GPT – describes character appearance.",
    scope: "world", config: true, type: String, multiline: true,
    default: `You are writing a prompt for DALL·E to generate a full-body fantasy character illustration with no background.
Focus on realistic, visually rich descriptions based solely on the character’s physical appearance, mood, and attire.
Do not include RPG terms, statistics, class names, or abstract personality traits.
Ensure that the character’s head and shoulders appear in the upper part of the image.`
  });

  game.settings.register("ai-portrait-generator", "proxyUrl", {
    name: "Proxy Base URL",
    hint: "Base URL of your CORS proxy endpoint (no ?args).",
    scope: "world", config: true, type: String,
    default: "https://corsproxy.ralfreschke.de"
  });
});

Hooks.on("renderActorSheet", (app, html, data) => {
  const actor = app.actor;
  if (!actor || !actor.testUserPermission(game.user, "OWNER")) return;
  const btn = $(`<a class="ai-portrait-generator"><i class="fas fa-magic"></i> Generate AI Portrait</a>`);
  btn.click(() => generatePortrait(actor));
  html.closest('.app').find('.window-title').after(btn);
});

async function generatePortrait(actor) {
  const apiKey = game.settings.get("ai-portrait-generator", "apiKey");
  const gptPrompt = game.settings.get("ai-portrait-generator", "gptPrompt");
  const proxyBase = game.settings.get("ai-portrait-generator", "proxyUrl")?.trim().replace(/\/+$/, "");
  if (!apiKey) return ui.notifications.warn("Please set the OpenAI API key.");

  const { name, system, items } = actor;
  const basePrompt = `Name: ${name}
Race: ${items.find(i => i.type === "race")?.name ?? "Humanoid"}
Gender: ${system.details?.gender ?? "Unknown"}
Age: ${system.details?.age ?? "Unknown"}
Height: ${system.details?.height ?? "Unknown"}
Weight: ${system.details?.weight ?? "Unknown"}
Eye Color: ${system.details?.eyes ?? "Unknown"}
Hair: ${system.details?.hair ?? "Unknown"}
Skin: ${system.details?.skin ?? "Unknown"}
Appearance: ${system.details?.appearance ?? ""}
Equipment: ${items.filter(i => ["weapon", "equipment", "armor"].includes(i.type)).map(i => i.name).slice(0, 5).join(", ") || "None"}
Biography: ${(system.details?.biography?.value ?? "").replace(/<[^>]*>?/gm, "")}`;

  ui.notifications.info("Contacting GPT...");

  let finalPrompt = basePrompt;
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: gptPrompt },
          { role: "user", content: basePrompt }
        ],
        temperature: 0.7, max_tokens: 400
      })
    });
    const d = await resp.json();
    finalPrompt = d.choices?.[0]?.message?.content ?? basePrompt;
  } catch (e) {
    console.warn("GPT failed:", e);
    ui.notifications.warn("GPT failed – using fallback prompt.");
  }

  new Dialog({
    title: "AI Portrait Description",
    content: `<form><textarea id="prompt-text" rows="10" style="width:100%;">${finalPrompt}</textarea></form>`,
    buttons: {
      generate: {
        label: "Generate",
        callback: async html => {
          const prompt = html.find("#prompt-text").val()?.trim();
          if (!prompt) return;

          ui.notifications.info("Requesting image from DALL·E...");

          try {
            const dalle = await fetch("https://api.openai.com/v1/images/generations", {
              method: "POST", headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                prompt,
                model: "dall-e-3",
                n: 1, size: "1024x1792", response_format: "url"
              })
            });
            const dd = await dalle.json();
            const imageUrl = dd.data?.[0]?.url;
            if (!imageUrl) throw new Error("No image URL.");

            const safeName = actor.name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
            const baseFilename = `ai-${safeName}.webp`;
            const proxyUrl = `${proxyBase}/?b64=${encodeURIComponent(btoa(imageUrl))}&name=${baseFilename}`;
            const blob = await (await fetch(proxyUrl)).blob();
            const file = new File([blob], baseFilename, { type: blob.type });
            const upload = await FilePicker.upload("data", "user/portraits", file, { overwrite: true });
            const fullPath = upload.path;

            const portraitPath = `${fullPath}.portrait.webp`;
            const portraitCanvas = await createCroppedPortrait(blob);
            const portraitUpload = await FilePicker.upload("data", "user/portraits", new File([portraitCanvas], `portrait-${safeName}.webp`), { overwrite: true });

            await actor.update({
              img: `${portraitUpload.path}?cb=${Date.now()}`,
              "prototypeToken.texture.src": `${fullPath}?cb=${Date.now()}`
            });

            actor.sheet.render(true);
            ui.notifications.info("Portrait and Token updated.");
          } catch (e) {
            console.error("Image generation failed:", e);
            ui.notifications.error("Image generation failed.");
          }
        }
      },
      cancel: { label: "Cancel" }
    },
    default: "generate"
  }).render(true);
}

async function createCroppedPortrait(blob) {
  const bitmap = await createImageBitmap(blob);
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, size, size, 0, 0, size, size);
  return await new Promise(res => canvas.toBlob(res, "image/webp"));
}
