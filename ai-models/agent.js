import { MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { SYSTEM_PROMPT } from "../prompts/index.js";
import { tools } from "../tools/index.js";
import { llm } from "./llm.js";

const llmWithTools = llm.bindTools(tools)
async function llmCall(state) {
    // LLM decides whether to call a tool or not
    const result = await llmWithTools.invoke([
        {
            role: "system",
            content: SYSTEM_PROMPT
        },
        ...state.messages
    ]);

    return {
        messages: [result]
    };
}
const toolNode = new ToolNode(tools);
function shouldContinue(state) {
    const messages = state.messages;
    const lastMessage = messages.at(-1);

    if (lastMessage?.tool_calls?.length) {
        return "Action";
    }
    return "__end__";
}
export const agentBuilder = new StateGraph(MessagesAnnotation)
    .addNode("llmCall", llmCall)
    .addNode("tools", toolNode)
    .addEdge("__start__", "llmCall")
    .addConditionalEdges(
        "llmCall",
        shouldContinue,
        {

            "Action": "tools",
            "__end__": "__end__",
        }
    )
    .addEdge("tools", "llmCall")
    .compile();