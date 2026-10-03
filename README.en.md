# DSH AStudio Connect

English | [中文](./README.md)

Automatically brings the models included in the AStudio desktop app (GLM-5.2, DeepSeek-V4-Pro, DeepSeek-V4-Flash, Spark-X2.5, AstronClaw Auto, etc.) into DeepSeek Harness — zero configuration required in DSH chat windows.

## Features

- **Zero setup**: After installing and enabling the plugin, models from your signed-in AStudio desktop app account appear directly in the DSH model selector. No additional configuration needed.

- **Automatic sign-in tracking**: The plugin reads the AStudio desktop app's local session file directly. The model group appears automatically after sign-in and disappears after sign-out. Account switches are tracked automatically — no DSH restart required.

- **Local model catalog**: The model list is read from the AStudio desktop app's on-disk gateway catalog, including full metadata such as context windows, reasoning levels (none/high/max), and promotional badges. No network requests — instant availability.

- **Reasoning levels**: Model-declared reasoning levels map directly to DSH's reasoning effort selector. For example, GLM-5.2 and DeepSeek-V4 series support none/high/max.

- **Promotional badges**: Promotional info (such as "Exclusive Offer") appears right after the model name, based on AStudio server data.

- **Zero credential storage**: The plugin never copies or stores credentials. Each model call reads the bearer token directly from the desktop app's session file and sends it to the AStudio model gateway.

## Installation

Prerequisite: AStudio desktop app installed and signed in. The plugin reuses the app's sign-in state — no additional account needed.

The plugin works across all three DSH interfaces: **Web**, **Desktop**, and **TUI**. Install using the command corresponding to your profile.

```sh
# Web (recommended)
dsh plugin --profile web add dsh-astudio-connect
dsh web

# Or install from GitHub source
dsh plugin --profile web add github:your-org/dsh-astudio-connect
dsh web
```

```sh
# Desktop (DSH Desktop app)
dsh plugin --profile desktop add dsh-astudio-connect
dsh --profile desktop
```

```sh
# TUI (terminal interface)
dsh plugin --profile dsh-tui add dsh-astudio-connect
dsh --profile dsh-tui
```

After installation, switch to the **AStudio** group in the model selector of your interface to start using.

## Command Line

`dsh plugin --profile <web|desktop|dsh-tui> exec dsh-astudio-connect status`: check sign-in state and model catalog source (`--json` for machine-readable output; also `doctor` for diagnostics, `logout` for reporting).

```sh
# Check sign-in status
dsh plugin --profile web exec dsh-astudio-connect status

# Diagnose environment (data root location, session file, catalog source)
dsh plugin --profile web exec dsh-astudio-connect doctor --json
```

`logout` only reports that the desktop app sign-in is unchanged (the plugin stores no credential copy and has nothing to clear).

## How It Works

The plugin achieves zero-config integration through these steps:

1. **Locate data root**: Find the AStudio data root directory from the registry (Windows) or default install paths.
2. **Read session file**: Read the bearer token from `<dataRoot>/userdata/astron-session.json` for the signed-in account.
3. **Read model catalog**: Read the available model list from `<dataRoot>/userdata/model-gateway/catalog-<accountHash>.json`.
4. **Register provider**: Register the model list as DSH's `astudio` provider, connecting directly to the AStudio model gateway (OpenAI Responses API) via pi-ai.
5. **Poll for updates**: Check sign-in state every 30 seconds, automatically following account switches or sign-outs.

## Known Limitations

- The model catalog source depends on AStudio desktop app local files; the catalog does not update while the app is not running.
- Reasoning level mapping is based on the gateway's declared vocabulary (none/high/max); other levels are not available.
- Credentials are read directly from the desktop app's session file without encryption protection (consistent with the desktop app's own storage approach).
- Depends on AStudio desktop app's local file format; major app version updates may require plugin adaptation.

## Disclaimer

- This project is **for personal learning and research only**, driving only the user's own AStudio account on their local machine. Do not use for commercial purposes or beyond reasonable personal use.
- Users must comply with AStudio's terms of service. Any consequences arising from using this project (including but not limited to account restrictions, credit depletion, service interruption) are borne solely by the user.
- The project authors are not liable for any direct or indirect losses arising from the use or misuse of this project.
- This project is not affiliated with, endorsed by, or sponsored by AStudio or DeepSeek. Names mentioned are used solely to describe compatibility; trademark rights belong to their respective owners.

## Acknowledgments

- [corrinehu/dsh-workbuddy-connect](https://github.com/corrinehu/dsh-workbuddy-connect) (MIT) — reference for DSH plugin structure and provider registration.

## License

[MIT](./LICENSE)
