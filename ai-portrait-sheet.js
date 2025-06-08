console.log("[AI Portrait Generator] Script loaded.");

Hooks.once("init", () => {
  game.settings.register("ai-portrait-generator", "apiKey", {
    name: "OpenAI API Key",
    hint: "Enter your OpenAI API key with DALL·E access",
    scope: "world",
    config: true,
    type: String,
    default: ""
  });
});

Hooks.once("ready", () => {
  console.log("[AI Portrait Generator] Ready hook executed.");
});

Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
  const actor = sheet.actor;
  if (actor.type !== "character") return;
  buttons.unshift({
    label: "AI Portrait",
    class: "ai-portrait-generate",
    icon: "fas fa-magic",
    onclick: () => {
      console.log("[AI Portrait Generator] Menu button clicked for:", actor.name);
      generatePortrait(actor);
    }
  });
});

async function generatePortrait(actor) {
  console.log("[AI Portrait Generator] generatePortrait called");
  const openaiApiKey = game.settings.get("ai-portrait-generator", "apiKey");
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

  const defaultPrompt = `Highly detailed digital portrait of a fantasy RPG character.
Name: ${name}
Class: ${cls}${subclass ? ` (${subclass})` : ""}
Race: ${race}
Gender: ${gender}
Age: ${age}, Height: ${height}, Weight: ${weight}
Level: ${level}, Alignment: ${alignment}
Background: ${background}
Visible Equipment: ${equipment}
Description: ${bio || "No additional description."}
Style: Dungeons and Dragons, fantasy art, full color, portrait, dramatic lighting.`;

  new Dialog({
    title: "Edit AI Prompt",
    content: `
      <form>
        <div class="form-group">
          <label>Edit prompt for AI generation:</label>
          <textarea id="prompt-text" rows="12" style="width:100%;">\${defaultPrompt}</textarea>
        </div>
      </form>`,
    buttons: {
      generate: {
        label: "Generate",
        callback: async (html) => {
          const prompt = html.find("#prompt-text")[0].value;
          console.log("[AI Portrait Generator] Sending prompt:", prompt);
          const response = await fetch("https://api.openai.com/v1/images/generations", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer \${openaiApiKey}`
            },
            body: JSON.stringify({ prompt, n: 1, size: "512x512" })
          });
          if (!response.ok) {
            ui.notifications.error("Error from OpenAI: " + response.statusText);
            return;
          }
          const data = await response.json();
          const imageUrl = data.data[0]?.url;
          const filename = `portrait-\${actor.name.replace(/\s/g, "_")}.webp`;
          const blob = await (await fetch(imageUrl)).blob();
          const file = new File([blob], filename, { type: "image/webp" });
          const upload = await FilePicker.upload("data", "user/portraits", file, {}, { notify: true });
          const imagePath = upload.path;
          await actor.update({ img: imagePath });
          ui.notifications.info(`Updated portrait for \${actor.name}.`);
        }
      },
      cancel: { label: "Cancel" }
    },
    default: "generate"
  }).render(true);
}
