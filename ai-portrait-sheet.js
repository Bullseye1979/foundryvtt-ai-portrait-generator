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
    name: "Default Style Prompt",
    hint: "Enter your preferred visual style for character portraits (e.g. painterly, moody lighting...)",
    scope: "world",
    config: true,
    type: String,
    default: "highly detailed, DnD character, cinematic light, colorful, centered face, portrait"
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
  if (!apiKey) {
    ui.notifications.warn("OpenAI API Key not set in module settings.");
    return;
  }

  const userStyle = game.settings.get("ai-portrait-generator", "stylePrompt");

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

  const basePrompt = `
Name: ${name}
Class: ${cls}${subclass ? ` (${subclass})` : ""}
Race: ${race}
Gender: ${gender}
Age: ${age}, Height: ${height}, Weight: ${weight}
Level: ${level}, Alignment: ${alignment}
Background: ${background}
Visible Equipment: ${equipment}
Description: ${bio || "No additional description."}
Style: ${userStyle}`;

  new Dialog({
    title: "Edit AI Prompt",
    content: `
      <form>
        <div class="form-group">
          <label>Edit prompt for GPT-3.5 (will be optimized before DALL·E):</label>
          <textarea id="prompt-text" rows="12" style="width:100%;">${basePrompt}</textarea>
        </div>
      </form>`,
    buttons: {
      generate: {
        label: "Generate",
        callback: async (html) => {
          const rawPrompt = html.find("#prompt-text").val();
          ui.notifications.info("Optimizing prompt with GPT-3.5...");

          // GPT-3.5: Prompt Optimization
          const gptResponse = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: "gpt-3.5-turbo",
              messages: [
                { role: "system", content: "You are an expert prompt engineer for DALL·E, focused on fantasy character portraits. Make sure the image shows the face fully centered, without cropping. Avoid full-body unless requested." },
                { role: "user", content: rawPrompt }
              ],
              temperature: 0.7
            })
          });

          const gptData = await gptResponse.json();
          const optimizedPrompt = gptData.choices?.[0]?.message?.content?.trim();

          if (!optimizedPrompt) {
            ui.notifications.error("Failed to get optimized prompt.");
            return;
          }

          ui.notifications.info("Generating portrait with DALL·E...");

          // DALL·E: Image Generation
          const imageResponse = await fetch("https://api.openai.com/v1/images/generations", {
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

          const imageData = await imageResponse.json();
          const base64 = imageData.data[0].b64_json;
          const binary = atob(base64);
          const array = Uint8Array.from(binary, c => c.charCodeAt(0));
          const filename = `portrait-${actor.id}-${Date.now()}.webp`;
          const file = new File([array], filename, { type: "image/webp" });

          const upload = await foundry.applications.apps.FilePicker.implementation.upload("data", "user/portraits", file, { overwrite: true }, { notify: false });
          const imagePath = upload.path;

          await actor.update({ img: imagePath });
          actor.sheet.render(true);

          ui.notifications.info("✅ Portrait updated successfully.");
        }
      },
      cancel: { label: "Cancel" }
    },
    default: "generate"
  }).render(true);
}
