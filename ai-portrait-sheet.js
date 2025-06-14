console.log("[AI Portrait Generator] Loaded");

Hooks.once("init", () => {
  game.settings.register("ai-portrait-generator", "apiKey", {
    name: "OpenAI API Key",
    hint: "API key for GPT and DALL·E.",
    scope: "world", config: true, type: String,
    default: "", restricted: true
  });

  game.settings.register("ai-portrait-generator", "gptPrompt", {
    name: "GPT Prompt Template (Portrait)",
    hint: "System prompt for GPT – enhances the character for DALL·E portrait.",
    scope: "world", config: true, type: String, multiline: true,
    default: `You are writing a prompt for DALL·E to generate a character portrait for a fantasy RPG.
Focus on realistic, visually rich descriptions (e.g., appearance, mood, pose, lighting, environment, and art style).
Do not include any game-specific statistics, traits, class names, background labels, alignment, or similar metadata.
Do not mention the word "portrait" in the prompt.
Your task is to produce a short visual description of the character based only on their appearance and personality, not rules.`
  });

  game.settings.register("ai-portrait-generator", "proxyUrl", {
    name: "Proxy Base URL",
    hint: "Base URL of your CORS proxy endpoint (no ?args).",
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
  const clsItem = items.find(i => i.type === "class");
  const cls = clsItem?.name ?? "Adventurer";
  const subclass = clsItem?.system?.subclass ?? "";
  const race = items.find(i => i.type === "race")?.name ?? "Humanoid";
  const background = items.find(i => i.type === "background")?.name ?? "";
  const alignment = system.details?.alignment ?? "Neutral";
  const gender = system.details?.gender ?? "Unknown";
  const age = system.details?.age ?? "Unknown";
  const faith = system.details?.faith ?? "";
  const kin = system.details?.kin ?? "";
  const traits = system.details?.trait ?? "";
  const ideals = system.details?.ideal ?? "";
  const bonds = system.details?.bond ?? "";
  const flaws = system.details?.flaw ?? "";
  const appearance = system.details?.appearance ?? "";
  const bio = system.details?.biography?.value?.replace(/<[^>]*>?/gm, "") ?? "";
  const eyes = system.details?.eyes ?? "unknown";
  const hair = system.details?.hair ?? "unknown";
  const skin = system.details?.skin ?? "unknown";
  const height = system.details?.height ?? "unknown";
  const weight = system.details?.weight ?? "unknown";

  const equipment = items
    .filter(i => ["weapon", "equipment", "armor"].includes(i.type))
    .map(i => i.name).slice(0, 5).join(", ") || "No visible equipment";

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
Alignment: ${alignment}
Background: ${background}
Equipment: ${equipment}

Personality Traits: ${traits}
Ideals: ${ideals}
Bonds: ${bonds}
Flaws: ${flaws}
Appearance: ${appearance}
Biography: ${bio}`.trim();

  ui.notifications.info("Contacting GPT...");

  let gptDescription = basePrompt;
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
        temperature: 0.7, max_tokens: 600
      })
    });
    const d = await resp.json();
    gptDescription = d.choices?.[0]?.message?.content ?? basePrompt;
  } catch (e) {
    console.error("GPT error:", e);
    ui.notifications.warn("GPT failed – using raw prompt.");
  }

  new Dialog({
    title: "AI Portrait Description",
    content: `<form><textarea id="prompt-text" rows="10" style="width:100%;">${gptDescription}</textarea></form>`,
    buttons: {
      generate: {
        label: "Generate",
        callback: async html => {
          const prompt = html.find("#prompt-text").val()?.trim();
          if (!prompt) return;

          const safeName = actor.name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");

          async function requestImage(prompt, filename, size = "1024x1024") {
            const dalle = await fetch("https://api.openai.com/v1/images/generations", {
              method: "POST", headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ prompt, model: "dall-e-3", n: 1, size, response_format: "url" })
            });
            const dd = await dalle.json();
            const url = dd.data?.[0]?.url;
            if (!url) throw new Error("No image URL.");
            const proxyUrl = `${proxyBase}/?b64=${encodeURIComponent(btoa(url))}&name=${filename}`;
            const blob = await (await fetch(proxyUrl)).blob();
            const file = new File([blob], filename, { type: blob.type });
            const upload = await FilePicker.upload("data", "user/portraits", file, { overwrite: true });
            return upload.path;
          }

          ui.notifications.info("Requesting Portrait image...");
          const portraitPath = await requestImage(prompt, `portrait-${safeName}.webp`);

          const tokenPromptSuffix = `
Now rewrite the above as a prompt for DALL·E to generate a full-body character image with no background.
Be very clear: the background must be entirely white, plain, or transparent. No scenery, no textures, no gradients, no lighting effects behind the character.
The result should look like a clean cutout of the character standing upright, centered in the frame.
Do not add artistic context or scene descriptions. Focus entirely on the character’s appearance, clothing, pose, and clarity.`.trim();

          ui.notifications.info("Requesting Token image...");
          const tokenPath = await requestImage(`${prompt}\n\n${tokenPromptSuffix}`, `token-${safeName}.webp`);

          await actor.update({
            img: `${portraitPath}?cb=${Date.now()}`,
            "prototypeToken.texture.src": `${tokenPath}?cb=${Date.now()}`
          });

          actor.sheet.render(true);
          ui.notifications.info("Portrait and Token image updated.");
        }
      },
      cancel: { label: "Cancel" }
    },
    default: "generate"
  }).render(true);
}
