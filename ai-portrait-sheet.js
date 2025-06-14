async function generatePortrait(actor) {
  const apiKey = game.settings.get("ai-portrait-generator", "apiKey");
  const gptPrompt = game.settings.get("ai-portrait-generator", "gptPrompt");
  const proxyBase = game.settings.get("ai-portrait-generator", "proxyUrl")?.trim().replace(/\/+$/, "");
  if (!apiKey) return ui.notifications.warn("Please set the OpenAI API key.");

  const { name, system, items } = actor;
  const clsItem = items.find(i => i.type === "class");
  const cls = clsItem?.name ?? "Adventurer";
  const subclass = clsItem?.system?.subclass ?? "";
  const race = items.find(i => i.type === "race")?.name ?? "Humanoid";
  const background = items.find(i => i.type === "background")?.name ?? "";
  const alignment = system.details?.alignment ?? "Neutral";
  const gender = system.details?.gender ?? "Unknown";
  const age = system.details?.age ?? "Unknown";
  const faith = system.details?.faith ?? "";
  const kin = system.details?.kin ?? "";
  const traits = system.details?.trait ?? "";
  const ideals = system.details?.ideal ?? "";
  const bonds = system.details?.bond ?? "";
  const flaws = system.details?.flaw ?? "";
  const appearance = system.details?.appearance ?? "";
  const bio = system.details?.biography?.value?.replace(/<[^>]*>?/gm, "") ?? "";
  const eyes = system.details?.eyes ?? "unknown";
  const hair = system.details?.hair ?? "unknown";
  const skin = system.details?.skin ?? "unknown";
  const height = system.details?.height ?? "unknown";
  const weight = system.details?.weight ?? "unknown";

  const equipment = items
    .filter(i => ["weapon", "equipment", "armor"].includes(i.type))
    .map(i => i.name).slice(0, 5).join(", ") || "No visible equipment";

  const basePrompt = `Name: ${name}
Class: ${cls}${subclass ? ` (${subclass})` : ""}
Race: ${race}
Gender: ${gender}
Age: ${age}
Height: ${height}
Weight: ${weight}
Eye Color: ${eyes}
Hair: ${hair}
Skin: ${skin}
Faith: ${faith}
Kin: ${kin}
Alignment: ${alignment}
Background: ${background}
Equipment: ${equipment}

Personality Traits: ${traits}
Ideals: ${ideals}
Bonds: ${bonds}
Flaws: ${flaws}
Appearance: ${appearance}
Biography: ${bio}`;

  ui.notifications.info("Contacting GPT...");

  let visualPrompt = "";
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: gptPrompt },
          { role: "user", content: basePrompt }
        ],
        temperature: 0.7,
        max_tokens: 400
      })
    });
    const d = await resp.json();
    visualPrompt = d.choices?.[0]?.message?.content;
    if (!visualPrompt) throw new Error("Empty GPT response");
  } catch (e) {
    console.error("GPT error:", e);
    ui.notifications.warn("GPT failed – showing fallback data.");
    visualPrompt = `⚠️ GPT failed – using raw character info:\n\n${basePrompt}`;
  }

  new Dialog({
    title: "AI Portrait Prompt",
    content: `<form><textarea id="prompt-text" rows="10" style="width:100%;">${visualPrompt}</textarea></form>`,
    buttons: {
      generate: {
        label: "Generate",
        callback: async html => {
          const userPrompt = html.find("#prompt-text").val()?.trim();
          if (!userPrompt) return;

          const safeName = actor.name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");

          try {
            ui.notifications.info("Requesting portrait from DALL·E...");

            const dallePortrait = await fetch("https://api.openai.com/v1/images/generations", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                prompt: userPrompt,
                model: "dall-e-3",
                n: 1,
                size: "1024x1024",
                response_format: "url"
              })
            });
            const portraitUrl = (await dallePortrait.json()).data?.[0]?.url;
            if (!portraitUrl) throw new Error("No portrait URL returned.");

            const portraitFilename = `portrait-${safeName}.webp`;
            const portraitProxyUrl = `${proxyBase}/?b64=${encodeURIComponent(btoa(portraitUrl))}&name=${portraitFilename}`;
            const portraitBlob = await (await fetch(portraitProxyUrl)).blob();
            const portraitFile = new File([portraitBlob], portraitFilename, { type: portraitBlob.type });
            const portraitUpload = await FilePicker.upload("data", "user/portraits", portraitFile, { overwrite: true });
            const portraitPath = portraitUpload.path;

            ui.notifications.info("Requesting token image from DALL·E...");

            const tokenPrompt = `${userPrompt}\n\nfull-body view, plain white background, neutral stance`;

            const dalleToken = await fetch("https://api.openai.com/v1/images/generations", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                prompt: tokenPrompt,
                model: "dall-e-3",
                n: 1,
                size: "1024x1792",
                response_format: "url"
              })
            });
            const tokenUrl = (await dalleToken.json()).data?.[0]?.url;
            if (!tokenUrl) throw new Error("No token URL returned.");

            const tokenFilename = `token-${safeName}.webp`;
            const tokenProxyUrl = `${proxyBase}/?b64=${encodeURIComponent(btoa(tokenUrl))}&name=${tokenFilename}`;
            const tokenBlob = await (await fetch(tokenProxyUrl)).blob();
            const tokenFile = new File([tokenBlob], tokenFilename, { type: tokenBlob.type });
            const tokenUpload = await FilePicker.upload("data", "user/portraits", tokenFile, { overwrite: true });
            const tokenPath = tokenUpload.path;

            await actor.update({
              img: `${portraitPath}?cb=${Date.now()}`,
              "prototypeToken.texture.src": `${tokenPath}?cb=${Date.now()}`
            });

            actor.sheet.render(true);
            ui.notifications.info("Portrait and Token image updated.");
          } catch (e) {
            console.error("Image generation failed:", e);
            ui.notifications.error("Portrait/Token generation failed.");
          }
        }
      },
      cancel: { label: "Cancel" }
    },
    default: "generate"
  }).render(true);
}
