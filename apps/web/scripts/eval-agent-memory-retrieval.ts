import {
  retrievalEvaluationPasses,
  runRetrievalEvaluation,
} from "@/lib/agent-memory/retrieval-eval";

const metrics = runRetrievalEvaluation();
const passed = retrievalEvaluationPasses(metrics);
console.log(
  JSON.stringify(
    {
      evaluation: "agent-memory-retrieval-v1",
      generatedAt: new Date().toISOString(),
      passed,
      metrics,
    },
    null,
    2,
  ),
);
if (!passed) process.exitCode = 1;
