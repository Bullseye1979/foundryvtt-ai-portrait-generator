console.log("[AI Portrait Generator] Script loaded");

Hooks.once("init", () => {
  game.settings.register("ai-portrait-generator", "apiKey", {
    name: "OpenAI API Key",
    hint: "Enter your OpenAI API key with DALL·E and GPT-3.5 access",
    scope: "world",
    config: true,
    type: String,
    default: "",
    onChange: () => window.location.reload(),
    restricted: true
  });

  game.settings.register("ai-portrait-generator", "gptPrompt", {
    name: "GPT Prompt Template",
    hint: "This instruction is sent to GPT to enhance the character description before sending it to DALL·E.",
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
- Avoid: Full body pictures.
- No deformed faces`,
    multiline: true
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
  const apiKey = game.settings.get("ai-portrait-generator", "apiKey");
  const gptPrompt = game.settings.get("ai-portrait-generator", "gptPrompt");

  if (!apiKey) {
    ui.notifications.warn("OpenAI API Key not set.");
    return;
  }

  // Charakterdaten zusammensetzen
  const { name, system, items } = actor;
  const clsItem = items.find(i => i.type === "class");
  const cls = clsItem?.name ?? "adventurer";
  const subclass = clsItem?.system?.subclass ?? "";
  const raceItem = items.find(i => i.type === "race");
  const race = raceItem?.name ?? "humanoid";
  const background = items.find(i => i.type === "background")?.name ?? "";
  const alignment = system.details?.alignment || "neutral";
  const gender = system.details?.gender || "unspecified";
  const age = system.details?.age || "unknown";
  const height = system.details?.height || "";
  const weight = system.details?.weight || "";
  const level = clsItem?.system?.levels ?? 1;
  const bio = system.details?.biography?.value?.replace(/<[^>]*>?/gm, "") || "";
  const equipment = items
    .filter(i => ["weapon", "equipment", "armor"].includes(i.type))
    .map(i => i.name)
    .slice(0, 5)
    .join(", ") || "no visible equipment";

  const baseDescription = `Name: ${name}
Class: ${cls}${subclass ? ` (${subclass})` : ""}
Race: ${race}
Gender: ${gender}
Age: ${age}, Height: ${height}, Weight: ${weight}
Level: ${level}, Alignment: ${alignment}
Background: ${background}
Equipment: ${equipment}
Description: ${bio || "No additional description."}`;

  // Prompt an GPT senden
  ui.notifications.info("Contacting GPT-3.5 to optimize portrait description...");
  let optimizedPrompt = baseDescription;

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
          { role: "user", content: baseDescription }
        ],
        temperature: 0.7,
        max_tokens: 350
      })
    });

    const gptData = await gptResponse.json();
    optimizedPrompt = gptData.choices?.[0]?.message?.content || baseDescription;
  } catch (err) {
    console.error("GPT Error:", err);
    ui.notifications.warn("GPT optimization failed, using raw description.");
  }

  // Dialog zur Bearbeitung des finalen Prompts
  new Dialog({
    title: "Edit AI Prompt",
    content: `
      <form>
        <div class="form-group">
          <label>Edit prompt for AI generation:</label>
          <textarea id="prompt-text" rows="12" style="width:100%;">${optimizedPrompt}</textarea>
        </div>
      </form>`,
    buttons: {
      generate: {
        label: "Generate",
        callback: async (html) => {
          let prompt = html.find("#prompt-text").val()?.trim();
          if (prompt.length > 1000) {
            prompt = prompt.slice(0, 1000);
            ui.notifications.warn("Prompt was too long and has been trimmed.");
          }

          ui.notifications.info("Generating image from DALL·E...");

          try {
            const dalleResponse = await fetch("https://api.openai.com/v1/images/generations", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
              },
              body: JSON.stringify({ prompt, n: 1, size: "1024x1024", response_format: "b64_json" })
            });

            if (!dalleResponse.ok) throw new Error(await dalleResponse.text());
            const dalleData = await dalleResponse.json();
            const base64 = dalleData.data[0].b64_json;
            const binary = atob(base64);
            const array = Uint8Array.from(binary, c => c.charCodeAt(0));
            const file = new File([array], `portrait-${actor.name.replace(/\s/g, "_")}.webp`, { type: "image/webp" });

            const upload = await foundry.applications.apps.FilePicker.implementation.upload("data", "user/portraits", file, { overwrite: true }, { notify: false });
            const imagePath = upload.path;

            await actor.update({ img: `${imagePath}?cb=${Date.now()}` });
            actor.sheet.render(true);

            ui.notifications.info("Portrait updated.");
          } catch (err) {
            console.error("DALL·E error:", err);
            ui.notifications.error("Image generation failed.");
          }
        }
      },
      cancel: { label: "Cancel" }
    },
    default: "generate"
  }).render(true);
}
