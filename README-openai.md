# Use your own model server (LM Studio, llama.cpp, Odysseus, a hosted API)

`JARVIS_BRAIN=openai` connects Jarvis to any server that speaks the common
"OpenAI-compatible" chat format (`POST /v1/chat/completions`). It shares the same
tools, memory and permission rules as the other brains.

## Settings
- `JARVIS_OPENAI_MODEL` (required): the model name your server expects.
- `JARVIS_OPENAI_URL`: default `http://127.0.0.1:1234/v1` (LM Studio's default).
- `JARVIS_OPENAI_KEY`: only if the server needs a key.
- `JARVIS_OPENAI_THINK=1`: leave a Qwen model's reasoning on (off by default, it is far too slow for voice).

Double-click `Jarvis-Server.cmd` to start with this brain (writes enabled, like the others).

## Typical servers
- **LM Studio:** load a model, open the Developer tab, start the server, copy the model name.
- **llama.cpp:** `llama-server -m model.gguf --port 8080`, then `JARVIS_OPENAI_URL=http://127.0.0.1:8080/v1`.
- **Odysseus or another app that exposes an OpenAI-compatible address:** use that address and model name.

As with the local brain, small models do badly with long tool lists, so the display-panel
tools are hidden unless `JARVIS_OLLAMA_DISPLAY=1`.
Phone access can use it too: `JARVIS_PHONE_BRAIN=openai`.
