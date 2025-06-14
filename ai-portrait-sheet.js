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
    hint: "System prompt for GPT – focuses on physical traits and appearance only.",
    scope: "world", config: true, type: String, multiline: true,
    default: `You are generating a visual description of a fantasy character based on RPG-like data.
Focus only on physical appearance, clothing, expression, posture, environment, lighting, and art style.
Do not include RPG stats, class names, levels, abilities, alignments, or labels like "background" or "personality".
Do not repeat exact field names or structure – just describe what is visually seen.
Your goal is a rich visual description for an artist or image model.`
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
    icon: "fas fa-magic",
    label: "Generate AI Portrait",
    title: "Generate AI Portrait",
    button: true,
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
  const alignment = system.details?.alignment ?? "";
  const gender = system.details?.gender ?? "";
  const age = system.details?.age ?? "";
  const faith = system.details?.faith ?? "";
  const kin = system.details?.kin ?? "";
  const traits = system.details?.trait ?? "";
  const ideals = system.details?.ideal ?? "";
  const bonds = system.details?.bond ?? "";
  const flaws = system.details?.flaw ?? "";
  const appearance = system.details?.appearance ?? "";
  const bio = system.details?.biography?.value?.replace(/<[^>]*>?/gm, "") ?? "";
  const eyes = system.details?.eyes ?? "";
  const hair = system.details?.hair ?? "";
  const skin = system.details?.skin ?? "";
  const height = system.details?.height ?? "";
  const weight = system.details?.weight ?? "";

  const equipment = items
    .filter(i => ["weapon", "equipment", "armor"].includes(i.type))
    .map(i => i.name).slice(0, 5).join(", ") || "No visible equipment";

  const rawData = `Name: ${name}
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
Biography: ${bio}`;

  ui.notifications.info("Contacting GPT...");

  let visualDescription = rawData;
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
          { role: "user", content: rawData }
        ],
        temperature: 0.7, max_tokens: 400
      })
    });
    const data = await resp.json();
    visualDescription = data.choices?.[0]?.message?.content ?? rawData;
  } catch (e) {
    console.error("GPT error:", e);
    ui.notifications.warn("GPT failed – using raw data.");
  }

  new Dialog({
    title: "AI Portrait Description",
    content: `<form><textarea id="prompt-text" rows="10" style="width:100%;">${visualDescription}</textarea></form>`,
    buttons: {
      generate: {
        label: "Generate",
        callback: async html => {
          const prompt = html.find("#prompt-text").val()?.trim();
          if (!prompt) return;

          ui.notifications.info("Requesting portrait...");

          const imageUrl = await requestDalleImage(apiKey, prompt, "1024x1024");
          const portraitPath = await uploadViaProxy(proxyBase, imageUrl, `portrait-${name}.webp`);

          ui.notifications.info("Requesting token...");

          const tokenPrompt = `${prompt} Full-body view, plain white background, neutral or dynamic stance, no background elements.`;
          const tokenUrl = await requestDalleImage(apiKey, tokenPrompt, "1024x1792");
          const tokenPath = await uploadViaProxy(proxyBase, tokenUrl, `token-${name}.webp`);

          await actor.update({
            img: `${portraitPath}?cb=${Date.now()}`,
            "prototypeToken.texture.src": `${tokenPath}?cb=${Date.now()}`
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

async function requestDalleImage(apiKey, prompt, size) {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST", headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt,
      n: 1,
      size,
      response_format: "url"
    })
  });
  const json = await res.json();
  return json.data?.[0]?.url;
}

async function uploadViaProxy(proxyBase, imageUrl, filename) {
  const proxyUrl = `${proxyBase}/?b64=${encodeURIComponent(btoa(imageUrl))}&name=${filename}`;
  const blob = await (await fetch(proxyUrl)).blob();
  const file = new File([blob], filename, { type: blob.type });
  const upload = await FilePicker.upload("data", "user/portraits", file, { overwrite: true });
  return upload.path;
}
