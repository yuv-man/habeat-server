import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AiAgentController } from './ai-agent.controller';
import { AgentService } from './agent/agent.service';
import { BrowserService } from './browser/browser.service';
import { LlmService } from './llm/llm.service';
import { ObservationService } from './observation/observation.service';
import { AiTestUser, AiTestUserSchema } from './schemas/ai-test-user.schema';
import { AiSession, AiSessionSchema } from './schemas/ai-session.schema';
import { AiAction, AiActionSchema } from './schemas/ai-action.schema';
import { AiObservation, AiObservationSchema } from './schemas/ai-observation.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AiTestUser.name, schema: AiTestUserSchema },
      { name: AiSession.name, schema: AiSessionSchema },
      { name: AiAction.name, schema: AiActionSchema },
      { name: AiObservation.name, schema: AiObservationSchema },
    ]),
  ],
  controllers: [AiAgentController],
  providers: [AgentService, BrowserService, LlmService, ObservationService],
  exports: [AgentService],
})
export class AiAgentModule {}
