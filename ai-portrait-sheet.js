console.log("[AI Portrait Generator] Script loaded");

Hooks.once("init", () => {
  game.settings.register("ai-portrait-generator", "apiKey", {
    name: "OpenAI API Key",
    hint: "Enter your OpenAI API key with DALL·E access",
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register("ai-portrait-generator", "stylePrompt", {
    name: "GPT-Style Prompt",
    hint: "Describe how GPT-3.5 should formulate the portrait description",
    scope: "world",
    config: true,
    type: String,
    default: "Create a vivid, cinematic prompt for a fantasy RPG portrait with clear face view"
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

async function getOptimizedPrompt(stylePrompt, characterDesc, apiKey) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: stylePrompt },
        { role: "user", content: characterDesc }
      ],
      max_tokens: 500
    })
  });

  if (!response.ok) throw new Error("GPT-3.5 error: " + response.statusText);
  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? characterDesc;
}

async function generatePortrait(actor) {
  const apiKey = game.settings.get("ai-portrait-generator", "apiKey");
  const stylePrompt = game.settings.get("ai-portrait-generator", "stylePrompt");

  if (!apiKey) {
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
  const equipment = items.filter(i => ["weapon", "equipment", "armor"].includes(i.type)).map(i => i.name).slice(0, 5).join(", ") || "no visible equipment";

  const characterDesc = `Character Name: ${name}
Class: ${cls}${subclass ? ` (${subclass})` : ""}
Race: ${race}
Gender: ${gender}
Age: ${age}, Height: ${height}, Weight: ${weight}
Level: ${level}, Alignment: ${alignment}
Background: ${background}
Visible Equipment: ${equipment}
Bio: ${bio || "No additional description."}`;

  let finalPrompt = characterDesc;
  try {
    finalPrompt = await getOptimizedPrompt(stylePrompt, characterDesc, apiKey);
  } catch (e) {
    console.warn("[AI Portrait Generator] GPT optimization failed:", e);
  }

  new Dialog({
    title: "Edit AI Prompt",
    content: `<form>
      <div class="form-group">
        <label>Edit prompt for AI generation:</label>
        <textarea id="prompt-text" rows="12" style="width:100%;">${finalPrompt}</textarea>
      </div>
    </form>`,
    buttons: {
      generate: {
        label: "Generate",
        callback: async (html) => {
          const prompt = html.find("#prompt-text").val();
          ui.notifications.info("Starting AI Portrait generation...");

          const response = await fetch("https://api.openai.com/v1/images/generations", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({ prompt, n: 1, size: "1024x1024", response_format: "b64_json" })
          });

          if (!response.ok) {
            ui.notifications.error("Error from OpenAI: " + response.statusText);
            return;
          }

          const data = await response.json();
          const base64 = data.data[0].b64_json;
          const binary = atob(base64);
          const array = Uint8Array.from(binary, c => c.charCodeAt(0));
          const filename = `portrait-${actor.id}-${Date.now()}.webp`;
          const file = new File([array], filename, { type: "image/webp" });

          const upload = await foundry.applications.apps.FilePicker.implementation.upload("data", "user/portraits", file, { overwrite: true }, { notify: true });
          const imagePath = upload.path + `?${Date.now()}`;

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
