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
    hint: "System prompt for GPT – enhances the character for DALL·E generation.",
    scope: "world", config: true, type: String, multiline: true,
    default: `You are writing a prompt for DALL·E to generate a fantasy character portrait.
Focus only on physical, visual, and emotional traits.
Avoid using game-related terms like class, level, background, alignment, race, or stats.
Describe the character's mood, appearance, pose, clothing, and surrounding in a realistic, atmospheric way.`
  });

  game.settings.register("ai-portrait-generator", "proxyUrl", {
    name: "Proxy Base URL",
    hint: "Base URL of your CORS proxy endpoint (no ?args).",
    scope: "world", config: true, type: String,
    default: "https://corsproxy.ralfreschke.de"
  });
});

Hooks.on("renderActorSheet", (sheet, html, data) => {
  const actor = sheet.actor;
  if (!actor || !actor.testUserPermission(game.user, "OWNER")) return;
  if (html.find(".ai-portrait-button").length) return;

  const button = $(`
    <a class="ai-portrait-button" style="flex: 0; margin-left: 5px;" title="Generate AI Portrait">
      <i class="fas fa-magic"></i> AI Portrait
    </a>
  `);
  button.on("click", () => generatePortrait(actor));
  html.closest('.app').find('.window-title').after(button);
});

async function generatePortrait(actor) {
  const apiKey = game.settings.get("ai-portrait-generator", "apiKey");
  const gptPrompt = game.settings.get("ai-portrait-generator", "gptPrompt");
  const proxyBase = game.settings.get("ai-portrait-generator", "proxyUrl")?.trim().replace(/\/+$/, "");
  if (!apiKey) return ui.notifications.warn("Please set the OpenAI API key.");

  const { name, system, items } = actor;
  const clsItem = items.find(i => i.type === "class");
  const cls = clsItem?.name ?? "Adventurer";
  const subclass = clsItem?.system?.subclass ?? "";
  const race = items.find(i => i.type === "race")?.name ?? "Humanoid";
  const background = items.find(i => i.type === "background")?.name ?? "";
  const gender = system.details?.gender ?? "Unknown";
  const age = system.details?.age ?? "Unknown";
  const eyes = system.details?.eyes ?? "unknown";
  const hair = system.details?.hair ?? "unknown";
  const skin = system.details?.skin ?? "unknown";
  const height = system.details?.height ?? "unknown";
  const weight = system.details?.weight ?? "unknown";
  const faith = system.details?.faith ?? "";
  const kin = system.details?.kin ?? "";
  const traits = system.details?.trait ?? "";
  const ideals = system.details?.ideal ?? "";
  const bonds = system.details?.bond ?? "";
  const flaws = system.details?.flaw ?? "";
  const appearance = system.details?.appearance ?? "";
  const bio = system.details?.biography?.value?.replace(/<[^>]*>?/gm, "") ?? "";
  const equipment = items.filter(i => ["weapon", "equipment", "armor"].includes(i.type)).map(i => i.name).slice(0, 5).join(", ") || "No visible equipment";

  const basePrompt = `Name: ${name}
Class: ${cls}${subclass ? ` (${subclass})` : ""}
Race: ${race}
Gender: ${gender}
Age: ${age}
Height: ${height}
Weight: ${weight}
Eye Color: ${eyes}
Hair: ${hair}
Skin: ${skin}
Faith: ${faith}
Kin: ${kin}
Background: ${background}
Equipment: ${equipment}
Personality Traits: ${traits}
Ideals: ${ideals}
Bonds: ${bonds}
Flaws: ${flaws}
Appearance: ${appearance}
Biography: ${bio}`;

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
    const d = await resp.json();
    visualPrompt = d.choices?.[0]?.message?.content ?? basePrompt;
  } catch (e) {
    console.warn("GPT failed:", e);
    ui.notifications.warn("GPT failed – using fallback prompt.");
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
          ui.notifications.info("Generating portrait image...");

          const safeName = actor.name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
          const portraitFile = await generateImage(apiKey, proxyBase, prompt, "portrait-" + safeName);
          if (!portraitFile) return;

          ui.notifications.info("Generating token image...");
          const tokenPrompt = prompt + " Full body, plain white background, standing pose, fantasy art, no background elements.";
          const tokenFile = await generateImage(apiKey, proxyBase, tokenPrompt, "token-" + safeName);
          if (!tokenFile) return;

          await actor.update({
            img: `${portraitFile.path}?cb=${Date.now()}`,
            "prototypeToken.texture.src": `${tokenFile.path}?cb=${Date.now()}`
          });

          actor.sheet.render(true);
          ui.notifications.info("Portrait and Token updated.");
        }
      },
      cancel: { label: "Cancel" }
    },
    default: "generate"
  }).render(true);
}

async function generateImage(apiKey, proxyBase, prompt, filename) {
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
    const data = await dalle.json();
    const imageUrl = data.data?.[0]?.url;
    if (!imageUrl) throw new Error("No image URL returned.");

    const proxyUrl = `${proxyBase}/?b64=${encodeURIComponent(btoa(imageUrl))}&name=${filename}.webp`;
    const blob = await (await fetch(proxyUrl)).blob();
    const file = new File([blob], `${filename}.webp`, { type: blob.type });
    return await FilePicker.upload("data", "user/portraits", file, { overwrite: true });
  } catch (e) {
    console.error("Image generation error:", e);
    ui.notifications.error("Image generation failed.");
    return null;
  }
}
