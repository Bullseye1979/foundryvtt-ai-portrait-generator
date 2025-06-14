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
    default: `You are enhancing a prompt for DALL·E to generate a portrait of a D&D character.
Do not change any of the following: name, race, gender, age, class, subclass, alignment, background, level, equipment, eye color, hair, skin tone, height, weight, personality traits, ideals, bonds, flaws, faith, kin, appearance, or biography.
You may add atmosphere, lighting, pose, art style – but not change or invent anything about the character.`
  });

  game.settings.register("ai-portrait-generator", "tokenPrompt", { // NEW
    name: "GPT Prompt Template (Token)",
    hint: "System prompt for GPT – adapts the description to generate a token with transparent background.",
    scope: "world", config: true, type: String, multiline: true,
    default: `You are enhancing a prompt for DALL·E to generate a full-body token image with transparent background.
Do not change the character’s description. The image should match the previously generated portrait.
Focus on full-body view, neutral stance, top-down lighting. No background. Style: fantasy token, clean outline.`
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
  const tokenPrompt = game.settings.get("ai-portrait-generator", "tokenPrompt"); // NEW
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
Biography: ${bio}`;

  ui.notifications.info("Contacting GPT...");

  let portraitPrompt = basePrompt;
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
    portraitPrompt = d.choices?.[0]?.message?.content ?? basePrompt;
  } catch (e) {
    console.error("GPT error:", e);
    ui.notifications.warn("GPT failed – using raw prompt.");
  }

  new Dialog({
    title: "AI Portrait Prompt",
    content: `<form><textarea id="prompt-text" rows="10" style="width:100%;">${portraitPrompt}</textarea></form>`,
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
                prompt, model: "dall-e-3",
                n: 1, size: "1024x1024", response_format: "url"
              })
            });
            const dd = await dalle.json();
            const portraitUrl = dd.data?.[0]?.url;
            if (!portraitUrl) throw new Error("No image URL.");

            const safeName = actor.name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
            const portraitFilename = `portrait-${safeName}.webp`;
            const portraitProxyUrl = `${proxyBase}/?b64=${encodeURIComponent(btoa(portraitUrl))}&name=${portraitFilename}`;
            const portraitBlob = await (await fetch(portraitProxyUrl)).blob();
            const portraitFile = new File([portraitBlob], portraitFilename, { type: portraitBlob.type });
            const portraitUpload = await FilePicker.upload("data", "user/portraits", portraitFile, { overwrite: true });
            const portraitPath = portraitUpload.path;

            // NOW generate token image using the portraitPrompt
            ui.notifications.info("Contacting GPT for Token prompt...");
            let tokenFinalPrompt = prompt;
            try {
              const tokenResp = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST", headers: {
                  "Authorization": `Bearer ${apiKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  model: "gpt-3.5-turbo",
                  messages: [
                    { role: "system", content: tokenPrompt },
                    { role: "user", content: prompt }
                  ],
                  temperature: 0.7, max_tokens: 400
                })
              });
              const td = await tokenResp.json();
              tokenFinalPrompt = td.choices?.[0]?.message?.content ?? prompt;
            } catch (e) {
              console.warn("Token GPT failed – using same prompt.");
            }

            ui.notifications.info("Requesting token image from DALL·E...");

            const tokenImage = await fetch("https://api.openai.com/v1/images/generations", {
              method: "POST", headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                prompt: tokenFinalPrompt,
                model: "dall-e-3",
                n: 1, size: "1024x1024", response_format: "url"
              })
            });
            const tokenJson = await tokenImage.json();
            const tokenUrl = tokenJson.data?.[0]?.url;
            if (!tokenUrl) throw new Error("No token image URL.");

            const tokenFilename = `token-${safeName}.webp`;
            const tokenProxyUrl = `${proxyBase}/?b64=${encodeURIComponent(btoa(tokenUrl))}&name=${tokenFilename}`;
            const tokenBlob = await (await fetch(tokenProxyUrl)).blob();
            const tokenFile = new File([tokenBlob], tokenFilename, { type: tokenBlob.type });
            const tokenUpload = await FilePicker.upload("data", "user/portraits", tokenFile, { overwrite: true });
            const tokenPath = tokenUpload.path;

            await actor.update({
              img: `${portraitPath}?cb=${Date.now()}`,
              "prototypeToken.texture.src": `${tokenPath}?cb=${Date.now()}`
            });

            actor.sheet.render(true);
            ui.notifications.info("Portrait and Token image updated.");
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
