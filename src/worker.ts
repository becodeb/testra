import { handle } from "@astrojs/cloudflare/handler";

export { ExamRunDO } from "@/server/exam-run-do";

export default {
  fetch(request, env, context) {
    return handle(request, env, context);
  },
} satisfies ExportedHandler<CloudflareEnv>;
