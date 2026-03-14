# Agent Debate Contributor Notes

## Product Intent

- The transcript should feel like a messaging app, not a debate dashboard.
- `Pro` messages are right-aligned, `Con` messages are left-aligned, and `Judge` / `System` messages are centered summary cards.
- Users should stay in the transcript after a run completes. Do not auto-switch to the report tab.

## Transcript Behavior

- Show reasoning and tool activity before the final answer inside each message card.
- Reasoning and tool panels may open while they are actively streaming or running.
- Once reasoning or tool execution finishes, they should auto-collapse so the final answer regains focus.
- Judge output must remain visible in the transcript even though a separate report tab exists.

## Prompting Rules

- The MVP exposes controlled `writingStyle` plus MCP tools. Do not introduce a free-form user-facing `Skill` editor.
- Agent-level `systemPrompt` is internal configuration, not a casual end-user editing surface.
- Prompt construction should preserve a stable reusable prefix whenever possible.
- Dynamic task instructions should be appended in a trailing `<system-reminder>` block instead of destabilizing the reusable prefix.

## Localization

- In Chinese UI, prefer `正方 Agent` / `反方 Agent` / `裁判 Agent`.
- Winner labels shown in UI and exported Markdown must follow the active locale.

## Layout Guardrails

- Prefer flexbox for transcript row alignment.
- Keep message bubbles width-capped but naturally expandable for long paragraphs.
- Validate transcript rendering with CJK text and long unbroken strings.
- If transcript layout changes, verify both normal reading and PNG export output.

## Release Bar

- Remove temporary debug code, throwaway files, and stale docs before release.
- Keep README, Chinese README, and deployment instructions synchronized.
- Vercel deployment should work with repository import and the included `vercel.json`.
