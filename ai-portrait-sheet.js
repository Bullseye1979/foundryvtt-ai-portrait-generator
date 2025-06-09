console.log("[AI Portrait Generator] Script loaded");

Hooks.once("init", () => {
  game.settings.register("ai-portrait-generator", "apiKey", {
    name: "OpenAI API Key",
    hint: "Enter your OpenAI API key with access to DALL·E and GPT-3.5",
    scope: "world",
    config: true,
    type: String,
    default: "",
    restricted: true
  });

  game.settings.register("ai-portrait-generator", "gptPrompt", {
    name: "GPT Prompt for Optimization",
    hint: "Prompt to send to GPT-3.5 for improving the DALL·E prompt",
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
  if (!openaiApiKey) {
    ui.notifications.warn("OpenAI API Key not set.");
    return;
  }

  const promptBase = buildPromptFromActor(actor);
  const gptPrompt = game.settings.get("ai-portrait-generator", "gptPrompt");

  // Anfrage an GPT-3.5 zur Prompt-Optimierung
  const optimizedPrompt = await optimizeWithGPT(openaiApiKey, gptPrompt, promptBase);
  if (!optimizedPrompt) {
    ui.notifications.error("GPT prompt optimization failed.");
    return;
  }

  const dialog = new Dialog({
    title: "Edit AI Prompt",
    content: `
      <form>
        <div class="form-group">
          <label>Final prompt for DALL·E generation:</label>
          <textarea id="prompt-text" rows="12" style="width:100%;">${optimizedPrompt}</textarea>
        </div>
      </form>`,
    buttons: {
      generate: {
        label: "Generate",
        callback: async (html) => {
          const prompt = html.find("#prompt-text").val();
          ui.notifications.info("Generating portrait...");

          const response = await fetch("https://api.openai.com/v1/images/generations", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${openaiApiKey}`
            },
            body: JSON.stringify({ prompt, n: 1, size: "1024x1024", response_format: "b64_json" })
          });

          if (!response.ok) {
            ui.notifications.error("OpenAI error: " + response.statusText);
            return;
          }

          const data = await response.json();
          const base64 = data.data[0].b64_json;
          const binary = atob(base64);
          const array = Uint8Array.from(binary, c => c.charCodeAt(0));
          const filename = `portrait-${actor.name.replace(/\s/g, "_")}-${Date.now()}.webp`;
          const file = new File([array], filename, { type: "image/webp" });

          const upload = await foundry.applications.apps.FilePicker.implementation.upload("data", "user/portraits", file, { overwrite: true }, { notify: true });
          const imagePath = upload.path;

          await actor.update({ img: imagePath });
          actor.sheet.render(true);

          ui.notifications.info("Portrait updated.");
        }
      },
      cancel: { label: "Cancel" }
    },
    default: "generate"
  });

  dialog.render(true);
}

function buildPromptFromActor(actor) {
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

  return `Digital portrait of a fantasy RPG character.
Name: ${name}
Class: ${cls}${subclass ? ` (${subclass})` : ""}
Race: ${race}
Gender: ${gender}
Age: ${age}, Height: ${height}, Weight: ${weight}
Level: ${level}, Alignment: ${alignment}
Background: ${background}
Visible Equipment: ${equipment}
Description: ${bio}
Style: cinematic, colorful, dramatic lighting, centered portrait.`;
}

async function optimizeWithGPT(apiKey, instruction, promptBase) {
  const messages = [
    { role: "system", content: instruction },
    { role: "user", content: promptBase }
  ];

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-3.5-turbo",
      messages,
      max_tokens: 500
    })
  });

  if (!response.ok) {
    console.error("GPT fetch failed", await response.text());
    return null;
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}
