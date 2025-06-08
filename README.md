# AI Portrait Generator

**Author**: Bullseye1979

This Foundry VTT module allows you to generate AI-powered character portraits via DALL·E directly from the character sheet menu.

## Features

- Menu item **“AI Portrait”** in every character sheet header
- Automatically generates detailed prompt from actor data
- Prompt is editable before sending to OpenAI
- Results replace the actor’s portrait immediately

## Setup

1. Install the module (via ZIP or manifest URL)
2. Open **Settings → Module Settings → AI Portrait Generator**
3. Enter your **OpenAI API key**
4. Reload Foundry VTT

## Usage

- Open a character sheet
- Click the **AI Portrait** menu item
- Edit the prompt and click **Generate**
- The image is generated and set as the actor’s portrait

## Requirements

- Foundry VTT v13+  
- OpenAI API access to image generation (DALL·E)
- Module settings save your API key per world
