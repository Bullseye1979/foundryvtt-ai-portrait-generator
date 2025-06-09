console.log("[AI Portrait Generator] Script loaded");

Hooks.once("init", () => {
  game.settings.register("ai-portrait-generator", "apiKey", {
    name: "OpenAI API Key",
    hint: "Your OpenAI API key with DALL·E access",
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register("ai-portrait-generator", "gptPrompt", {
    name: "GPT Optimization Prompt",
    hint: "Instructions for GPT to improve the image description. (Max ~600 tokens / ~1000 chars)",
    scope: "world",
    config: true,
    type: String,
    default: `Enhance the following image description for DALL·E by making it more detailed, atmospheric, and creative without changing its original style.
- Use creative dynamic angles, lighting effects, and filters when appropriate.
- Incorporate creative symbolism when relevant.
- Give faces character and avoid generic or doll-like appearances.
- Use vibrant colors, when appropriate.
- Prefer digital art style.
- Prefer dynamic action-packed scenes, when appropriate.
- Ensure that each hand only has 5 fingers. Persons only have 2 arms and 2 legs. Avoid deformed faces and bodies.
- Ensure descriptions are not inappropriate or suggestive in any way.
- The picture is a portrait. Ensure that the face is always fully visible and centered.
- Avoid: Full body pictures`
  });
});

// Passwortfeld für API-Key
Hooks.on("renderSettingsConfig", (app, html, data) => {
  html.find('input[name="ai-portrait-generator.apiKey"]').attr("type", "password");
  html.find('input[name="ai-portrait-generator.gptPrompt"]').replaceWith(
    `<textarea name="ai-portrait-generator.gptPrompt" rows="10" style="width:100%;">${game.settings.get("ai-portrait-generator", "gptPrompt")}</textarea>`
  );
});

Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
  const actor = app.document;
  if (!actor) return;

  controls.push({
    name: "ai-portrait",
    icon: "fas fa-magic",
    label: "Generate AI Portrait",
    title: "Generate AI Portrait",
    button: true,
    visible: actor.testUserPermission(game.user, "OWNER"),
    onClick: () => generatePortrait(actor)
  });
});

async function generatePortrait(actor) {
  const openaiApiKey = game.settings.get("ai-portrait-generator", "apiKey");
  const gptPromptInstructions = game.settings.get("ai-portrait-generator", "gptPrompt");
  if (!openaiApiKey) {
    ui.notifications.warn("OpenAI API Key not set.");
    return;
  }

  const { name, system, items } = actor;
  const clsItem = items.find(i => i.type === "class");
  const cls = clsItem?.name ?? "adventurer";
  const subclass = clsItem?.system?.subclass ?? "";
  const raceItem = items.find(i => i.type === "race");
  const race = raceItem?.name ?? "humanoid";
  const background = items.find(i => i.type === "background")?.name ?? "";
  const alignment = system.details?.alignment || "neutral";
  const gender = system.details?.gender || "unspecified gender";
  const age = system.details?.age || "unknown age";
  const height = system.details?.height || "";
  const weight = system.details?.weight || "";
  const level = clsItem?.system?.levels ?? 1;
  const bio = system.details?.biography?.value?.replace(/<[^>]*>?/gm, "") || "";

  const equipment = items
    .filter(i => ["weapon", "equipment", "armor"].includes(i.type))
    .map(i => i.name)
    .slice(0, 5)
    .join(", ") || "no visible equipment";

  const rawDescription = `A fantasy RPG character portrait.
Name: ${name}
Class: ${cls}${subclass ? ` (${subclass})` : ""}
Race: ${race}
Gender: ${gender}
Age: ${age}, Height: ${height}, Weight: ${weight}
Level: ${level}, Alignment: ${alignment}
Background: ${background}
Visible Equipment: ${equipment}
Description: ${bio || "No additional description."}`;

  new Dialog({
    title: "Edit AI Prompt",
    content: `
      <form>
        <div class="form-group">
          <label>Edit prompt for AI generation:</label>
          <textarea id="prompt-text" rows="12" style="width:100%;">${rawDescription}</textarea>
        </div>
      </form>`,
    buttons: {
      generate: {
        label: "Generate",
        callback: async (html) => {
          const userDescription = html.find("#prompt-text").val();

          ui.notifications.info("Generating optimized prompt...");

          const gptResponse = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${openaiApiKey}`
            },
            body: JSON.stringify({
              model: "gpt-3.5-turbo",
              messages: [
                { role: "system", content: gptPromptInstructions },
                { role: "user", content: userDescription }
              ]
            })
          });

          const gptData = await gptResponse.json();
          let finalPrompt = gptData.choices?.[0]?.message?.content ?? userDescription;
          finalPrompt = finalPrompt.slice(0, 1000); // CUTOFF fallback

          ui.notifications.info("Generating AI portrait...");

          const dalleResponse = await fetch("https://api.openai.com/v1/images/generations", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${openaiApiKey}`
            },
            body: JSON.stringify({ prompt: finalPrompt, n: 1, size: "1024x1024", response_format: "b64_json" })
          });

          const dalleData = await dalleResponse.json();
          const base64 = dalleData.data[0].b64_json;
          const binary = atob(base64);
          const array = Uint8Array.from(binary, c => c.charCodeAt(0));
          const file = new File([array], `portrait-${actor.name.replace(/\s/g, "_")}.webp`, { type: "image/webp" });

          const upload = await foundry.applications.apps.FilePicker.implementation.upload(
            "data", "user/portraits", file, { overwrite: true }, { notify: true }
          );

          const imagePath = upload.path;
          await actor.update({ img: imagePath });
          actor.sheet.render(true);

          ui.notifications.info("Portrait generation complete.");
        }
      },
      cancel: { label: "Cancel" }
    },
    default: "generate"
  }).render(true);
}
