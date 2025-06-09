console.log("[AI Portrait Generator] Loaded");

Hooks.once("init", () => {
  game.settings.register("ai-portrait-generator", "apiKey", {
    name: "OpenAI API Key",
    hint: "Enter your OpenAI API key with DALL·E and GPT access",
    scope: "world",
    config: true,
    type: String,
    default: "",
    restricted: true
  });

  game.settings.register("ai-portrait-generator", "gptPrompt", {
    name: "GPT Prompt Template",
    hint: "System prompt for GPT prompt enhancement.",
    scope: "world",
    config: true,
    type: String,
    default: `Enhance the following image description for DALL·E by making it more detailed and creative, but don't change the original intent. Always make it portrait-oriented.`,
    multiline: true
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

  if (!apiKey) {
    ui.notifications.warn("API key not set in module settings.");
    return;
  }

  const { name, system, items } = actor;
  const clsItem = items.find(i => i.type === "class");
  const cls = clsItem?.name ?? "Adventurer";
  const subclass = clsItem?.system?.subclass ?? "";
  const race = items.find(i => i.type === "race")?.name ?? "Humanoid";
  const background = items.find(i => i.type === "background")?.name ?? "";
  const alignment = system.details?.alignment || "Neutral";
  const gender = system.details?.gender || "Unknown";
  const age = system.details?.age || "Unknown";
  const level = clsItem?.system?.levels ?? 1;
  const bio = system.details?.biography?.value?.replace(/<[^>]*>?/gm, "") || "";
  const equipment = items
    .filter(i => ["weapon", "equipment", "armor"].includes(i.type))
    .map(i => i.name).slice(0, 5).join(", ") || "No visible equipment";

  const basePrompt = `Name: ${name}
Class: ${cls}${subclass ? ` (${subclass})` : ""}
Race: ${race}
Gender: ${gender}
Age: ${age}
Level: ${level}
Alignment: ${alignment}
Background: ${background}
Equipment: ${equipment}
Description: ${bio}`;

  ui.notifications.info("Sending prompt to GPT...");

  let optimizedPrompt = basePrompt;

  try {
    const gptResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: gptPrompt },
          { role: "user", content: basePrompt }
        ],
        temperature: 0.7,
        max_tokens: 300
      })
    });

    const data = await gptResponse.json();
    optimizedPrompt = data.choices?.[0]?.message?.content || basePrompt;
  } catch (err) {
    console.error("GPT failed:", err);
    ui.notifications.warn("GPT failed – using raw prompt.");
  }

  new Dialog({
    title: "AI Portrait Prompt",
    content: `<form>
      <div class="form-group">
        <label>Prompt:</label>
        <textarea id="prompt-text" rows="10" style="width:100%;">${optimizedPrompt}</textarea>
      </div>
    </form>`,
    buttons: {
      generate: {
        label: "Generate",
        callback: async (html) => {
          let prompt = html.find("#prompt-text").val()?.trim();
          if (!prompt) return;

          ui.notifications.info("Requesting image from DALL·E...");

          try {
            const dalleResponse = await fetch("https://api.openai.com/v1/images/generations", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
              },
              body: JSON.stringify({
                prompt,
                model: "dall-e-3",
                n: 1,
                size: "1024x1024",
                response_format: "url"
              })
            });

            const dalleData = await dalleResponse.json();
            const imageUrl = dalleData.data?.[0]?.url;
            if (!imageUrl) throw new Error("No image URL received.");

            // Hol das Bild über den lokalen Proxy (damit kein CORS)
            const proxyUrl = `/ai-portrait-proxy?url=${encodeURIComponent(imageUrl)}&name=portrait-${Date.now()}.webp`;

            const proxiedImage = await fetch(proxyUrl);
            if (!proxiedImage.ok) throw new Error("Proxy failed: " + proxiedImage.status);

            const blob = await proxiedImage.blob();

            const file = new File([blob], `portrait-${actor.id}.webp`, { type: blob.type });
            const result = await FilePicker.upload("data", "user/portraits", file, { overwrite: true });

            const imagePath = result.path;
            await actor.update({ img: `${imagePath}?cb=${Date.now()}` });
            actor.sheet.render(true);

            ui.notifications.info("Portrait updated.");
          } catch (err) {
            console.error("Image generation failed:", err);
            ui.notifications.error("Image generation failed.");
          }
        }
      },
      cancel: { label: "Cancel" }
    },
    default: "generate"
  }).render(true);
}
