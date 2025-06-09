
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

Hooks.on("renderActorDirectory", (app, html) => {
  const footer = html.find(".directory-footer");
  if (!footer.length) return;

  if (footer.find(".ai-portrait-button").length) return;

  const button = $(`
    <button class="ai-portrait-button">
      <i class="fas fa-magic"></i> AI Portrait
    </button>
  `);
  button.on("click", showActorSelectionDialog);
  footer.append(button);
});

async function showActorSelectionDialog() {
  const actors = game.actors.filter(actor =>
    actor.type === "character" &&
    actor.testUserPermission(game.user, "OWNER")
  );

  if (!actors.length) {
    ui.notifications.warn("You don't own any characters.");
    return;
  }

  const options = actors.map(actor => `<option value="${actor.id}">${actor.name}</option>`).join("");
  const content = `
    <form>
      <div class="form-group">
        <label>Select character:</label>
        <select id="actor-select">${options}</select>
      </div>
    </form>`;

  new Dialog({
    title: "Select Character for AI Portrait",
    content,
    buttons: {
      generate: {
        label: "Edit Prompt",
        callback: async (html) => {
          const actorId = html.find("#actor-select")[0].value;
          const actor = game.actors.get(actorId);
          generatePortrait(actor);
        }
      },
      cancel: { label: "Cancel" }
    },
    default: "generate"
  }).render(true);
}

async function generatePortrait(actor) {
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
          <textarea id="prompt-text" rows="12" style="width:100%;">${defaultPrompt}</textarea>
        </div>
      </form>`,
    buttons: {
      generate: {
        label: "Generate",
        callback: async (html) => {
          const prompt = html.find("#prompt-text")[0].value;
          const response = await fetch("https://api.openai.com/v1/images/generations", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${openaiApiKey}`
            },
            body: JSON.stringify({ prompt, n: 1, size: "512x512" })
          });
          if (!response.ok) {
            ui.notifications.error("Error from OpenAI: " + response.statusText);
            return;
          }
          const data = await response.json();
          const imageUrl = data.data[0]?.url;
          const filename = `portrait-${actor.name.replace(/\\s/g, "_")}.webp`;
          const blob = await (await fetch(imageUrl)).blob();
          const file = new File([blob], filename, { type: "image/webp" });
          const upload = await FilePicker.upload("data", "user/portraits", file, {}, { notify: true });
          const imagePath = upload.path;
          await actor.update({ img: imagePath });
          ui.notifications.info(`Updated portrait for ${actor.name}.`);
        }
      },
      cancel: { label: "Cancel" }
    },
    default: "generate"
  }).render(true);
}
