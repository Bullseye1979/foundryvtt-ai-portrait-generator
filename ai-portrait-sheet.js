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
    hint: "System prompt for GPT – generates visual prompt for DALL·E.",
    scope: "world", config: true, type: String, multiline: true,
    default: `You are writing a prompt for DALL·E to generate a single vertical fantasy character image (1024×1792).
Focus on realistic and vivid physical features, clothing, expression, and style.
Do not mention RPG statistics or metadata.
Ensure the character's face and upper body appear in the upper half of the image to allow portrait cropping later.
Do not include background descriptions. The character should stand out clearly.`
  });

  game.settings.register("ai-portrait-generator", "proxyUrl", {
    name: "Proxy Base URL",
    hint: "Base URL of your CORS proxy endpoint (no ?args).",
    scope: "world", config: true, type: String,
    default: "https://corsproxy.ralfreschke.de"
  });
});

Hooks.on("renderActorSheet", (app, html, data) => {
  const actor = app.object;
  if (!actor || !actor.testUserPermission(game.user, "OWNER")) return;

  const button = $(`<a class="ai-portrait-btn"><i class="fas fa-magic"></i> AI Portrait</a>`);
  button.click(() => generatePortrait(actor));

  html.closest('.app').find('.window-header .window-title').after(button);
});

async function generatePortrait(actor) {
  const apiKey = game.settings.get("ai-portrait-generator", "apiKey");
  const gptPrompt = game.settings.get("ai-portrait-generator", "gptPrompt");
  const proxyBase = game.settings.get("ai-portrait-generator", "proxyUrl")?.trim().replace(/\/+$/, "");
  if (!apiKey) return ui.notifications.warn("Please set the OpenAI API key.");

  const { name, system, items } = actor;
  const cls = items.find(i => i.type === "class")?.name ?? "";
  const race = items.find(i => i.type === "race")?.name ?? "";
  const gender = system.details?.gender ?? "";
  const age = system.details?.age ?? "";
  const height = system.details?.height ?? "";
  const weight = system.details?.weight ?? "";
  const eyes = system.details?.eyes ?? "";
  const hair = system.details?.hair ?? "";
  const skin = system.details?.skin ?? "";
  const traits = system.details?.trait ?? "";
  const appearance = system.details?.appearance ?? "";

  const basePrompt = `Name: ${name}
Race: ${race}
Gender: ${gender}
Age: ${age}
Height: ${height}
Weight: ${weight}
Eye Color: ${eyes}
Hair: ${hair}
Skin: ${skin}
Class: ${cls}
Traits: ${traits}
Appearance: ${appearance}`;

  ui.notifications.info("Contacting GPT...");
  let visualPrompt = basePrompt;
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
    const data = await resp.json();
    visualPrompt = data.choices?.[0]?.message?.content ?? basePrompt;
  } catch (e) {
    console.error("GPT error:", e);
    ui.notifications.warn("GPT failed – using raw prompt.");
  }

  new Dialog({
    title: "AI Portrait Prompt",
    content: `<form><textarea id="prompt-text" rows="10" style="width:100%;">${visualPrompt}</textarea></form>`,
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
                n: 1,
                size: "1024x1792",
                response_format: "url"
              })
            });

            const result = await dalle.json();
            const imageUrl = result.data?.[0]?.url;
            if (!imageUrl) throw new Error("No image URL received.");

            const safeName = actor.name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
            const filename = `full-${safeName}.webp`;
            const proxyUrl = `${proxyBase}/?b64=${encodeURIComponent(btoa(imageUrl))}&name=${filename}`;
            const blob = await (await fetch(proxyUrl)).blob();

            // Crop top square portion for portrait
            const portraitBlob = await cropTopSquare(blob);
            const portraitFile = new File([portraitBlob], `portrait-${safeName}.webp`, { type: "image/webp" });
            const portraitUpload = await FilePicker.upload("data", "user/portraits", portraitFile, { overwrite: true });

            // Upload full image as token
            const tokenFile = new File([blob], `token-${safeName}.webp`, { type: "image/webp" });
            const tokenUpload = await FilePicker.upload("data", "user/portraits", tokenFile, { overwrite: true });

            await actor.update({
              img: `${portraitUpload.path}?cb=${Date.now()}`,
              "prototypeToken.texture.src": `${tokenUpload.path}?cb=${Date.now()}`
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

async function cropTopSquare(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const size = img.width;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, size, size, 0, 0, size, size);
      canvas.toBlob(resolve, "image/webp");
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}
