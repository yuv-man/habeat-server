import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";
import { runWithUsageUser } from "../utils/llm-usage";

/**
 * Runs each request inside its user's usage context, so every LLM call it
 * makes — including background work it starts, like dish tuning — is counted
 * against that user. Guards run first, so `req.user` is already set.
 */
@Injectable()
export class UsageContextInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req?.user?._id ? String(req.user._id) : undefined;
    return new Observable((subscriber) =>
      runWithUsageUser(userId, () => next.handle().subscribe(subscriber)),
    );
  }
}
