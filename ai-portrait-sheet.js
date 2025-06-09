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

  game.settings.register("ai-portrait-generator", "promptStyle", {
    name: "Base Style Prompt",
    hint: "This style prompt will be prepended to each AI request (e.g. 'Fantasy art, cinematic lighting...')",
    scope: "world",
    config: true,
    type: String,
    default: "Fantasy RPG portrait, cinematic lighting, centered face, vibrant colors"
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
  const promptStyle = game.settings.get("ai-portrait-generator", "promptStyle") || "";

  if (!openaiApiKey) {
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

  const dynamicPrompt = `Name: ${name}
Class: ${cls}${subclass ? ` (${subclass})` : ""}
Race: ${race}
Gender: ${gender}
Age: ${age}, Height: ${height}, Weight: ${weight}
Level: ${level}, Alignment: ${alignment}
Background: ${background}
Visible Equipment: ${equipment}
Description: ${bio || "No additional description."}`;

  const fullPrompt = `${promptStyle}\n${dynamicPrompt}`;

  new Dialog({
    title: "Edit AI Prompt",
    content: `
      <form>
        <div class="form-group">
          <label>Edit prompt for AI generation:</label>
          <textarea id="prompt-text" rows="12" style="width:100%;">${fullPrompt}</textarea>
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
              "Authorization": `Bearer ${openaiApiKey}`
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
          const random = Math.floor(Math.random() * 999999);
          const filename = `portrait-${actor.name.replace(/\s/g, "_")}-${random}.webp`;
          const file = new File([array], filename, { type: "image/webp" });

          const upload = await foundry.applications.apps.FilePicker.implementation.upload("data", "user/portraits", file, { overwrite: true }, { notify: true });
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
