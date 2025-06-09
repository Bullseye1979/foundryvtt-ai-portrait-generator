console.log("[AI Portrait Generator] Script loaded");

Hooks.once("init", () => {
  game.settings.register("ai-portrait-generator", "apiKey", {
    name: "OpenAI API Key",
    hint: "Enter your OpenAI API key with DALL·E and GPT access",
    scope: "world",
    config: true,
    type: String,
    default: "",
    onChange: () => window.location.reload(),
    restricted: true
  });

  game.settings.register("ai-portrait-generator", "gptPrompt", {
    name: "GPT Prompt Instruction",
    hint: "Instruction for GPT to improve DALL·E prompt",
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
- Avoid: Full body pictures.`
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
  const gptInstruction = game.settings.get("ai-portrait-generator", "gptPrompt");

  if (!apiKey) {
    ui.notifications.warn("OpenAI API Key not set in module settings.");
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

  const basePrompt = `Digital portrait of a fantasy RPG character.
Name: ${name}
Class: ${cls}${subclass ? ` (${subclass})` : ""}
Race: ${race}
Gender: ${gender}
Age: ${age}, Height: ${height}, Weight: ${weight}
Level: ${level}, Alignment: ${alignment}
Background: ${background}
Visible Equipment: ${equipment}
Description: ${bio || "No additional description."}
Style: cinematic, centered, colorful, atmospheric lighting, portrait-focused.`;

  const dialog = new Dialog({
    title: "Edit AI Prompt",
    content: `<form><div class="form-group"><label>Prompt for GPT Optimization:</label>
      <textarea id="prompt-text" rows="12" style="width:100%;">${basePrompt}</textarea></div></form>`,
    buttons: {
      generate: {
        label: "Generate",
        callback: async (html) => {
          const prompt = html.find("#prompt-text").val();
          if (!prompt || prompt.length < 30) {
            ui.notifications.warn("Prompt too short.");
            return;
          }

          ui.notifications.info("Sending prompt to GPT...");

          // GPT OPTIMIZATION STEP
          const gptResponse = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: "gpt-3.5-turbo",
              messages: [
                { role: "system", content: gptInstruction },
                { role: "user", content: prompt }
              ],
              max_tokens: 750,
              temperature: 0.7
            })
          });

          const gptData = await gptResponse.json();
          const optimizedPrompt = gptData.choices?.[0]?.message?.content?.trim();

          if (!optimizedPrompt) {
            ui.notifications.error("GPT did not return a usable prompt.");
            return;
          }

          ui.notifications.info("Generating portrait with DALL·E...");

          // DALL·E IMAGE GENERATION
          const dalleResponse = await fetch("https://api.openai.com/v1/images/generations", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              prompt: optimizedPrompt,
              n: 1,
              size: "1024x1024",
              response_format: "b64_json"
            })
          });

          const dalleData = await dalleResponse.json();
          const base64 = dalleData.data?.[0]?.b64_json;

          if (!base64) {
            ui.notifications.error("DALL·E did not return an image.");
            return;
          }

          // Convert to file
          const binary = atob(base64);
          const array = Uint8Array.from(binary, c => c.charCodeAt(0));
          const file = new File([array], `portrait-${actor.id}.webp`, { type: "image/webp" });

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
  });

  dialog.render(true);
}
