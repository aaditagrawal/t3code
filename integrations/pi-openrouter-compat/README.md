# Pi OpenRouter compatibility

Some OpenRouter catalog entries report `max_completion_tokens` equal to the model's entire context
window. Pi reserves prompt space, but some upstream inference providers still reject the resulting
very large output limit. This extension omits that unsafe catalog-derived limit and lets OpenRouter
and the selected model choose the output limit. It does not impose a replacement cap.

Install the extension file with Pi:

```bash
pi install ./integrations/pi-openrouter-compat/index.ts
```

Restart `pi-acp` after installation. The extension only changes OpenRouter Chat Completions requests
whose advertised maximum output is at least the full context window. Other providers and ordinary
model limits are unchanged.
