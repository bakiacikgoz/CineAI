# Handoff Notes

This branch bundles broad UI, audio, storyboard, and Scenario Studio changes in one push.
Before extending it further, review the touched areas together instead of assuming a single isolated feature landed.

## Validated

- `pnpm test`
- `pnpm build`

Both passed on March 30, 2026.

## Known Follow-ups

- Scenario Studio pass-1 JSON planning is more resilient now, but cheaper models can still drift on large scenarios. If this resurfaces, prefer schema-enforced output and/or scene-level chunking.
- Scenario Studio shot generation is still sequential inside the app. It is not yet a true parallel worker/agent architecture.
- OpenRouter model picker is provider-grouped now, but it still lacks favorites, presets like cheap/fast/premium, and model quality guidance.
- Browser warning about exposed `fal` credentials is still present and should be treated as a production security follow-up.
- Production build still emits a large bundle warning for the main Vite chunk. Code-splitting/manual chunks remain open.
- Because this push includes many surface-area changes, manual regression is still needed for audio pipeline, storyboard flows, dashboard navigation, and Scenario Studio end-to-end generation.

## Suggested Review Order

1. Scenario Studio end-to-end run with a medium-length script and a cheap OpenRouter model.
2. Audio pipeline dialogue editing and voice generation flow.
3. Storyboard import/bulk production/media preview regressions.
4. Settings/OpenRouter/FAL configuration sanity check.
