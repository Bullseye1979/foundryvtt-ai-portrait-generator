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
    hint: "Enhance the description – portrait-oriented.",
    scope: "world", config: true, type: String, multiline: true,
    default: `Enhance the following image description for DALL·E by making it more detailed, creative, and portrait-oriented.`
  });
  game.settings.register("ai-portrait-generator", "proxyUrl", {
    name: "Proxy Base URL",
    hint: "Full URL of your CORS proxy endpoint (no ?args).",
    scope: "world", config: true, type: String,
    default: "https://corsproxy.ralfreschke.de"
  });
});

Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
  const actor = app.document;
  if (!actor || !actor.testUserPermission(game.user, "OWNER")) return;
  controls.push({
    name: "ai-portrait",
    icon: "fas fa-magic", label: "Generate AI Portrait",
    title: "Generate AI Portrait", button: true,
    onClick: () => generatePortrait(actor)
  });
});

async function generatePortrait(actor) {
  const apiKey = game.settings.get("ai-portrait-generator", "apiKey");
  const gptPrompt = game.settings.get("ai-portrait-generator", "gptPrompt");
  const proxyBase = game.settings.get("ai-portrait-generator", "proxyUrl")?.trim().replace(/\/+$/, "");
  if (!apiKey) return ui.notifications.warn("Please set the OpenAI API key.");

  const { name, system, items } = actor;
  // … [Actor metadata logic stays the same] …

  const basePrompt = `Name: ${name}\n…`;

  ui.notifications.info("Contacting GPT...");
  let optimized;
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [{ role: "system", content: gptPrompt }, { role: "user", content: basePrompt }],
        temperature: 0.7, max_tokens: 300
      })
    });
    const d = await resp.json();
    optimized = d.choices?.[0]?.message?.content ?? basePrompt;
  } catch (e) {
    console.error("GPT error:", e);
    ui.notifications.warn("GPT failed – using raw prompt.");
    optimized = basePrompt;
  }

  new Dialog({
    title: "AI Portrait Prompt",
    content: `<form><textarea id="prompt-text" rows="10" style="width:100%;">${optimized}</textarea></form>`,
    buttons: {
      generate: {
        label: "Generate",
        callback: async html => {
          const prompt = html.find("#prompt-text").val()?.trim();
          if (!prompt) return;
          ui.notifications.info("Requesting image…");

          try {
            const dalle = await fetch("https://api.openai.com/v1/images/generations", {
              method: "POST", headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                prompt, model: "dall-e-3",
                n: 1, size: "1024x1024", response_format: "url"
              })
            });
            const dd = await dalle.json();
            const imageUrl = dd.data?.[0]?.url;
            if (!imageUrl) throw new Error("No image URL.");

            const b64 = btoa(imageUrl);
            if (!proxyBase) throw new Error("No proxy URL configured.");
            const proxyUrl = `${proxyBase}/?b64=${encodeURIComponent(b64)}&name=portrait-${actor.id}.webp`;

            const imgResp = await fetch(proxyUrl);
            if (!imgResp.ok) throw new Error(`Proxy failed: ${imgResp.status}`);
            const blob = await imgResp.blob();

            const file = new File([blob], `portrait-${actor.id}.webp`, { type: blob.type });
            const upd = await FilePicker.upload("data", "user/portraits", file, { overwrite: true });
            const imagePath = upd.path;

            await actor.update({ img: `${imagePath}?cb=${Date.now()}` });
            actor.sheet.render(true);
            ui.notifications.info("Portrait updated.");
          } catch (e) {
            console.error("Image generation failed:", e);
            ui.notifications.error("Portrait generation failed.");
          }
        }
      },
      cancel: { label: "Cancel" }
    },
    default: "generate"
  }).render(true);
}
