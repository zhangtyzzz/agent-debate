import { generateText, stepCountIs, streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { normalizeBaseUrl } from "../core.js";

const providerCache = new Map();

export function clearProviderCache() {
  providerCache.clear();
}

export function validateAgent(agent) {
  if (!agent?.baseUrl || !agent?.apiKey || !agent?.model) {
    throw new Error(`${agent?.name || "Agent"} is missing Base URL, API Key, or Model.`);
  }
}

export async function chatCompletion(agent, messages, maxTokens, options = {}) {
  validateAgent(agent);

  const model = getModel(agent);
  const normalizedMessages = toModelMessages(messages);
  const tools = options.tools || {};
  const hasTools = Object.keys(tools).length > 0;
  const maxToolSteps = Math.max(0, Number(options.maxToolSteps || 0));
  const sharedConfig = {
    model,
    messages: normalizedMessages,
    temperature: agent.temperature,
    maxOutputTokens: maxTokens,
    abortSignal: options.signal,
    ...(hasTools
      ? {
          tools,
          // Allow maxToolSteps tool rounds + 1 final text-only round.
          stopWhen: stepCountIs(maxToolSteps + 2),
          prepareStep: createToolBudgetGuard(maxToolSteps),
        }
      : {}),
  };

  if (options.stream) {
    return runStreamingText(sharedConfig, options);
  }

  return runGenerateText(sharedConfig, options);
}

export function toModelMessages(messages) {
  return messages.map((message) => ({
    role: message.role,
    content: typeof message.content === "string" ? message.content : String(message.content || ""),
  }));
}

async function runStreamingText(config, options) {
  const toolCalls = [];
  const result = streamText({
    ...config,
    async onChunk({ chunk }) {
      switch (chunk.type) {
        case "text-delta":
          options.onDelta?.(chunk.text);
          break;
        case "reasoning-delta":
          options.onReasoningDelta?.(chunk.text);
          break;
        case "tool-input-start":
          options.onToolEvent?.({
            id: chunk.id,
            tool: chunk.toolName,
            args: {},
            result: "",
            status: "planned",
          });
          options.onToolEvent?.({
            id: chunk.id,
            tool: chunk.toolName,
            args: {},
            result: "",
            status: "running",
          });
          break;
        case "tool-call":
          toolCalls.push({
            id: chunk.toolCallId || chunk.toolName,
            tool: chunk.toolName,
            args: chunk.input,
          });
          break;
        case "tool-result":
          options.onToolEvent?.({
            id: chunk.toolCallId,
            tool: chunk.toolName,
            args: chunk.input,
            result: stringifyOutput(chunk.output),
            status: "completed",
          });
          break;
        case "tool-error":
          options.onToolEvent?.({
            id: chunk.toolCallId,
            tool: chunk.toolName,
            args: chunk.input,
            result: chunk.errorText,
            status: "failed",
          });
          break;
        default:
          break;
      }
    },
  });

  const [text, reasoningText, finishReason] = await Promise.all([
    result.text,
    result.reasoningText,
    result.finishReason,
  ]);

  return {
    text: String(text || "").trim(),
    reasoningText: normalizeReasoningText(reasoningText, text),
    finishReason,
    truncated: finishReason === "length",
    toolCalls: toolCalls.map(normalizeTrackedToolCall),
  };
}

async function runGenerateText(config) {
  const result = await generateText(config);
  const [text, reasoningText, finishReason, dynamicToolCalls] = await Promise.all([
    result.text,
    result.reasoningText,
    result.finishReason,
    result.dynamicToolCalls,
  ]);

  return {
    text: String(text || "").trim(),
    reasoningText: normalizeReasoningText(reasoningText, text),
    finishReason,
    truncated: finishReason === "length",
    toolCalls: dynamicToolCalls.map((call) => ({
      id: call.toolCallId,
      type: "function",
      function: {
        name: call.toolName,
        arguments: JSON.stringify(call.input || {}),
      },
      parsedArguments: call.input && typeof call.input === "object" ? call.input : {},
    })),
  };
}

function getModel(agent) {
  const baseURL = normalizeBaseUrl(agent.baseUrl);
  const cacheKey = `${baseURL}::${agent.apiKey}`;
  if (!providerCache.has(cacheKey)) {
    providerCache.set(
      cacheKey,
      createOpenAICompatible({
        name: "custom-openai-compatible",
        apiKey: agent.apiKey,
        baseURL,
        transformRequestBody: sanitizeRequestBody,
      }),
    );
  }
  return providerCache.get(cacheKey)(agent.model);
}

/**
 * Strip empty `content` from assistant messages that carry tool_calls.
 * The SDK emits `content: ""` (string) or array blocks with `{"type":"text","text":""}`.
 * Some OpenAI-compatible endpoints reject empty text alongside tool_calls.
 */
export function sanitizeRequestBody(body) {
  if (!body?.messages || !Array.isArray(body.messages)) return body;
  let changed = false;
  const messages = body.messages.map((msg) => {
    // Only touch assistant messages that have tool_calls
    if (msg.role !== "assistant" || !msg.tool_calls?.length) return msg;

    // String content: "" → null
    if (typeof msg.content === "string" && msg.content === "") {
      changed = true;
      return { ...msg, content: null };
    }

    // Array content: filter empty text blocks
    if (Array.isArray(msg.content)) {
      const filtered = msg.content.filter(
        (block) => block.type !== "text" || (block.text != null && block.text !== ""),
      );
      if (filtered.length !== msg.content.length) {
        changed = true;
        return { ...msg, content: filtered.length ? filtered : null };
      }
    }

    return msg;
  });
  return changed ? { ...body, messages } : body;
}

function normalizeTrackedToolCall(toolCall) {
  return {
    id: toolCall.id,
    type: "function",
    function: {
      name: toolCall.tool,
      arguments: JSON.stringify(toolCall.args || {}),
    },
    parsedArguments: toolCall.args && typeof toolCall.args === "object" ? toolCall.args : {},
  };
}

/**
 * Creates a `prepareStep` callback that forces `toolChoice: "none"` once the
 * tool-call budget is exhausted, guaranteeing the model always produces a
 * final text response instead of being silently truncated.
 */
export function createToolBudgetGuard(maxToolSteps) {
  return function prepareStep({ stepNumber }) {
    if (stepNumber >= maxToolSteps + 1) {
      return { toolChoice: "none" };
    }
    return undefined;
  };
}

function normalizeReasoningText(reasoningText, text) {
  const finalReasoning = String(reasoningText || "").trim();
  if (!finalReasoning) return "";
  if (!String(text || "").trim()) return "";
  return finalReasoning;
}

function stringifyOutput(output) {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output ?? "");
  }
}
