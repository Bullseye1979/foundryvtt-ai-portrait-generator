console.log("[AI Portrait Generator] Script loaded");

Hooks.once("socketlib.ready", () => {
  window.aiPortraitSocket = game.modules.get("socketlib").api;
});

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
    name: "GPT Prompt Template",
    hint: "Instruction sent to GPT to enhance the character description for DALL·E.",
    scope: "world",
    config: true,
    type: String,
    default: `Enhance the following image description for DALL·E by making it more detailed, atmospheric, and creative without changing its original style.
- Use creative dynamic angles, lighting effects, and filters when appropriate.
- Incorporate creative symbolism when relevant.
- Ensure the portrait shows a centered face.
- No deformed bodies. No full-body shots.`,
    multiline: true
  });
});

// CLIENT-SIDE UI
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

  if (!apiKey) return ui.notifications.warn("OpenAI API Key not set.");

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
  const equipment = items.filter(i => ["weapon", "equipment", "armor"].includes(i.type)).map(i => i.name).slice(0, 5).join(", ") || "no visible equipment";

  const baseDescription = `Name: ${name}
Class: ${cls}${subclass ? ` (${subclass})` : ""}
Race: ${race}
Gender: ${gender}
Age: ${age}, Height: ${height}, Weight: ${weight}
Level: ${level}, Alignment: ${alignment}
Background: ${background}
Equipment: ${equipment}
Description: ${bio || "No additional description."}`;

  ui.notifications.info("Contacting GPT to optimize prompt...");
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
        max_tokens: 250
      })
    });

    const gptData = await gptResponse.json();
    optimizedPrompt = gptData.choices?.[0]?.message?.content || baseDescription;
  } catch (err) {
    console.error("GPT error:", err);
    ui.notifications.warn("Using raw prompt.");
  }

  new Dialog({
    title: "Edit AI Prompt",
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
          const finalPrompt = html.find("#prompt-text").val()?.trim();
          if (!finalPrompt) return ui.notifications.warn("Prompt is empty.");
          ui.notifications.info("Generating image...");
          const socketlibApi = game.modules.get("socketlib")?.api;
          if (!socketlibApi) {
            ui.notifications.error("Socketlib API nicht verfügbar.");
            console.error("Socketlib API fehlt.");
            return;
          }

await socketlibApi.executeAsGM("ai-portrait-generator", "generatePortraitImage", actor.id, finalPrompt);
;
        }
      },
      cancel: { label: "Cancel" }
    },
    default: "generate"
  }).render(true);
}

// SERVER-SIDE HANDLER
Hooks.once("socketlib.ready", () => {
  socketlib.registerModule("ai-portrait-generator").register("generatePortraitImage", async (actorId, prompt) => {
    const actor = game.actors.get(actorId);
    const apiKey = game.settings.get("ai-portrait-generator", "apiKey");
    if (!actor || !apiKey) return;

    const fetch = require("node-fetch");
    const fs = require("fs");
    const path = require("path");

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
      if (!imageUrl) throw new Error("No image URL returned from DALL·E");

      const imageResponse = await fetch(imageUrl);
      const buffer = await imageResponse.buffer();

      const timestamp = Date.now();
      const safeName = actor.name.replace(/\s/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
      const fileName = `portrait-${safeName}-${timestamp}.webp`;
      const filePath = path.join("public", "user", "portraits", fileName);

      fs.writeFileSync(filePath, buffer);

      await actor.update({ img: `user/portraits/${fileName}?cb=${timestamp}` });
      ui.notifications.info(`Portrait updated for ${actor.name}`);
    } catch (error) {
      console.error("[AI Portrait Generator] Error:", error);
      ui.notifications.error("Failed to generate or save image.");
    }
  });
});
