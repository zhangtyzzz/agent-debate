# Agent Debate — Contributor Notes

Product design rules and guardrails for AI agents and human contributors working on this codebase.

## Product Intent

- The transcript is a **messaging app**, not a dashboard. Bubbles, not panels.
- After a debate run completes, keep the user on the transcript tab. Do not auto-switch to report.

## Transcript Rules

- Reasoning and tool activity render **before** the final answer inside each message card.
- Reasoning/tool panels open while streaming, then auto-collapse when done so the answer regains focus.
- Judge output stays visible in the transcript even though a separate report tab exists.

## Prompt Construction

- Preserve a stable, reusable system prefix. Append dynamic instructions in a trailing `<system-reminder>` block — never destabilize the prefix.
- `systemPrompt` per agent is internal config, not an end-user editing surface.

## Localization

- All user-facing strings must use the `i18n.js` translator; never hardcode display text.
- Chinese UI: 正方 Agent / 反方 Agent / 裁判 Agent.
- Winner labels in UI and exported Markdown must follow the active locale.

## Layout

- Pro = right-aligned, Con = left-aligned, Judge/System = centered.
- Bubbles: width-capped, flexbox alignment.
- Pro bubble inner elements use green-tinted CSS variables scoped via `.ai-entry-shell-pro`; Con uses the default warm palette.
- Validate any layout change with CJK text, long unbroken strings, and PNG export.

## Testing

- Every new feature or behavior change must have corresponding tests. No exception.
- If the change touches logic that has no existing tests, write the tests first.
- All tests must pass (`npm run check`) before any change is considered complete.
- Tests exist to keep iteration stable and impact controllable — treat them as a hard gate, not a nice-to-have.

## Release Checklist

- Remove debug code and throwaway files before release.
- Keep README, Chinese README, and deploy docs synchronized.
- Verify Vercel deploy works with `vercel.json` as-is.
